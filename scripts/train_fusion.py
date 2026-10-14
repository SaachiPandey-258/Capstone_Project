import pandas as pd
import numpy as np
import os
import hashlib
import joblib
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader, random_split
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import mean_squared_error, mean_absolute_error, r2_score
import glob

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ─────────────────────────────────────────────
# 1. Dataset: pairs all 5875 vocal recordings
#    with the matched motor patient's gait file
# ─────────────────────────────────────────────
class MultiModalDataset(Dataset):
    def __init__(self, mapping_df, vocal_df, gait_dir, max_timesteps=200):
        self.gait_dir = gait_dir
        self.max_timesteps = max_timesteps

        # Build lookup: vocal subject# -> motor patient ID
        subject_to_motor = dict(zip(
            mapping_df['vocal_subject_id'].astype(float),
            mapping_df['motor_patient_id']
        ))

        # Pre-load all motor gait files into a cache for speed
        print("Preloading motor gait files...")
        motor_cache = {}
        for motor_id in mapping_df['motor_patient_id'].unique():
            pattern = os.path.join(gait_dir, f"{motor_id}_*.txt")
            files = glob.glob(pattern)
            if not files:
                continue
            try:
                tensor = np.loadtxt(files[0], max_rows=max_timesteps)
                if len(tensor) < max_timesteps:
                    pad = np.zeros((max_timesteps - len(tensor), tensor.shape[1]))
                    tensor = np.vstack((tensor, pad))
                motor_cache[motor_id] = tensor.astype(np.float32)
            except Exception as e:
                print(f"  Warning: could not load {motor_id}: {e}")

        feature_cols = [c for c in vocal_df.columns
                        if c not in ['subject#', 'age', 'sex', 'test_time',
                                     'motor_UPDRS', 'total_UPDRS']]
        self.feature_columns = feature_cols

        vocal_feats, left_feats, right_feats, targets = [], [], [], []

        print("Building dataset from all 5875 vocal recordings...")
        for _, row in vocal_df.iterrows():
            vid = float(row['subject#'])
            if vid not in subject_to_motor:
                continue
            mid = subject_to_motor[vid]
            if mid not in motor_cache:
                continue

            vocal_feats.append(row[feature_cols].values.astype(np.float32))
            t = motor_cache[mid]
            left_feats.append(t[:, 1:9])
            right_feats.append(t[:, 9:17])
            targets.append(float(row['motor_UPDRS']))

        # Standardize vocal features
        scaler = StandardScaler()
        X_vocal = scaler.fit_transform(np.array(vocal_feats))

        self.vocal_data     = torch.FloatTensor(X_vocal)
        self.vocal_scaler   = scaler
        self.left_foot_data = torch.FloatTensor(np.array(left_feats))
        self.right_foot_data = torch.FloatTensor(np.array(right_feats))
        self.targets        = torch.FloatTensor(targets)

        print(f"Dataset ready: {len(self.targets)} samples.")

    def __len__(self):
        return len(self.targets)

    def __getitem__(self, idx):
        return (self.vocal_data[idx], self.left_foot_data[idx],
                self.right_foot_data[idx], self.targets[idx])


# ─────────────────────────────────────────────
# 2. Model Architecture
# ─────────────────────────────────────────────
class DualBranchMotorCNN(nn.Module):
    """Two parallel 1-D CNNs – one per foot."""
    def __init__(self):
        super().__init__()

        def make_branch():
            return nn.Sequential(
                nn.Conv1d(8, 16, kernel_size=3, padding=1), nn.ReLU(),
                nn.MaxPool1d(2),
                nn.Conv1d(16, 32, kernel_size=3, padding=1), nn.ReLU(),
                nn.AdaptiveAvgPool1d(1)   # → (batch, 32, 1)
            )

        self.left_cnn  = make_branch()
        self.right_cnn = make_branch()
        self.fc = nn.Linear(64, 32)

    def forward(self, left, right):
        # Input shape: (batch, timesteps, 8) → permute to (batch, 8, timesteps)
        left  = self.left_cnn(left.permute(0, 2, 1)).squeeze(2)
        right = self.right_cnn(right.permute(0, 2, 1)).squeeze(2)
        return torch.relu(self.fc(torch.cat((left, right), dim=1)))


class VocalMLP(nn.Module):
    def __init__(self, input_dim=16):
        super().__init__()
        self.mlp = nn.Sequential(
            nn.Linear(input_dim, 32), nn.ReLU(),
            nn.Linear(32, 16),        nn.ReLU()
        )

    def forward(self, x):
        return self.mlp(x)


