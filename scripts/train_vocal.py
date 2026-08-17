import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_squared_error, mean_absolute_error, r2_score
import joblib
import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def train_baseline():
    print("Loading Vocal Data for Baseline Model...")
    df = pd.read_csv(os.path.join(BASE_DIR, 'data', 'parkinsons_updrs.data'))
    
    # Target variable: motor_UPDRS
    y = df['motor_UPDRS'].values
    
    # Input features: Drop subject#, age, sex, test_time, and the UPDRS columns
    # This leaves us with the pure voice metrics (Jitter, Shimmer, etc.) just like the reference paper
    X = df.drop(columns=['subject#', 'age', 'sex', 'test_time', 'motor_UPDRS', 'total_UPDRS']).values
    
    print(f"Dataset shape: {X.shape[0]} records, {X.shape[1]} vocal features.")
    
    # Train-test split (80/20)
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
    
    # Standardize features
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_test_scaled = scaler.transform(X_test)
    
    # Train Random Forest (The reference paper's optimal model)
    print("Training Random Forest Regressor (Baseline)...")
    rf_model = RandomForestRegressor(n_estimators=100, random_state=42, n_jobs=-1)
    rf_model.fit(X_train_scaled, y_train)
    
    # Evaluate
    predictions = rf_model.predict(X_test_scaled)
    rmse = np.sqrt(mean_squared_error(y_test, predictions))
    mae = mean_absolute_error(y_test, predictions)
    r2 = r2_score(y_test, predictions)
    
    print("-" * 40)
    print("BASELINE MODEL PERFORMANCE (Vocal Data Only):")
    print(f"RMSE:      {rmse:.4f}")
    print(f"MAE:       {mae:.4f}")
    print(f"R-squared: {r2:.4f}")
    print("-" * 40)
    
    # Save the model and scaler for later comparison
    os.makedirs(os.path.join(BASE_DIR, 'models'), exist_ok=True)
    joblib.dump(rf_model, os.path.join(BASE_DIR, 'models', 'baseline_rf_model.pkl'))
    joblib.dump(scaler,   os.path.join(BASE_DIR, 'models', 'vocal_scaler.pkl'))
    print("Saved baseline model to models/baseline_rf_model.pkl")

if __name__ == "__main__":
    train_baseline()