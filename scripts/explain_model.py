import os
import numpy as np
import pandas as pd
import joblib
import shap
import matplotlib.pyplot as plt

# ANSI Colors
CYAN = "\033[96m"
GREEN = "\033[92m"
RESET = "\033[0m"

def generate_shap_explanation():
    print(f"{CYAN}Loading Fusion Meta-Learner and features for SHAP explanation...{RESET}")
    
    meta_learner_path = os.path.join('models', 'meta_learner.joblib')
    features_path = os.path.join('data', 'X_meta_test.npy')
    
    if not os.path.exists(meta_learner_path) or not os.path.exists(features_path):
        print("Please run fusion_engine.py first to generate the Meta-Learner and test features.")
        return
        
    meta_learner = joblib.load(meta_learner_path)
    X_meta = np.load(features_path)
    
    feature_names = ["XGBoost (Vocal)", "GBC (Vocal)", "Spiral CNN (Motor)", "Wave CNN (Motor)"]
    X_df = pd.DataFrame(X_meta, columns=feature_names)
    
    print(f"{CYAN}Calculating SHAP values for the fused multimodal decision...{RESET}")
    
    explainer = shap.LinearExplainer(meta_learner, X_df)
    shap_values = explainer.shap_values(X_df)
    
    plt.figure(figsize=(10, 6))
    shap.summary_plot(shap_values, X_df, show=False)
    
    output_path = 'shap_summary_fusion.png'
    plt.tight_layout()
    plt.savefig(output_path, dpi=300, bbox_inches='tight')
    
    print(f"\n{GREEN}===================================================={RESET}")
    print(f"{GREEN} SUCCESS! SHAP fusion chart saved as '{output_path}'{RESET}")
    print(f"{GREEN}===================================================={RESET}")

if __name__ == "__main__":
    generate_shap_explanation()