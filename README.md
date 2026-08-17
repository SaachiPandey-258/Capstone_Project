# Parkinson's Multi-Modal Research Framework

A machine learning research framework for predicting and analyzing Parkinson's Disease using multi-modal data integration (vocal features, motor UPDRS data, and spiral/wave drawing CNN models).

---

## 🚀 How Your Friends Can Run This Project

If your friends want to download and run this project on their computer, they just need to follow these 4 simple steps:

### 1. Clone the Repository
```bash
git clone https://github.com/souravvpatill/parkinsons_research.git
cd parkinsons_research
```

### 2. Create and Activate a Virtual Environment
- **Windows (PowerShell / Command Prompt):**
  ```powershell
  python -m venv venv
  .\venv\Scripts\activate
  ```
- **Mac / Linux:**
  ```bash
  python3 -m venv venv
  source venv/bin/activate
  ```

### 3. Install Dependencies
```bash
pip install -r requirements.txt
```

### 4. Run the Application
```bash
python main.py
```

---

## 📊 Interactive Menu Options

When running `main.py`, an interactive CLI menu will launch:

1. **Option 1**: Align Vocal & Motor Datasets (UPDRS Matching)
2. **Option 2**: Train Baseline Model (Random Forest - Vocal Only)
3. **Option 3**: Train Multi-Modal Fusion Model (CNN + MLP)
4. **Option 4**: Generate Model Comparison Chart

> **Note on Model Checkpoints:**  
> Large binary model files (`.keras`, `.pkl`) are excluded from GitHub to keep the repository lightweight. Running Options 2 & 3 via `main.py` will automatically train the models and save checkpoints locally in `models/`.