class MetaLearnerFusion(nn.Module):
    """Fuses Vocal MLP (16-d) + Motor CNN (32-d) → predicts motor_UPDRS."""
    def __init__(self):
        super().__init__()
        self.motor_cnn = DualBranchMotorCNN()
        self.vocal_mlp = VocalMLP()
        # 32 (motor) + 16 (vocal) = 48
        self.fusion_fc = nn.Sequential(
            nn.Linear(48, 24), nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(24, 1)
        )

    def forward(self, vocal, left_foot, right_foot):
        motor_emb = self.motor_cnn(left_foot, right_foot)
        vocal_emb = self.vocal_mlp(vocal)
        fused     = torch.cat((motor_emb, vocal_emb), dim=1)
        return self.fusion_fc(fused).squeeze(-1)


# ─────────────────────────────────────────────
# 3. Training & Evaluation
# ─────────────────────────────────────────────
def train_model():
    print("Initializing Multi-Modal Architecture...")
    mapping_df = pd.read_csv(os.path.join(BASE_DIR, 'data', 'aligned_patients_mapping.csv'))
    vocal_df   = pd.read_csv(os.path.join(BASE_DIR, 'data', 'parkinsons_updrs.data'))
    gait_dir   = os.path.join(BASE_DIR, 'data', 'gait-in-parkinsons-disease-1.0.0')

    dataset    = MultiModalDataset(mapping_df, vocal_df, gait_dir)

    train_size = int(0.8 * len(dataset))
    test_size  = len(dataset) - train_size
    train_ds, test_ds = random_split(dataset, [train_size, test_size])

    train_loader = DataLoader(train_ds, batch_size=64, shuffle=True)
    test_loader  = DataLoader(test_ds,  batch_size=64, shuffle=False)

    model     = MetaLearnerFusion()
    criterion = nn.MSELoss()
    optimizer = optim.Adam(model.parameters(), lr=0.001)
    scheduler = optim.lr_scheduler.StepLR(optimizer, step_size=20, gamma=0.5)

    print("Training Multi-Modal Fusion Model (60 epochs)...")
    for epoch in range(60):
        model.train()
        epoch_loss = 0.0
        for vocal, left, right, target in train_loader:
            optimizer.zero_grad()
            preds = model(vocal, left, right)
            loss  = criterion(preds, target)
            loss.backward()
            optimizer.step()
            epoch_loss += loss.item()
        scheduler.step()
        if (epoch + 1) % 10 == 0:
            print(f"Epoch {epoch+1}/60 | Loss: {epoch_loss/len(train_loader):.4f}")

    # ── Evaluate ──
    model.eval()
    all_preds, all_targets = [], []
    with torch.no_grad():
        for vocal, left, right, target in test_loader:
            preds = model(vocal, left, right)
            all_preds.extend(preds.detach().cpu().tolist())
            all_targets.extend(target.detach().cpu().tolist())

    rmse = np.sqrt(mean_squared_error(all_targets, all_preds))
    mae  = mean_absolute_error(all_targets, all_preds)
    r2   = r2_score(all_targets, all_preds)

    print("\n" + "="*40)
    print("  BASELINE (Random Forest – vocal only)")
    print("  RMSE: 6.5289  |  MAE: 5.1703  |  R²: 0.3322")
    print("="*40)
    print("  OUR MULTI-MODAL MODEL PERFORMANCE")
    print(f"  RMSE:      {rmse:.4f}")
    print(f"  MAE:       {mae:.4f}")
    print(f"  R-squared: {r2:.4f}")
    print("="*40)

    # Save model
    os.makedirs(os.path.join(BASE_DIR, 'models'), exist_ok=True)
    scaler_path = os.path.join(BASE_DIR, 'models', 'fusion_vocal_scaler.joblib')
    joblib.dump(dataset.vocal_scaler, scaler_path)
    with open(scaler_path, "rb") as scaler_file:
        scaler_digest = hashlib.sha256(scaler_file.read()).hexdigest()
    torch.save({
        "model_state_dict": model.state_dict(),
        "feature_columns": dataset.feature_columns,
        "model_version": "dual-branch-fusion-updrs-v1",
        "target": "motor_UPDRS",
        "gait_timesteps": 200,
        "gait_columns": 19,
        "scaler_sha256": scaler_digest,
    }, os.path.join(BASE_DIR, 'models', 'fusion_model.pt'))
    print("Saved fusion model to models/fusion_model.pt")


if __name__ == "__main__":
    train_model()
