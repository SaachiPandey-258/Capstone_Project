import pandas as pd
import numpy as np
import os
from sklearn.neighbors import NearestNeighbors

# Always resolve paths relative to this script's location, not the caller's CWD
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, 'data')

def align_datasets():
    print("Loading Vocal Dataset...")
    vocal_df = pd.read_csv(os.path.join(DATA_DIR, 'parkinsons_updrs.data'))
    # Vocal dataset has multiple recordings per subject. 
    # Let's aggregate by subject to find their average UPDRS and baseline demographics.
    vocal_agg = vocal_df.groupby('subject#').agg({
        'age': 'mean',
        'sex': 'mean',
        'motor_UPDRS': 'mean',
        'total_UPDRS': 'mean'
    }).reset_index()
    
    print("Loading Motor Dataset Demographics...")
    # Demographics file is tab separated, but might have weird spacing. 
    motor_data = []
    with open(os.path.join(DATA_DIR, 'gait-in-parkinsons-disease-1.0.0', 'demographics.txt'), 'r') as f:
        headers = [h for h in f.readline().strip().split('\t') if h]
        for line in f:
            parts = line.strip().split('\t')
            if len(parts) >= 11:
                # Pad with None if too short, or truncate if too long
                row = parts[:len(headers)] + [None] * (len(headers) - len(parts))
                motor_data.append(row)
    motor_df = pd.DataFrame(motor_data, columns=headers)
    
    # Clean up motor data
    # Drop rows where UPDRS is missing (healthy controls don't have it, or it's NaN)
    # Actually, healthy controls (Group 2) have UPDRS = 0 or NaN.
    # Let's map Sex: in vocal 0=male, 1=female (usually, or vice versa, need to check).
    # In motor: Gender 1=Male, 2=Female? We will just match on UPDRS and Age primarily to be safe.
    
    # Fill NaN UPDRS with 0 for healthy controls
    motor_df['UPDRSM'] = pd.to_numeric(motor_df['UPDRSM'], errors='coerce').fillna(0)
    motor_df['Age'] = pd.to_numeric(motor_df['Age'], errors='coerce').dropna()
    
    # We will use NearestNeighbors to match Vocal patients to Motor patients based on [Age, Motor_UPDRS]
    features_vocal = vocal_agg[['age', 'motor_UPDRS']].values
    features_motor = motor_df[['Age', 'UPDRSM']].dropna().values
    
    # Keep track of valid motor indices
    valid_motor_df = motor_df.dropna(subset=['Age', 'UPDRSM']).reset_index(drop=True)
    
    nn = NearestNeighbors(n_neighbors=1, algorithm='auto').fit(valid_motor_df[['Age', 'UPDRSM']].values)
    distances, indices = nn.kneighbors(features_vocal)
    
    # Create mapping
    mapping = []
    for i, vocal_row in vocal_agg.iterrows():
        matched_motor_idx = indices[i][0]
        matched_motor_id = valid_motor_df.iloc[matched_motor_idx]['ID']
        
        mapping.append({
            'vocal_subject_id': vocal_row['subject#'],
            'vocal_age': vocal_row['age'],
            'vocal_motor_UPDRS': vocal_row['motor_UPDRS'],
            'motor_patient_id': matched_motor_id,
            'motor_age': valid_motor_df.iloc[matched_motor_idx]['Age'],
            'motor_UPDRSM': valid_motor_df.iloc[matched_motor_idx]['UPDRSM'],
            'match_distance': distances[i][0]
        })
        
    mapping_df = pd.DataFrame(mapping)
    mapping_df.to_csv(os.path.join(DATA_DIR, 'aligned_patients_mapping.csv'), index=False)
    print(f"Alignment complete! Mapped {len(mapping_df)} unique vocal patients to motor patients.")
    print("Saved mapping to data/aligned_patients_mapping.csv")
    print(mapping_df.head())

if __name__ == "__main__":
    align_datasets()
