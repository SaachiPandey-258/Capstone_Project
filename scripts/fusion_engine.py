import os
import numpy as np
import pandas as pd
import cv2
import joblib
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix
from sklearn.model_selection import train_test_split

# Suppress TensorFlow terminal clutter
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '2'
from tensorflow.keras.models import load_model

# ANSI Colors for a professional terminal output
CYAN = "\033[96m"
GREEN = "\033[92m"
YELLOW = "\033[93m"
PURPLE = "\033[95m"
RED = "\033[91m"
RESET = "\033[0m"
BOLD = "\033[1m"

IMG_SIZE = 128

def load_image_data_vgg(base_dir):
    """Loads images in RGB format for VGG16 compatibility."""
    X, y = [], []
    test_dir = os.path.join(base_dir, 'testing')
    
    for label, status in enumerate(['healthy', 'parkinson']):
        folder = os.path.join(test_dir, status)
        if not os.path.exists(folder):
            continue
        for file in os.listdir(folder):
            img_path = os.path.join(folder, file)
            # VGG16 REQUIREMENT: Load as BGR then convert to RGB (3 channels)
            img = cv2.imread(img_path)
            if img is not None:
                img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
                img = cv2.resize(img, (IMG_SIZE, IMG_SIZE))
                X.append(img)
                y.append(label)
                
    # Normalize images to [0, 1] as done in training
    X = np.array(X).astype('float32') / 255.0
    y = np.array(y)
    return X, y

