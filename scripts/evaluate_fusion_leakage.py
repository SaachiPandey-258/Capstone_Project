"""Compare the fusion model under a random split vs a subject-held-out split.

The original fusion protocol (scripts/train_fusion.py) splits the 5,875 voice
recordings at random, so recordings from the same person land in both the
training and test sets. This script retrains the same architecture twice:

  1. random 80/20 split of recordings (original protocol)
  2. GroupShuffleSplit by voice subject (no person in both sets), 3 seeds

and reports RMSE, MAE, R^2 and the MAE of simply predicting the training mean.
It does not overwrite models/fusion_model.pt.

    python -m scripts.evaluate_fusion_leakage
"""

import os

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import GroupShuffleSplit

from scripts.train_fusion import MetaLearnerFusion, MultiModalDataset

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _train_and_score(dataset, train_idx, test_idx, epochs=60, seed=0):
    torch.manual_seed(seed)
    model = MetaLearnerFusion()
    optimizer = torch.optim.Adam(model.parameters(), lr=1e-3)
    scheduler = torch.optim.lr_scheduler.StepLR(optimizer, 20, 0.5)
    loss_fn = nn.MSELoss()
    train = torch.tensor(train_idx)
    for _ in range(epochs):
        model.train()
        order = train[torch.randperm(len(train))]
        for start in range(0, len(order), 64):
            batch = order[start:start + 64]
            optimizer.zero_grad()
            prediction = model(dataset.vocal_data[batch], dataset.left_foot_data[batch], dataset.right_foot_data[batch])
            loss_fn(prediction, dataset.targets[batch]).backward()
            optimizer.step()
        scheduler.step()
    model.eval()
    test = torch.tensor(test_idx)
    with torch.no_grad():
        predicted = model(dataset.vocal_data[test], dataset.left_foot_data[test], dataset.right_foot_data[test]).numpy()
    actual = dataset.targets[test].numpy()
    baseline = np.full_like(actual, dataset.targets[train].numpy().mean())
    return {
        "rmse": float(np.sqrt(mean_squared_error(actual, predicted))),
        "mae": float(mean_absolute_error(actual, predicted)),
        "r2": float(r2_score(actual, predicted)),
        "mean_baseline_mae": float(mean_absolute_error(actual, baseline)),
    }


def main():
    np.random.seed(0)
    mapping = pd.read_csv(os.path.join(BASE_DIR, "data", "aligned_patients_mapping.csv"))
    vocal = pd.read_csv(os.path.join(BASE_DIR, "data", "parkinsons_updrs.data"))
    dataset = MultiModalDataset(mapping, vocal, os.path.join(BASE_DIR, "data", "gait-in-parkinsons-disease-1.0.0"))
    mapped = set(mapping["vocal_subject_id"].astype(float))
    subjects = np.array([float(s) for s in vocal["subject#"] if float(s) in mapped])
    n = len(dataset)
    order = np.random.permutation(n)
    cut = int(0.8 * n)
    print("Random 80/20 split (original protocol):", _train_and_score(dataset, order[:cut], order[cut:]))
    results = []
    for seed in range(3):
        train_idx, test_idx = next(GroupShuffleSplit(1, test_size=0.2, random_state=seed).split(np.zeros(n), groups=subjects))
        result = _train_and_score(dataset, train_idx, test_idx)
        results.append(result)
        print(f"Subject-held-out split, seed {seed}:", result)
    print("Subject-held-out mean:", {key: float(np.mean([r[key] for r in results])) for key in results[0]})


if __name__ == "__main__":
    main()