def run_fusion():
    print(f"{CYAN}Step 1: Loading Optimized Models (VGG16 & XGBoost)...{RESET}")
    
    try:
        xgb_model = joblib.load(os.path.join('models', 'vocal_xgb.joblib'))
        gbc_model = joblib.load(os.path.join('models', 'vocal_gbc.joblib'))
        scaler = joblib.load(os.path.join('models', 'vocal_scaler.joblib'))
        spiral_cnn = load_model(os.path.join('models', 'spiral_vgg16.keras'))
        wave_cnn = load_model(os.path.join('models', 'wave_vgg16.keras'))
    except Exception as e:
        print(f"{RED}Error loading models: {e}{RESET}")
        return

    print(f"{CYAN}Step 2: Aligning Multi-modal Test Samples...{RESET}")
    
    # 1. Vocal Data Alignment
    df = pd.read_csv(os.path.join('data', 'parkinsons.data'))
    X_vocal = df.drop(['name', 'status'], axis=1)
    y_vocal = df['status']
    _, X_test_v, _, y_test_v = train_test_split(X_vocal, y_vocal, test_size=0.2, random_state=42)
    X_test_v_scaled = scaler.transform(X_test_v)
    y_test_v = y_test_v.values
    
    # 2. Image Data Alignment (Using new VGG loader)
    X_test_s, y_test_s = load_image_data_vgg(os.path.join('data', 'drawings', 'spiral'))
    X_test_w, y_test_w = load_image_data_vgg(os.path.join('data', 'drawings', 'wave'))
    
    # 3. Intersection Logic (Ensuring same n_samples for all 4 inputs)
    idx_v_0, idx_v_1 = np.where(y_test_v == 0)[0], np.where(y_test_v == 1)[0]
    idx_s_0, idx_s_1 = np.where(y_test_s == 0)[0], np.where(y_test_s == 1)[0]
    idx_w_0, idx_w_1 = np.where(y_test_w == 0)[0], np.where(y_test_w == 1)[0]
    
    min_0 = min(len(idx_v_0), len(idx_s_0), len(idx_w_0))
    min_1 = min(len(idx_v_1), len(idx_s_1), len(idx_w_1))
    
    X_v_aligned = np.vstack((X_test_v_scaled[idx_v_0[:min_0]], X_test_v_scaled[idx_v_1[:min_1]]))
    X_s_aligned = np.vstack((X_test_s[idx_s_0[:min_0]], X_test_s[idx_s_1[:min_1]]))
    X_w_aligned = np.vstack((X_test_w[idx_w_0[:min_0]], X_test_w[idx_w_1[:min_1]]))
    y_true = np.array([0]*min_0 + [1]*min_1)
    
    print(f"{CYAN}Step 3: Generating Modality Predictions...{RESET}")
    
    p_xgb = xgb_model.predict_proba(X_v_aligned)[:, 1]
    p_gbc = gbc_model.predict_proba(X_v_aligned)[:, 1]
    p_spiral = spiral_cnn.predict(X_s_aligned, verbose=0).flatten()
    p_wave = wave_cnn.predict(X_w_aligned, verbose=0).flatten()

    # --- INDIVIDUAL ACCURACY CHECK ---
    print(f"\n{YELLOW}--- INDIVIDUAL BASE MODEL ACCURACY ---{RESET}")
    base_models = {
        "XGBoost (Vocal)": (p_xgb > 0.5).astype(int),
        "GBC (Vocal)": (p_gbc > 0.5).astype(int),
        "Spiral VGG16 (Motor)": (p_spiral > 0.5).astype(int),
        "Wave VGG16 (Motor)": (p_wave > 0.5).astype(int)
    }
    
    for name, preds in base_models.items():
        acc = accuracy_score(y_true, preds)
        print(f"{name:22}: {BOLD}{acc*100:6.2f}%{RESET}")

    # --- STACKING META-LEARNER (LOGISTIC REGRESSION) ---
    print(f"\n{YELLOW}Training Stacking Meta-Learner (Logistic Regression)...{RESET}")
    
    # Combine predictions into a new feature matrix
    X_meta = np.column_stack((p_xgb, p_gbc, p_spiral, p_wave))
    
    # Split the aligned data to train and evaluate the meta-learner safely
    X_train_m, X_test_m, y_train_m, y_test_m = train_test_split(
        X_meta, y_true, test_size=0.3, random_state=42, stratify=y_true
    )
    
    from sklearn.linear_model import LogisticRegression
    meta_learner = LogisticRegression(random_state=42)
    meta_learner.fit(X_train_m, y_train_m)
    
    joblib.dump(meta_learner, os.path.join('models', 'meta_learner.joblib'))
    np.save(os.path.join('data', 'X_meta_test.npy'), X_test_m)
    
    final_predictions = meta_learner.predict(X_test_m)
    final_acc = accuracy_score(y_test_m, final_predictions)
    
    # Extract learned weights for interpretability (Softmax of coefficients)
    coefs = meta_learner.coef_[0]
    weights = np.exp(coefs) / np.sum(np.exp(coefs))

    print(f"\n{BOLD}{PURPLE}============================================================{RESET}")
    print(f"{BOLD}{PURPLE} LEARNED FUSION WEIGHTS (META-LEARNER COEFFICIENTS){RESET}")
    print(f"{BOLD}{PURPLE}============================================================{RESET}")
    print(f"XGBoost (Vocal) Weight : {BOLD}{weights[0]*100:.1f}%{RESET}")
    print(f"GBC (Vocal) Weight     : {BOLD}{weights[1]*100:.1f}%{RESET}")
    print(f"Spiral CNN (Motor)     : {BOLD}{weights[2]*100:.1f}%{RESET}")
    print(f"Wave CNN (Motor)       : {BOLD}{weights[3]*100:.1f}%{RESET}")
    
    print(f"\n{BOLD}{GREEN}============================================================{RESET}")
    print(f"{BOLD}{GREEN} FINAL MULTI-MODAL ENSEMBLE RESULTS (TEST SET){RESET}")
    print(f"{BOLD}{GREEN}============================================================{RESET}")
    print(f"Final Multi-modal Accuracy: {BOLD}{final_acc*100:.2f}%{RESET}\n")
    print(classification_report(y_test_m, final_predictions, target_names=["Healthy (0)", "Parkinson's (1)"]))

    cm = confusion_matrix(y_test_m, final_predictions)
    print(f"Confusion Matrix:\n{cm}")

if __name__ == "__main__":
    run_fusion()