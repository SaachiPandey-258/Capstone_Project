# Parkinson's Assessment & Monitoring — Project Manual

**Voice-based Parkinson's screening research portal · SAKEC, Mumbai, India**

This manual covers how to run the project, how it works, every model and dataset, all measured results, the limitations, and viva and research-paper preparation. Every number below comes from a metrics file in `models/` or from an experiment run in this project. The source is given next to each figure.

**This is the single complete reference for the project.**

**Terminology.** The person being assessed is called a **participant**, not a patient, because results are not verified by a clinician. Some internal code names (e.g. `patient_*` API fields) keep the older word.

**How to read it**

- **New to the project?** Read §1 (quick facts), §2 (problem), §5 (features) and §3 (how to run), then try the app.
- **Project member preparing for the viva?** Read everything; focus on §9 (models), §11 (all numbers), §17 (limitations) and §18 (questions and answers).
- **Writing the research paper?** Use §10 (datasets), §11 (result tables) and §19 (structure and safe claims).

---

## Contents

1. [Quick facts (one-page revision sheet)](#1-quick-facts-one-page-revision-sheet)
2. [Problem statement and objectives](#2-problem-statement-and-objectives)
3. [How to run the project](#3-how-to-run-the-project)
4. [System architecture and technology stack](#4-system-architecture-and-technology-stack)
5. [Features, page by page](#5-features-page-by-page)
6. [What was added or changed in the latest development phase](#6-what-was-added-or-changed-in-the-latest-development-phase)
7. [Audio processing pipeline](#7-audio-processing-pipeline)
8. [Voice features explained](#8-voice-features-explained)
9. [Models (model cards)](#9-models-model-cards)
10. [Datasets](#10-datasets)
11. [Experiments and findings log (all numbers)](#11-experiments-and-findings-log-all-numbers)
12. [Severity scale (UPDRS) and result tiers](#12-severity-scale-updrs-and-result-tiers)
13. [Care finder (OpenStreetMap)](#13-care-finder-openstreetmap)
14. [Backend API, database and security](#14-backend-api-database-and-security)
15. [Reports and PDF](#15-reports-and-pdf)
16. [Testing and verification](#16-testing-and-verification)
17. [Limitations and ethics](#17-limitations-and-ethics)
18. [Viva preparation: likely questions and answers](#18-viva-preparation-likely-questions-and-answers)
19. [Research paper guidance](#19-research-paper-guidance)
20. [Glossary](#20-glossary)
21. [References](#21-references)

---

## 1. Quick facts (one-page revision sheet)

| Item | Value |
|---|---|
| What it is | Web portal: record a sustained “aaah” → automatic voice measurements → Parkinson's screening result + UPDRS severity estimate → formal report/PDF → progress tracking → find care in India |
| Not | A medical device or diagnosis |
| Frontend | Next.js 13.5.6 (React 18.2, TypeScript), Recharts, Leaflet, @react-pdf/renderer |
| Backend | FastAPI (Python), SQLite, Praat via `praat-parselmouth` 0.4.7, scikit-learn 1.6.1, PyTorch 2.8 |
| Ports | Frontend `http://localhost:3001`, API `http://127.0.0.1:8001` (`/docs` for OpenAPI) |
| Start | `./start.command` (macOS) or `start.bat` (Windows) |
| Screening for **recorded audio** | `rf-spectral-pd-screen-v4`: Random forest on 28 spectral, cepstral and pitch measures, trained on 78 phone recordings with age balancing. **ROC AUC 0.782** (0.765 on the age-matched ≥ 55 subgroup) |
| Screening for **typed/dataset values** | `logistic-pd-screen-v3`: Logistic regression on 13 log-scaled Praat measures, trained on 951 recordings from 284 speakers. **ROC AUC 0.758**; cross-dataset 0.831 / 0.732 |
| Severity | `ridge-log-updrs-v2`: Ridge regression on 13 log-scaled Praat measures, trained on 5,875 recordings from 42 people with Parkinson's. **MAE 6.95** (cohort-mean MAE 7.13, R² −0.005) |
| Gait screening | `svm-gait-pd-screen-v1`: SVM on 9 stride-timing measures, trained on 306 walking recordings from 165 people (93 PD, 72 controls). **AUC 0.801** per person; cross-study 0.71–0.74 |
| **Voice + gait combined** | Late fusion (average of voice and gait probabilities) gives **one verdict**. Simulated **AUC 0.845** vs 0.77 voice / 0.77 gait alone; Detected: 65.6% of PD, 14.0% of healthy |
| Severity with gait | `dual-branch-fusion-updrs-v1`: CNN + MLP. **R² 0.914 is leakage**; held-out-subject R² is **0.25 on average** (−0.12 to 0.72) |
| Result tiers (audio) | Not detected < 44% ≤ Inconclusive < 61% ≤ Detected |
| Audio tier error rates | Detected: 55% of PD, 13% of healthy · Not detected: 53% of healthy, 15% of PD |
| Key discovery | On phone audio, the original lab-style model scored **AUC 0.475** (chance) and flagged 72% of healthy people. Jitter and shimmer carry no signal on phone audio, while spectral and cepstral features do. |
| Datasets | Little et al. (195 rec, 32 spk) · Tsanas et al. (5,875 rec, 42 pts) · Sakar et al. (756 rec, 252 spk) · Iyer et al. (81 phone WAVs) · PhysioNet Gait in PD (gait signals) |
| Care finder | OpenStreetMap Nominatim (primary, India-only, healthcare types filtered) + Overpass (fallback); ~4–7 s per search |
| Tests | 32 backend (pytest) + 22 frontend (Vitest), all passing |

---

## 2. Problem statement and objectives

**Problem.** Parkinson's disease (PD) affects voice early. Typical changes are reduced loudness, breathiness, monotone pitch and irregular vocal-fold vibration (dysphonia/hypokinetic dysarthria). Neurologist access in India is uneven. A low-cost tool that a person can run on a phone or laptop could prompt earlier specialist consultation.

**Objectives**

1. Capture a short voice sample in the browser and measure clinically studied voice features automatically.
2. Screen for voice patterns associated with PD, and estimate motor severity (UPDRS Part III), with honest uncertainty.
3. Optionally fuse voice with gait (foot-pressure sensor) data.
4. Produce a formal, shareable report, track change over time, and connect users to care in India.
5. Be transparent: never show a score that was not validly computed, and state model accuracy openly.

**Scope boundary.** Research and screening support only. It is not diagnostic and has no clinical validation.

---

## 3. How to run the project

### 3.1 Prerequisites

| Tool | Version used | Notes |
|---|---|---|
| Python | 3.9.6 (3.11+ recommended) | Virtual environment at `.venv/` |
| Node.js / npm | Node 24 (≥ 20.9 required) | |
| ffmpeg | **Not required** | The browser converts audio to WAV before upload |
| Internet | Required for Google sign-in, map tiles, care search, Google Fonts | |

### 3.2 One-command start (macOS)

```bash
cd Capstone_Project
./start.command
```

What it does:

1. Selects `.venv/bin/python`.
2. Installs backend requirements.
3. Reads `NEXT_PUBLIC_GOOGLE_CLIENT_ID` from `frontend/.env.local`.
4. Starts the API on port 8001 with **auto-reload** (`--reload --reload-dir backend --reload-dir scripts`).
5. Starts Next.js on port 3001.
6. Opens **http://localhost:3001**.

**Always use `localhost`, not `127.0.0.1`.** Google sign-in only works on registered origins.

If a port is busy, stop the old instance (Ctrl + C) first. The launcher refuses to start twice.

Windows: run `start.bat` (fixed to run `backend.app:app` from the repository root).

### 3.3 Manual start

```bash
# Terminal 1 — API
python3 -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements.txt
export FRONTEND_ORIGINS="http://localhost:3001,http://127.0.0.1:3001"
export GOOGLE_CLIENT_ID="<your web client id>"      # optional
uvicorn backend.app:app --host 127.0.0.1 --port 8001 --reload --reload-dir backend --reload-dir scripts

# Terminal 2 — frontend
cd frontend
npm install
# frontend/.env.local:  NEXT_PUBLIC_API_URL=http://127.0.0.1:8001
#                       NEXT_PUBLIC_GOOGLE_CLIENT_ID=<same client id>
npm run dev        # serves on port 3001
```

### 3.4 Environment variables

| Variable | Where | Purpose / default |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | frontend | API base URL (default `http://127.0.0.1:8001`) |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | frontend | Google Identity Services client ID |
| `GOOGLE_CLIENT_ID` | API | Must match the frontend ID; used to verify Google tokens |
| `FRONTEND_ORIGINS` | API | CORS allow-list (comma-separated) |
| `APP_DATA_DIR` / `APP_UPLOAD_DIR` | API | SQLite DB (`backend/.data/portal.sqlite3`) and uploads (`backend/uploads/`) |
| `MODEL_ARTIFACTS_DIR` | API | Model files (default `models/`) |
| `DIRECTORY_COUNTRY_CODES` | API | Care-finder country filter (default `in`; empty = worldwide) |
| `OSM_USER_AGENT`, `OSM_CONTACT_EMAIL` | API | Identify the app to OpenStreetMap services |
| `NOMINATIM_URL`, `OVERPASS_URL` | API | Override OSM endpoints |

### 3.5 Google sign-in setup

1. Google Cloud Console → APIs & Services → Credentials → OAuth client (Web application).
2. **Authorized JavaScript origins:** add `http://localhost:3001`. No redirect URI is needed (popup flow).
3. Put the client ID in `frontend/.env.local` (`NEXT_PUBLIC_GOOGLE_CLIENT_ID`). `start.command` passes it to the API.
4. If the site is opened at `127.0.0.1`, the sign-in page shows a notice with a link to the localhost address.

### 3.6 Re-training the models (reproducibility)

```bash
source .venv/bin/activate
python -m scripts.train_vocal              # UPDRS ridge regressor  -> models/updrs_regressor.pkl (+ metrics json)
python -m scripts.train_classifier         # lab-feature screening  -> models/pd_classifier.pkl
python -m scripts.extract_audio_dataset    # extract features from data/iyer2023 WAVs -> data/iyer2023_features.csv
python -m scripts.train_audio_classifier   # audio screening        -> models/pd_audio_classifier.pkl
python -m scripts.train_gait_classifier    # gait screening + voice/gait fusion calibration -> models/pd_gait_classifier.pkl
python -m scripts.train_fusion             # voice+gait fusion (research; see leakage notes)
python -m scripts.evaluate_fusion_leakage  # random vs subject-held-out fusion evaluation
```

Each trainer writes a `*_metrics.json` file (except fusion) containing the protocol, metrics, thresholds, SHA-256 hash of the artifact and limitations.

### 3.7 Running tests

```bash
.venv/bin/python -m pytest backend/tests -q     # 32 tests
cd frontend && npx vitest run                    # 22 tests
cd frontend && npx tsc --noEmit                  # type check
```

### 3.8 Troubleshooting

| Symptom | Cause / fix |
|---|---|
| “Screening classifier could not be loaded” | The API was started before the models were retrained. Restart it; with auto-reload on, this won't recur. |
| Google stuck on “Loading…” / 403 “origin not allowed” | Open `http://localhost:3001`; add that origin in Google Cloud Console |
| Recording rejected (“only X s of steady voice” / “dB above background”) | Quiet room, ~20 cm from mic, one steady “aaah” for 5–10 s; use the Recording guide's microphone check |
| Care search slow or empty | OSM coverage varies; try a nearby city, larger radius, or “Hospitals & clinics” |

---

## 4. System architecture and technology stack

```
 Browser (Next.js 13 / React 18)
 ├─ Microphone (MediaRecorder) or file upload
 │    └─ Web Audio API: decode → mono → resample 16 kHz → 16-bit PCM WAV   (lib/audio.ts)
 ├─ Pages: Home, Dashboard, New assessment, My assessments, Reports, Progress,
 │         Find care (Leaflet map), Recording guide (live mic check), How it works …
 └─ PDF generation in-browser (@react-pdf/renderer)
            │  HTTPS JSON / multipart, Bearer token
            ▼
 FastAPI backend (backend/app.py)
 ├─ Auth: email+password (PBKDF2-SHA256), Google ID-token verification, sessions
 ├─ Assessments: consent, participant details, uploads, quality gates, feature extraction
 │    └─ backend/audio_features.py  (Praat/Parselmouth + SciPy)
 ├─ Inference (scripts/inference.py)
 │    ├─ Audio screening  : rf-spectral-pd-screen-v4   (models/pd_audio_classifier.pkl)
 │    ├─ Lab screening    : logistic-pd-screen-v3      (models/pd_classifier.pkl)
 │    ├─ Severity (voice) : ridge-log-updrs-v2         (models/updrs_regressor.pkl)
 │    └─ Severity (fusion): dual-branch-fusion-updrs-v1 (models/fusion_model.pt + scaler)
 ├─ SQLite (backend/.data/portal.sqlite3) + uploads (backend/uploads/<user>/)
 └─ Care finder (backend/specialists.py) → OpenStreetMap Nominatim / Overpass
```

### 4.1 Technology stack

| Layer | Technology (version) | Why |
|---|---|---|
| UI framework | Next.js 13.5.6 App Router, React 18.2, TypeScript 5 | Routing, server rendering of public pages |
| Fonts | Plus Jakarta Sans (headings), Inter (body) via `next/font/google` | Professional, readable typography |
| Icons | lucide-react 0.468 | Consistent icon set |
| Charts | Recharts 3 | Progress charts |
| Maps | Leaflet 1.9.4 + react-leaflet 4.2.1, OSM tiles | Interactive care map |
| PDF | @react-pdf/renderer 4.9 | Client-side formal PDF |
| API | FastAPI 0.128 + Uvicorn | Typed REST API, OpenAPI docs |
| Voice analysis | praat-parselmouth 0.4.7 (Praat), SciPy 1.13, NumPy 2.0 | Gold-standard phonetics measures |
| ML | scikit-learn 1.6.1, PyTorch 2.8, joblib | Classifiers/regressors, fusion CNN |
| Storage | SQLite with numbered migrations | Zero-config local database |
| Tests | pytest, Vitest + Testing Library, Playwright (manual E2E) | Automated verification |

### 4.2 Repository layout

```
backend/            FastAPI app, audio_features.py, specialists.py, migrations/, tests/
scripts/            training, inference, feature contract, dataset tools
models/             trained artifacts + *_metrics.json
data/               datasets (see §10)
frontend/app/       pages (Next.js App Router)
frontend/components UI components (wizard, report, map, illustrations…)
frontend/lib/       api client, audio conversion, report helpers, site config
docs/               this manual
start.command / start.bat
```

---

## 5. Features, page by page

| Page (route) | What it does |
|---|---|
| **Home** (`/`) | Landing page with animated voice-analysis card (live waveform, feature chips, self-drawing trend line), feature sections, scroll-reveal animations |
| **Register / Sign in** (`/register`, `/signin`) | Email + password accounts; Google sign-in (popup); session tokens valid 30 days |
| **Dashboard / Overview** (`/dashboard`) | Welcome hero with illustration; stats (assessments, reports, latest date, **latest screening verdict**); quick-action tiles; recent assessment cards |
| **New assessment** (`/assessment/new`) | 4-step wizard: ① participant details (name required; age, sex, location) + consent; ② type: voice or voice + gait; ③ voice input via **Record** (mic button, live level meter, “too quiet” warning), **Upload audio** (any browser-decodable format), or **Feature values** (16 fields or load `parkinsons.data` rows); ④ walking (gait) file — 19-column foot-pressure recording, ≥ 20 s of walking — screened by the gait model and combined with voice into one verdict |
| **Report** (`/reports/[id]`) | Opens automatically after a successful submission with a “report is ready” banner. Formal report: participant info, assessment details, screening verdict with probability bar and tier zones, UPDRS gauge with ± error, acoustic and voice-quality tables, limitations. PDF download; delete |
| **Rejected recording** | If quality gates fail: clear reason, recording tips, **Record again** (keeps participant details), link to guide |
| **My assessments** (`/assessments`) | Summary strip, filters (All / With report / Need attention), cards with colour-coded tier, probability, UPDRS, participant; **Delete with inline confirmation** (removes record + audio file) |
| **Assessment record** (`/assessments/[id]`) | Raw record view, status, files, record again, delete |
| **Reports** (`/reports`) | All completed reports as cards; illustrated empty state |
| **Progress** (`/progress`) | Screening probability over time on coloured tier bands; selectable voice-measure trend (CPPS, pitch SD, HNR, jitter, shimmer); summary cards. Replaces the old “Analytics” page (`/analytics` redirects) |
| **Find care** (`/specialists`) | India-only search by city/area/PIN, quick city chips, care-type and radius filters, **interactive Leaflet map** with colour-coded markers synced to result list, Directions (Google Maps), OSM links, national centres panel (PDMDS, NIMHANS, AIIMS, WHO) |
| **Recording guide** (`/guide`) | Animated 4-step tutorial carousel (auto-play with progress dots) + **live microphone check** (too quiet / good / too loud), do's and don'ts |
| **How it works** (`/how-it-works`) | Animated 6-step pipeline, meaning of each result tier, accuracy figures |
| **About / Resources** | Project approach and curated resources |
| **Footer** | Brand, “SAKEC, Mumbai, India”, platform/learn links, India helplines (Emergency 112, Tele-MANAS 14416), PDMDS & NIMHANS links, disclaimer |

---

## 6. What was added or changed in the latest development phase

### 6.1 Before → after summary

| Area | Before | After |
|---|---|---|
| Browser recordings | Failed: WebM needed ffmpeg, which was not installed | Browser converts any audio to 16 kHz mono WAV; ffmpeg not needed |
| Feature extraction bugs | Jitter(%) ×100 too large; NHR computed as 1/HNR(dB) | Jitter stored as fraction (matches datasets); NHR = 10^(−HNR/10) |
| Recording quality | Whole clip analysed, including silence and noise → false “Detected” | Only the longest steady voiced segment is analysed; recordings rejected if < 1.5 s steady voice or SNR < 15 dB |
| Screening | None (UPDRS estimate only) | Two screening models (audio-specific and lab-feature) with **three tiers** and published error rates |
| Screening accuracy on phone audio | AUC 0.475; 72% of healthy flagged | AUC 0.782; 13% of healthy flagged |
| Voice + gait | Two separate outputs: voice gave the verdict, gait only fed the severity number | **One combined verdict** from a new gait screening model + voice model (late fusion), with both parts shown |
| Wording | “Patient” throughout | “Participant” (results are not clinically verified) |
| Severity model | Random forest, 16 features, R² −0.105 | Ridge on 13 log features, MAE 6.95; shown only when screening = Detected, with ± MAE |
| Report | Key-value dump | Formal report: participant details, verdict, gauge, tables, limitations; formal PDF |
| Submission journey | Inline result | Redirect to report page with success banner; rejected recordings get tips + Record again |
| My assessments | Plain list, no delete | Cards, stats, filters, delete with confirmation (DB + files) |
| Analytics | Always empty (depended on non-existent fields) | Progress page with real trends |
| Care finder | Overpass mostly down → junk name matches (“Doctor … Chowk” road), US placeholder, 250 km default | Nominatim POI search filtered to real healthcare types, India-only, relevance ranking, map, 25 km default, Indian examples |
| Google sign-in | Stuck on “Loading”; origin 403 | Script readiness fixed; launcher opens localhost; origin notice |
| Branding/UI | Letter “P” logo, unloaded fonts | Waveform-shield logo + favicon, Plus Jakarta Sans/Inter, professional dark footer, animations, illustrations, guide |
| Ops | Stale servers after code changes | API auto-reload; Windows launcher fixed |

### 6.2 New files (selection)

- **Backend/scripts:** `scripts/gait_features.py`, `scripts/train_gait_classifier.py`, `scripts/train_classifier.py`, `scripts/train_audio_classifier.py`, `scripts/extract_audio_dataset.py`, `scripts/evaluate_fusion_leakage.py`, `backend/migrations/005_assessment_patient_details.sql`
- **Data:** `data/pd_speech_features.csv`, `data/iyer2023/` (WAVs + demographics), `data/iyer2023_features.csv`
- **Models:** `pd_classifier.pkl`, `pd_audio_classifier.pkl`, `updrs_regressor.pkl` + metrics JSON
- **Frontend:** `lib/audio.ts`, `lib/report.ts`, `lib/site.ts`, `components/severity-gauge.tsx`, `brand-logo.tsx`, `site-footer.tsx`, `illustrations.tsx`, `care-map.tsx`, `mic-check.tsx`, `progress-view.tsx`; pages `/guide`, `/progress`; `app/icon.svg`, `app/template.tsx`

---

## 7. Audio processing pipeline

### 7.1 In the browser (`frontend/lib/audio.ts`)

1. **Capture.** `MediaRecorder` records with echo cancellation, noise suppression and auto-gain **off**, so the voice signal is not altered. Max 60 s. A live RMS meter warns if the level stays below 0.02 (about −34 dBFS).
2. **Normalise.** `AudioContext.decodeAudioData` decodes the audio, then `OfflineAudioContext(1 channel, 16 kHz)` down-mixes and resamples it. It is encoded as 16-bit PCM WAV and the duration is read from the decoded buffer.
3. **Upload** with consent, participant details and modality.

### 7.2 On the server (`backend/audio_features.py`, version `audio-extractor-v4`)

| Step | Rule |
|---|---|
| Decode | WAV in-process (ffmpeg only needed for non-WAV uploads that bypass the browser converter) |
| Basic quality | ≥ 3 s, finite, not silent (RMS > 1e‑5), clipped fraction ≤ 1%, duration matches the browser report (± 2 s) |
| Steady segment | Praat pitch track (10 ms, 75–500 Hz); longest run of voiced frames whose f0 changes ≤ 15% frame-to-frame; trim 0.15 s at each end; needs ≥ **1.5 s** steady voice after trimming |
| Signal-to-noise | Voice RMS vs median RMS of unvoiced frames; reject if **< 15 dB** (skipped if fewer than 30 unvoiced frames exist) |
| 16 contract features | Praat jitter/shimmer/HNR/NHR + in-repo RPDE/DFA/PPE (best-effort; null if unidentifiable) |
| 28 spectral features | Segment band-limited to 0–4 kHz (8 kHz sampling, telephone band) then MFCC, CPPS, pitch variability, spectral tilt |
| Store | Features, quality info (voiced fraction, steady seconds, SNR, median f0, analysis window) |

**Why band-limit to 4 kHz?** The audio model was trained on telephone recordings (8 kHz). Measuring every input in the same band keeps live recordings comparable to the training data, whether they come from a laptop, phone or studio microphone.

---

## 8. Voice features explained

### 8.1 The 16-feature “contract” (`scripts/feature_contract.py`)

| Feature | Meaning | Praat call |
|---|---|---|
| Jitter(%) | Cycle-to-cycle variation of pitch period, relative (stored as a fraction) | Get jitter (local) |
| Jitter(Abs) | Absolute period variation (seconds) | jitter (local, absolute) |
| Jitter:RAP | Relative average perturbation (3-period) | jitter (rap) |
| Jitter:PPQ5 | 5-point period perturbation quotient | jitter (ppq5) |
| Jitter:DDP | Average absolute difference of differences (= 3 × RAP) | jitter (ddp) |
| Shimmer | Cycle-to-cycle amplitude variation | shimmer (local) |
| Shimmer(dB) | Same in decibels | shimmer (local_dB) |
| Shimmer:APQ3/APQ5/APQ11 | 3/5/11-point amplitude perturbation quotients | shimmer (apq3/5/11) |
| Shimmer:DDA | = 3 × APQ3 | shimmer (dda) |
| NHR | Noise-to-harmonics ratio = 10^(−HNR/10) | derived |
| HNR | Harmonics-to-noise ratio (dB) | Harmonicity (cc) mean |
| RPDE | Recurrence period density entropy (in-repo implementation) | SciPy |
| DFA | Detrended fluctuation analysis exponent (in-repo) | SciPy |
| PPE | Pitch period entropy (in-repo) | SciPy |

**Important:** the in-repo RPDE/DFA/PPE are **not calibrated** to the original datasets. Extracted PPE (~0.61–0.67) sits above the training maximum (0.527). That alone made every recording screen positive, so **no deployed model uses RPDE, DFA or PPE**. They are stored for transparency only.

### 8.2 The 28 spectral features (`SPECTRAL_FEATURE_COLUMNS`), used by the audio screening model

| Group | Count | Meaning |
|---|---|---|
| MFCC1–12 SD | 12 | Variability of each mel-frequency cepstral coefficient across the vowel (timbre stability) |
| MFCC1–12 delta SD | 12 | Variability of frame-to-frame change (articulatory steadiness) |
| CPPS | 1 | Smoothed cepstral peak prominence (dB): a robust measure of dysphonia/breathiness; lower values mean less periodic voice |
| F0 SD (semitones) | 1 | Pitch steadiness while sustaining |
| F0 range (semitones) | 1 | 5th–95th percentile pitch spread |
| Spectral tilt (dB) | 1 | Mean LTAS energy 0–1 kHz minus 1–4 kHz |

Observed medians in phone data (Iyer): CPPS **12.57 dB healthy vs 10.27 dB PD**; F0 SD **0.160 vs 0.241 semitones**.

CPPS uses Praat's “Robust” trend fit. It is about 50× faster than “Robust slow” (0.07 s vs 3.99 s per clip) with near-identical values.

---

## 9. Models (model cards)

### 9.1 Audio screening — `rf-spectral-pd-screen-v4` (used for recorded/uploaded audio)

| Field | Value |
|---|---|
| File | `models/pd_audio_classifier.pkl`; metrics `pd_audio_classifier_metrics.json` |
| Algorithm | RandomForestClassifier (500 trees, min_samples_leaf 4) |
| Inputs | 28 spectral features (§8.2), clipped to the training range |
| Training data | Iyer et al. 2023 phone recordings: 78 usable (39 PD, 39 healthy) of 81 |
| Confound handling | **Age-balancing inverse-probability weights** per decade bin (healthy median age 44 vs PD 67.9). Bins containing only one class are down-weighted to 0.05 |
| Validation | StratifiedKFold 5 folds × 20 repeats (one recording per person, so speaker-independent) |
| ROC AUC | **0.782** |
| ROC AUC, age ≥ 55 subgroup | **0.765** |
| Corr(score, age) in healthy | **−0.029** (score does not track age) |
| Thresholds | Not detected < **0.44** ≤ Inconclusive < **0.61** ≤ Detected (chosen so ≤ 15% healthy are “Detected” and ≤ 15% PD are “Not detected”) |
| Tier rates (people with PD) | Detected **55.1%**, Inconclusive 29.9%, Not detected **15.0%** |
| Tier rates (healthy) | Detected **13.1%**, Inconclusive 33.5%, Not detected **53.5%** |
| SHA-256 | `ee60780a…952c` |

### 9.2 Lab-feature screening — `logistic-pd-screen-v3` (used for typed/dataset feature values)

| Field | Value |
|---|---|
| File | `models/pd_classifier.pkl` |
| Algorithm | Pipeline: log(12 perturbation features) → StandardScaler → LogisticRegression (L2, C = 0.3, class_weight balanced) |
| Inputs | 13 Praat measures (Jitter ×5, Shimmer ×6, NHR, HNR); clipped to training range |
| Training data | Sakar 2019 (756 rec, 252 speakers) + Little (195 rec, 32 speakers) = **951 recordings, 284 speakers (212 PD, 72 healthy)** |
| Validation | StratifiedGroupKFold by speaker, 5 folds × 10 repeats; cross-dataset transfer |
| ROC AUC (pooled CV) | **0.758** |
| Train Sakar → test Little | **0.831** |
| Train Little → test Sakar | **0.732** |
| Thresholds | Not detected < **0.35** ≤ Inconclusive < **0.70** ≤ Detected |
| Tier rates (PD) | Detected 38.3%, Inconclusive 49.3%, Not detected 12.4% |
| Tier rates (healthy) | Detected 11.5%, Inconclusive 41.8%, Not detected 46.8% |
| Caveat | On phone audio processed by this app it scores **AUC 0.475**, which is why recorded audio uses model 9.1 |

### 9.3 Gait screening — `svm-gait-pd-screen-v1` (used when a gait file is uploaded)

| Field | Value |
|---|---|
| File | `models/pd_gait_classifier.pkl`; metrics `pd_gait_classifier_metrics.json` |
| Features | 9 stride-timing measures from foot-contact timing (`scripts/gait_features.py`): stride time, stride/stance/swing time CV, swing %, swing % CV, cadence, swing asymmetry, stride-time asymmetry. Force magnitude is not used (calibration differs between insoles) |
| Feature extraction | Contact = total foot force > 10% of the 95th-percentile load; strides between heel strikes; first/last 2 strides dropped; strides outside median ± 3·MAD or 0.6–2.5 s removed; ≥ **10 strides per foot** required (≈ 20 s of walking) |
| Algorithm | log → StandardScaler → RBF SVM (C = 1, balanced, Platt probabilities) |
| Data | PhysioNet Gait in PD: **306 recordings, 165 people (93 PD, 72 controls)**; studies Ga, Ju, Si. Labels and gait come from the **same person** |
| Validation | StratifiedGroupKFold by person, 5 folds × 10 repeats; leave-one-study-out |
| ROC AUC | **0.794** per recording; **0.801** per person |
| Leave-one-study-out | Ga 0.733 · Ju 0.739 · Si 0.714 |
| Thresholds (gait alone) | Not detected < **0.51** ≤ Inconclusive < **0.8** ≤ Detected |
| Tier rates | PD: Detected 55.7%, Not detected 14.8% · Healthy: Detected 13.5%, Not detected 54.3% |
| Group medians (control vs PD) | Swing time CV 3.64% vs 5.37%; swing asymmetry 1.53% vs 3.10%; swing 39.9% vs 38.4% of stride; stance time CV 3.22% vs 3.95% |

### 9.4 Combined voice + gait screening — `late-fusion-mean-v1`

When both inputs are given, the report shows **one verdict**: the **average of the voice-model and gait-model probabilities**, with its own thresholds. Both component results are shown underneath.

- **Why late fusion?** No dataset contains voice and gait from the same people, so a single joint model cannot be trained honestly. Each model is trained on correctly labelled single-modality data, and only the probabilities are combined.
- **How it was evaluated:** out-of-fold voice probabilities and gait probabilities were **paired at random within the same group** (PD with PD, healthy with healthy; 3,000 pairs per class). This assumes voice and gait errors are independent given diagnosis. It is a **simulation**, not a measurement on people who gave both.

| Voice model in the pair | Voice alone AUC | Gait alone AUC | **Combined AUC** | Thresholds (low / high) | PD → Detected | Healthy → Detected | PD → Not detected | Inconclusive (PD / healthy) |
|---|---|---|---|---|---|---|---|---|
| Audio (`rf-spectral-pd-screen-v4`) | 0.769 | 0.769 | **0.845** | 0.53 / 0.65 | 65.6% | 14.0% | 14.7% | 19.6% / 22.6% |
| Lab features (`logistic-pd-screen-v3`) | 0.751 | 0.769 | **0.836** | 0.52 / 0.64 | 63.2% | 14.5% | 14.4% | 22.4% / 21.1% |

Compared with voice alone, combining with gait detects **about 10 percentage points more** people with PD at the same false-alarm rate, and cuts inconclusive results from about 30% to about 20%.

If the gait file is too short (< 10 strides per foot), the report falls back to the voice-only verdict and explains why.

### 9.5 Severity — `ridge-log-updrs-v2`

| Field | Value |
|---|---|
| File | `models/updrs_regressor.pkl` |
| Algorithm | log features → StandardScaler → Ridge (α = 10) |
| Target | motor UPDRS (original UPDRS Part III; dataset range 5.0–39.5, mean 21.3) |
| Data | Tsanas telemonitoring: 5,875 recordings, 42 people with early PD |
| Validation | GroupKFold by subject (6 folds) |
| Metrics | **MAE 6.95**, RMSE 8.15, R² −0.005; predicting the cohort mean gives MAE 7.13 |
| Interpretation | Not better than the cohort average for new people, so shown as “indicative ± 7” and **only when screening = Detected** |

### 9.6 Severity with gait — `dual-branch-fusion-updrs-v1` (research)

| Field | Value |
|---|---|
| Files | `models/fusion_model.pt`, `models/fusion_vocal_scaler.joblib` |
| Architecture | Vocal MLP (16→32→16) + dual-branch 1-D CNN, one branch per foot (8 sensors each; Conv1d 8→16→32, max-pool, global avg-pool, FC 64→32) → fusion head (48→24→1, dropout 0.2) |
| Training | Adam lr 1e‑3, StepLR (20, 0.5), 60 epochs, MSE, batch 64 |
| Gait input | First 200 rows of the 19-column PhysioNet format (time, 8 left, 8 right, 2 totals) |
| Pairing | `dataset_alignment.py`: nearest neighbour on [age, motor UPDRS]; **42 voice subjects → 27 gait subjects** (mean match distance 2.04) |
| Claimed result | R² 0.90 / RMSE 2.52 (hard-coded in `plot_comparison.py`) |
| Reproduced, random split | **R² 0.914, RMSE 2.40, MAE 1.82** (mean-guess MAE 7.05) |
| Subject-held-out (3 seeds) | **R² 0.248 on average** (−0.119, 0.143, 0.719), MAE **4.45**, RMSE 5.78; mean-guess MAE 7.23 |
| Verdict | The 0.90 figure is **data leakage** from the same subjects in train and test. Even the held-out result is inflated, because gait files were chosen using the target (UPDRS), and voice and gait come from **different people**. Keep it as a research demonstration only. |

### 9.7 Legacy baseline — `random-forest-updrs-v1`

Random forest on 16 features, subject-held-out 80/20 (33 train / 9 test subjects): **RMSE 8.03, MAE 6.77, R² −0.105**. It was replaced by 9.5. The earlier hard-coded “baseline R² 0.33” was also from a non-subject-independent protocol.

### 9.8 Other research scripts in the repo (not used by the portal)

- `scripts/train_cnn.py`: drawing (spiral/wave) image classifiers (VGG16/ResNet50/DenseNet121/EfficientNetV2S); data in `data/drawings/` (102 spiral, 102 wave images).
- `scripts/fusion_engine.py`, `scripts/explain_model.py`: class-level meta-learner and SHAP explanation. They align datasets by class, not by person, so they are not subject-level multimodal evidence.
- `main.py`: terminal menu that runs alignment, baseline, fusion and the comparison chart.

---

## 10. Datasets

| Dataset | Source / citation | Size | Labels | Used for |
|---|---|---|---|---|
| **Parkinsons** (`data/parkinsons.data`) | Little et al. 2007/2009; UCI ML Repository | 195 sustained /a/ recordings, **32 speakers** (24 PD, 8 healthy; 147/48 recordings) | status (1 = PD) | Lab screening model; manual “load dataset” feature |
| **Parkinsons Telemonitoring** (`data/parkinsons_updrs.data`) | Tsanas et al. 2010; UCI | **5,875 recordings, 42 people** with early PD (28 male / 14 female), age 36–85 | motor_UPDRS (5.0–39.5), total_UPDRS (7–55) | Severity model; fusion model |
| **PD Speech Features** (`data/pd_speech_features.csv`) | Sakar et al. 2019; UCI #470, **CC BY 4.0** | 756 recordings, **252 speakers** (188 PD, 64 healthy), 3 per speaker; 754 features | class | Lab screening model (13 Praat columns) |
| **Voice samples PD/HC** (`data/iyer2023/`) | Iyer et al. 2023; figshare doi 10.6084/m9.figshare.23849127, **CC BY 4.0** | 81 phone WAVs, 8 kHz, ~1.5–7.2 s (40 PD, 41 HC); 78 pass quality gates | PD/HC, age, sex | **Audio screening model**; external validation |
| **Gait in Parkinson's Disease** (`data/gait-in-parkinsons-disease-1.0.0/`) | PhysioNet (Hausdorff et al.; sub-studies Ga/Ju/Si) | 306 gait recordings: GaPt 75, GaCo 38, JuPt 104, JuCo 25, SiPt 35, SiCo 29 | Pt = PD, Co = control | **Gait screening model**; severity-with-gait model; gait upload validation |
| **Drawings** (`data/drawings/`) | Spiral/wave drawing dataset | 102 spiral + 102 wave images | healthy / parkinson | CNN research script only |
| **Alignment map** (`data/aligned_patients_mapping.csv`) | Generated | 42 rows | – | Synthetic voice↔gait pairing |

**Gait file naming:** `GaPt03_01.txt` = Ga study, **Pt**(PD) subject 03, walk 01; `Co` = control. 19 columns at 100 Hz: time, 8 left-foot sensors, 8 right-foot sensors, total left, total right (vertical ground-reaction force, N).

**Iyer dataset demographics (78 usable):** healthy median age **44**, PD median **67.9**. Sex: healthy 25 F / 14 M, PD 18 F / 21 M. Of the 3 excluded clips, 2 had low SNR (12 dB, 6 dB) and 1 had only 0.7 s of steady voice.

---

## 11. Experiments and findings log (all numbers)

### 11.1 Bugs found in the original audio pipeline

| Finding | Evidence | Fix |
|---|---|---|
| Browser recordings never scored | “WEBM decoding is unavailable because ffmpeg is not installed” | Browser-side WAV conversion |
| Jitter(%) 100× too large | Datasets store a fraction (median 0.0049); extractor multiplied by 100 | Removed ×100 |
| NHR wrong formula | 1/HNR(dB); correct linear relation 10^(−HNR/10) correlates **0.93** with dataset NHR | Formula fixed |
| False “Detected” on a healthy user | Recording only **22% voiced**, longest steady run **0.3 s**; voice RMS ~0.008 vs noise ~0.0035; jitter 3.0%, shimmer 0.21, HNR 5.7 dB; model said 99.99% | Steady-segment selection + SNR/duration rejection |
| Valid recordings rejected | 7 of 81 Iyer clips failed only on RPDE/DFA/PPE range checks | Nonlinear features made best-effort |

### 11.2 Screening on Little data only (32 speakers, speaker-grouped CV, 5 repeats)

Columns: AUC / balanced accuracy / sensitivity / specificity

| Model | 16 features | 13 Praat features |
|---|---|---|
| Logistic regression (balanced) | 0.757 / 0.636 / 0.731 / 0.542 | **0.743 / 0.682 / 0.668 / 0.696** |
| Logistic, log features | 0.742 / 0.667 / 0.796 / 0.538 | – |
| SVM (RBF) | 0.653 / 0.570 / 0.852 / 0.288 | – |
| Random forest | 0.689 / 0.586 / 0.850 / 0.321 | 0.624 / 0.526 / 0.810 / 0.242 |
| Extra trees | 0.702 / 0.603 / 0.819 / 0.388 | – |

The first prototype (RF, single CV) scored accuracy 0.713, AUC 0.703, **sensitivity 0.864 but specificity 0.25** (it flagged 3 of 4 healthy speakers). That is why it was replaced.

### 11.3 Adding Sakar et al. (AUC; speaker-grouped CV)

| Model | CV Sakar | CV Little | CV combined | Sakar→Little | Little→Sakar |
|---|---|---|---|---|---|
| Logistic | 0.736 | 0.743 | 0.736 | 0.807 | 0.680 |
| **Logistic, log features** | **0.754** | 0.697 | **0.757** | **0.831** | **0.732** |
| SVM, log | 0.718 | 0.569 | 0.724 | 0.776 | 0.700 |
| Random forest | 0.697 | 0.627 | 0.689 | 0.666 | 0.697 |
| Extra trees | 0.706 | 0.671 | 0.707 | 0.776 | 0.684 |
| Gradient boosting | 0.711 | 0.566 | 0.702 | 0.738 | 0.694 |

Regularisation sweep (log-LR, combined CV / S→L / L→S): C 0.03 → 0.738/0.843/0.711; C 0.1 → 0.750/0.843/0.721; **C 0.3 → 0.756/0.831/0.732 (chosen)**; C 1 → 0.759/0.804/0.741; C 3 → 0.759/0.778/0.745. L1 and dropping the redundant DDP/DDA columns made no difference.

Threshold study (combined, 20 repeats):

| Single cut-off | Sensitivity | Specificity |
|---|---|---|
| 0.50 | 0.69 | 0.69 |
| 0.60 | 0.54 | 0.80 |
| 0.70 | 0.39 | 0.88 |
| 0.75 | 0.30 | 0.92 |

Three-tier option chosen: **0.35 / 0.70**. Healthy flagged 12%, PD cleared 12%, about 47% inconclusive.

### 11.4 External validation on phone audio (Iyer, our extractor) — the key finding

| Test | Result |
|---|---|
| Lab model v3 applied to phone recordings | **AUC 0.475** (chance); PD and healthy both 72% “Detected”, median p = 0.81 |
| Lab model retrained including phone data | AUC 0.496 |
| Phone-only model, 13 Praat features | AUC 0.514 |
| Medians healthy vs PD (phone) | Jitter 0.0044 vs 0.0041; Shimmer 0.054 vs 0.055; HNR 19.4 vs 19.1 dB, i.e. **no separation** |

Feature sets on phone audio (AUC; LR / RF / SVM; 20 × 5-fold):

| Feature set | LR | RF | SVM |
|---|---|---|---|
| Age only (confound check) | **0.873** | 0.834 | 0.834 |
| Age + sex | 0.865 | 0.830 | 0.831 |
| 13 Praat | 0.443 | 0.452 | 0.525 |
| Spectral (all) | 0.766 | 0.817 | 0.782 |
| Spectral + Praat | 0.770 | 0.824 | 0.779 |
| CPPS + F0 + tilt | 0.681 | 0.731 | 0.659 |
| MFCC means only | 0.483 | 0.600 | 0.402 |

Age-matched check (age ≥ 55: n = 45; 36 PD, 9 healthy; median ages 68.4 vs 68.0): age only **0.473**; spectral LR **0.662**, RF 0.656; 13 Praat 0.495 / 0.400. **Spectral features carry signal beyond age.**

Age-balanced training (AUC full / age ≥ 55 / corr(score, age) in healthy):

| Feature set & model | Plain | Age-weighted |
|---|---|---|
| Spectral (all), RF | 0.813 / 0.741 / +0.25 | 0.780 / 0.761 / +0.04 |
| **MFCC SD + delta SD + CPPS + F0 + tilt, RF** | 0.812 / 0.742 / +0.17 | **0.790 / 0.772 / −0.02** |
| Same, LR C 0.03 | 0.777 / 0.824 / +0.06 | 0.729 / 0.770 / +0.01 |

**Chosen:** the bold row (age-weighted RF). Final trained version: AUC 0.782, age ≥ 55 0.765, corr −0.029.

### 11.5 Severity regressors (subject-grouped 6-fold, motor UPDRS)

| Features | Model | MAE | R² |
|---|---|---|---|
| — | Predict cohort mean | 7.13 | −0.047 |
| 16 | Random forest | 7.32 | −0.149 |
| 16 | Ridge (log) | 7.03 | −0.037 |
| 16 | Gradient boosting | 7.27 | −0.113 |
| **13** | **Ridge (log) — deployed** | **6.95** | **−0.005** |
| 13 | Random forest | 7.23 | −0.092 |
| 13 + age + sex | Ridge (log) | 6.99 | −0.019 |
| 13 + age + sex | Random forest | 8.03 | −0.481 |
| Age + sex only | Gradient boosting | 7.48 | −0.281 |

Conclusion: with 42 people, voice cannot predict UPDRS across people better than the mean.

### 11.6 Fusion leakage audit (`scripts/evaluate_fusion_leakage.py`)

| Protocol | RMSE | MAE | R² | Mean-guess MAE |
|---|---|---|---|---|
| Random 80/20 split (original) | 2.40 | 1.82 | **0.914** | 7.05 |
| Subject held-out, seed 0 | 5.99 | 4.18 | −0.119 | 6.03 |
| Subject held-out, seed 1 | 6.69 | 5.23 | 0.143 | 7.88 |
| Subject held-out, seed 2 | 4.64 | 3.93 | 0.719 | 7.78 |
| **Subject held-out, mean** | **5.78** | **4.45** | **0.248** | 7.23 |

### 11.7 Gait screening model comparison (165 people, grouped by person)

| Model (log features) | AUC per recording | AUC per person | Leave-one-study-out Ga / Ju / Si |
|---|---|---|---|
| Logistic regression | 0.769 | 0.782 | 0.669 / 0.660 / 0.651 |
| **SVM (RBF) — chosen** | **0.794** | **0.801** | **0.733 / 0.739 / 0.714** |
| Random forest | 0.764 | 0.799 | 0.754 / 0.682 / 0.736 |
| Gradient boosting | 0.750 | 0.782 | 0.710 / 0.679 / 0.739 |

All 306 gait files produced valid stride features. Combined voice + gait results are in §9.4.

### 11.8 Sanity checks with synthetic voices (final models)

| Synthetic voice | Audio-model probability | Tier |
|---|---|---|
| Clean (HNR 28 dB) | 0.40–0.51 | Not detected → Inconclusive |
| Mild noise (HNR 21 dB) | 0.69 | Inconclusive (lab model) |
| Rough (HNR 9.7 dB, shimmer 0.11) | 0.87 | Detected |
| Very rough (HNR 4.6 dB) | 0.96 | Detected |

End-to-end check with repo files (lab model + fusion): PD row + `GaPt03_01` → **Detected (77%)**, UPDRS 18.9; healthy row + `GaCo03_01` → **Not detected (21%)** (fusion UPDRS 36.9 is hidden as not applicable).

---

## 12. Severity scale (UPDRS) and result tiers

- **UPDRS Part III (motor examination)** scores 0–108. Higher means worse motor signs.
- Severity bands follow Martínez-Martín et al. (2015) MDS-UPDRS Part III cut-offs: **Mild ≤ 32, Moderate 33–58, Severe ≥ 59**. Caveat: the training data uses the *original* UPDRS, not the MDS-UPDRS, so the bands are approximate. They are **not Hoehn & Yahr stages**.
- The report gauge shows score ± MAE (± 7), labelled “indicative”. It is greyed out unless screening = Detected, because the severity model was trained only on people with PD.
- **Tiers:** *Detected* = see a neurologist; *Inconclusive* = re-record or consult; *Not detected* = no voice markers found, which cannot rule PD out. Each report states the error rate for its tier, e.g. “53% of healthy and 15% of PD speakers received this result”.

---

## 13. Care finder (OpenStreetMap)

| Aspect | Detail |
|---|---|
| Geocoding | Nominatim `/search` (jsonv2), `countrycodes=in`, accepts city, area or 6-digit PIN |
| Primary provider search | Nominatim POI search inside a bounding box of the chosen radius; up to 6 search terms per care type (e.g. neurology: “neurology”, “neuro”, “neurologist”, “hospital”) |
| Type filter | Keep only `amenity` = hospital/clinic/doctors/nursing_home/social_facility, any `healthcare=*`, `office` = ngo/charity/association/foundation/physician/therapist, or Parkinson-named non-road features. **Drops roads/buildings named after doctors** |
| Ranking | Names matching the specialty (neuro/brain/Parkinson/movement; physio/rehab) first, then distance |
| Fallback | Overpass API (`overpass-api.de`, then `overpass.kumi.systems`), 15 s timeout. `overpass.osm.ch` removed (Swiss data only) |
| Etiquette | User-Agent identifies the app; 1 request/s per service; results cached 15 min (128 entries); geocodes cached (LRU 256) |
| Speed (live test) | Mumbai neurology 32 results in 5.0 s; PIN 400001 hospitals 97 in 4.5 s; Pune physio 5 in 4.2 s; Bengaluru 63 in 6.7 s |
| UI | Leaflet map with OSM tiles, colour by type (hospital red, clinic blue, doctor purple, physio green, NGO amber), select-to-fly, Directions link to Google Maps, OSM link |
| Licensing | Data © OpenStreetMap contributors, ODbL; attribution shown on page and map |
| Privacy | Browser location is requested only on “Use my location” and sent only on Search |

---

## 14. Backend API, database and security

### 14.1 Endpoints

| Method & path | Purpose |
|---|---|
| GET `/api/health` | Liveness |
| GET `/api/models/status` | Availability of voice, screening (lab + audio) and fusion artifacts |
| POST `/api/auth/register` · `/login` · `/google` · `/logout`; GET `/api/auth/me` | Accounts and sessions |
| POST `/api/assessments` | Audio (+ optional gait) assessment: multipart with consent, modality, duration, voice, gait, participant fields (`patient_*` in the API) |
| POST `/api/assessments/manual` | 16 feature values (+ optional gait) |
| GET `/api/assessments`, `/api/assessments/{id}` | History (owner-scoped) |
| **DELETE** `/api/assessments/{id}` | Delete record + uploaded files (owner only; 404 otherwise) |
| GET `/api/reports`, `/api/reports/{id}` | Completed assessments |
| GET `/api/dashboard` | Counts + recent |
| POST `/api/research/predict-voice-features` | Raw UPDRS prediction for 16 values |
| GET `/api/specialists` | Care search (location, category, radius, optional lat/lon) |

### 14.2 Database (SQLite, migrations 001–005)

- `users` (id, email unique, name, password_hash, password_salt, google_subject unique, created_at)
- `sessions` (token_hash PK, user_id → users, expires_at)
- `assessments` (id, user_id, modality, status ∈ {completed, validation_required, unavailable, …}, unavailable_reason, created_at, consent_version, consented_at, duration_seconds, files_json, **result_json**, **extracted_features_json**, **extraction_version**, **quality_json**, **patient_json**). Indexed by (user_id, created_at) and (user_id, status, created_at)

### 14.3 Security and privacy

- Passwords: **PBKDF2-HMAC-SHA256, 310,000 iterations**, random salt.
- Sessions: random bearer token; only its **SHA-256 hash** is stored; expires after **30 days**.
- Google: ID token verified server-side against `GOOGLE_CLIENT_ID`; accounts cannot be taken over via a different Google subject.
- Every assessment query is scoped by user_id; uploads are stored per user; deletion removes files.
- Uploads ≤ 25 MB; audio magic-byte checks (WAV/WebM/OGG/MP3/M4A); gait strict 19-column numeric validation.
- Consent is required and versioned (`consent_version` v1, timestamp stored).
- CORS restricted to `FRONTEND_ORIGINS`.

---

## 15. Reports and PDF

Report number `PD-XXXXXXXX` (first 8 hex characters of the record ID). Sections:

1. Participant information
2. Assessment details: date, pathway, voice source, severity model, screening model
3. Findings: verdict card with probability bar over tier zones and tier error rates; UPDRS gauge with ± MAE and band legend; interpretation paragraph
4. Acoustic measurements (16 features + CPPS, F0 SD, F0 range, spectral tilt)
5. Notes and limitations

The PDF is generated in the browser (A4, Helvetica) with a vector gauge and page numbers.

---

## 16. Testing and verification

| Suite | Count | Covers |
|---|---|---|
| Backend pytest | **32** | Auth/sessions, combined voice + gait screening, Google sign-in, migrations (v5), audio extraction, quality rejection, participant-detail validation, three-tier screening, audio-model routing, delete (owner-only, files removed), gait validation, specialist search (filtering, fallback, rate limit, caching, India codes) |
| Frontend Vitest | **22** | Combined voice + gait report, no “patient” wording, navigation, auth guard, wizard validation, dataset loading, consent-gated mic, submit → redirect to report, rejected flow, report rendering (detected/inconclusive), progress empty state, delete confirmation, care search |
| Type check | `tsc --noEmit` clean | |
| Browser E2E (Playwright, manual) | Full journey | Home, sign-in (Google button after client navigation), audio + gait submissions, rejection, history, delete, progress, live Mumbai search (37 listings), guide mic check, analytics redirect: **0 console errors** |

`tests/test_research_foundation.py` (root) has a pre-existing import error (`generate_comparison` missing from `plot_comparison.py`). Its voice-model tests were updated and pass when run in isolation.

---

## 17. Limitations and ethics

1. **Small, non-representative data.** The audio model uses 78 people from one dataset (one country, phone channel). There are no Indian-language or Indian-population recordings.
2. **Modest accuracy.** AUC ~0.78. About 1 in 8 healthy people get “Detected” and 15% of PD get “Not detected”. It is a screening aid only.
3. **Age confound** in the training data. Mitigated by weighting and checked in an age-matched subgroup (n = 45, only 9 healthy, so the estimate is noisy).
4. **No clinical or external prospective validation.** Microphones and rooms differ from the training conditions.
5. **Severity estimate** is not better than the average for new people.
6. **Severity-with-gait model** pairs different people via the target variable. It is not multimodal evidence.
7. **Combined voice + gait screening** accuracy is simulated by pairing different people from the same group. It assumes voice and gait errors are independent and has not been measured on people who gave both.
8. **RPDE/DFA/PPE implementations** are not calibrated.
9. **Medication state, language and disease stage** are not modelled.
10. **Ethics.** Explicit consent, no diagnosis claims, error rates shown, data private to the account, deletion supported, helplines shown, and results never fabricated (failed analyses are saved without scores).

---

## 18. Viva preparation: likely questions and answers

**Q: Why voice for Parkinson's?**
Hypokinetic dysarthria appears in up to ~90% of people with PD and can be early. It shows up as reduced loudness, breathiness, monotone pitch and irregular phonation. A sustained vowel isolates phonation from language, so it suits a language-independent tool for India.

**Q: What is jitter / shimmer / HNR?**
Jitter is cycle-to-cycle variation in pitch period, shimmer in amplitude, and HNR is the harmonic energy relative to noise. They come from Praat on a steady vowel.

**Q: What is CPPS and why did it matter?**
Cepstral peak prominence (smoothed) measures how clearly periodic the voice is. It is robust to recording conditions and a standard dysphonia marker. In the phone data it was 12.6 dB (healthy) vs 10.3 dB (PD).

**Q: Why two screening models?**
Features from lab microphones (Little/Sakar) and from phone audio behave differently. The lab model scored AUC 0.475 on phone audio processed by the app. Typed lab values use the lab model; recordings use the audio model trained on audio processed by the same extractor.

**Q: How did you avoid data leakage?**
All splits are by speaker/subject (StratifiedGroupKFold / GroupKFold). The Iyer data has one recording per person. Scalers sit inside pipelines fitted on training folds. I also showed that the inherited fusion result (R² 0.91) was leakage: it falls to 0.25 when subjects are held out.

**Q: What does voice + gait give that voice alone does not?**
One combined verdict. A gait model (SVM on stride-timing variability and asymmetry, AUC 0.80 on 165 people) and the voice model each produce a probability, and the report averages them. In simulation the combination reaches AUC 0.84 vs 0.77 for either alone, detecting about 66% of PD instead of 55% at the same ~14% false-alarm rate.

**Q: Why not train one model on voice and gait together?**
No public dataset has both from the same people. The old fusion network paired different people by UPDRS score (leakage). Late fusion keeps each model honest on correctly labelled data. The trade-off is that the combined accuracy is a simulation assuming independent errors.

**Q: Why do you say “participant” instead of “patient”?**
Results are not verified by a clinician, so the person assessed is a research participant, not a diagnosed patient.

**Q: Why three tiers instead of yes/no?**
A single threshold forces a trade-off: at 0.5 about 30% of healthy people are flagged. Tiers report only confident results and send borderline ones to re-recording or a clinician. Each tier's error rate is printed on the report.

**Q: Why random forest for audio but logistic regression for lab features?**
For lab features, logistic regression on log features generalised best across datasets (0.831 / 0.732). For the 28 spectral features with age weighting, RF gave the best age-matched AUC with near-zero age correlation (0.772 / −0.02).

**Q: How did you handle the age confound?**
Age alone gave AUC 0.873. I used inverse-probability age-balancing weights per decade, evaluated on the age ≥ 55 subgroup (0.765), and checked that scores do not correlate with age in healthy speakers (−0.029).

**Q: Why is the UPDRS estimate shown only when Detected?**
The regressor was trained only on people with PD, so outputs for healthy voices are meaningless. In one test, a healthy profile produced 36.9 (“Moderate”). It is also no better than the mean (MAE 6.95 vs 7.13).

**Q: What are AUC, sensitivity and specificity?**
AUC is the probability that a random PD case scores higher than a random healthy one (0.5 = chance, 1 = perfect). Sensitivity is the fraction of PD flagged; specificity is the fraction of healthy correctly cleared.

**Q: How does audio get from browser to model?**
MediaRecorder → Web Audio decode → mono 16 kHz WAV → upload → quality gates (steady segment ≥ 1.5 s, SNR ≥ 15 dB) → Praat features + 28 spectral features (0–4 kHz) → models → stored record → report.

**Q: Why OpenStreetMap?**
It is free, open (ODbL), has no API key, and covers India. Nominatim is used with a healthcare-type filter because the public Overpass servers were overloaded. The app follows OSM usage policy (User-Agent, 1 request/s, caching).

**Q: Biggest limitation / future work?**
Small, non-Indian training data. Future work: collect consented Indian recordings (multiple languages, smartphones), prospective clinical validation with neurologist diagnosis, repeated recordings per person (average over takes), calibrated RPDE/DFA/PPE, same-person voice + gait data, and on-device inference for privacy.

**Q: What did you add beyond the original project?**
See §6: gait screening model and combined voice + gait verdict; browser audio conversion; extractor fixes; quality gates; two new screening models with tiers; new datasets (Sakar, Iyer); age-confound handling; leakage audit; formal report/PDF; delete; Progress; Indian care finder with map; recording guide with mic check; branding/UI; and tests (32 + 22).

---

## 19. Research paper guidance

**Suggested title:** “Smartphone-Grade Voice Screening for Parkinson's Disease: Cross-Dataset Evaluation, Age-Confound Control and a Deployed Web Portal for India”.

**Defensible contributions**

1. Evidence that classic jitter/shimmer/HNR features generalise across *lab* datasets (AUC 0.83 / 0.73) but fail on *phone* audio processed by an open pipeline (AUC 0.475).
2. Spectral/cepstral features (MFCC variability, CPPS, pitch SD) restore discrimination on phone audio (AUC 0.78; 0.77 age-matched) with explicit age-confound control.
3. A three-tier decision scheme with per-tier error rates for responsible screening.
4. A leakage audit showing how a random split inflates multimodal regression (R² 0.91 → 0.25).
5. An open, reproducible end-to-end system (quality gating, reporting, care discovery for India).

**Suggested structure:** Abstract · Introduction (PD burden, voice biomarkers, access in India) · Related work (Little 2009, Tsanas 2010, Sakar 2019, Iyer 2023) · Data (Table §10) · Methods (pipeline §7, features §8, models §9, protocols, age weighting, tiers) · Results (Tables §11.3, §11.4, §11.5, §11.6) · System (architecture §4) · Discussion (channel effects, confounds, leakage) · Limitations (§17) · Conclusion.

**Recommended figures/tables:** ROC curves per model; tier distribution bar chart; age-confound table; leakage table; architecture diagram; report screenshot.

**Claims to avoid:** “diagnoses Parkinson's”, “90% accuracy”, “multimodal fusion improves prediction” (not supported after the leakage audit), “clinically validated”.

---

## 20. Glossary

| Term | Meaning |
|---|---|
| PD | Parkinson's disease |
| UPDRS / MDS-UPDRS | (Movement Disorder Society) Unified Parkinson's Disease Rating Scale; Part III = motor exam |
| Sustained phonation | Holding a vowel (“aaah”) steadily |
| f0 | Fundamental frequency (pitch) |
| MFCC | Mel-frequency cepstral coefficients (spectral envelope / timbre) |
| CPPS | Cepstral peak prominence, smoothed |
| LTAS | Long-term average spectrum |
| SNR | Signal-to-noise ratio |
| AUC / ROC | Area under the receiver-operating-characteristic curve |
| Grouped CV | Cross-validation where all recordings of a person stay in the same fold |
| Leakage | Test information (same person / target) influencing training |
| Confound | A variable (e.g. age) related to both input and label that can fake accuracy |
| Inverse-probability weighting | Re-weighting samples so classes share a covariate distribution |
| ODbL | Open Database Licence (OpenStreetMap) |

---

## 21. References

1. Little MA, McSharry PE, Roberts SJ, Costello DAE, Moroz IM. Exploiting nonlinear recurrence and fractal scaling properties for voice disorder detection. *BioMedical Engineering OnLine*, 2007; 6:23.
2. Little MA, McSharry PE, Hunter EJ, Spielman J, Ramig LO. Suitability of dysphonia measurements for telemonitoring of Parkinson's disease. *IEEE Transactions on Biomedical Engineering*, 2009; 56(4):1015–1022.
3. Tsanas A, Little MA, McSharry PE, Ramig LO. Accurate telemonitoring of Parkinson's disease progression by noninvasive speech tests. *IEEE Transactions on Biomedical Engineering*, 2010; 57(4):884–893.
4. Sakar CO, Serbes G, Gunduz A, et al. A comparative analysis of speech signal processing algorithms for Parkinson's disease classification and the use of the tunable Q-factor wavelet transform. *Applied Soft Computing*, 2019; 74:255–263. (UCI dataset 470, CC BY 4.0)
5. Iyer A, et al. A machine learning method to process voice samples for identification of Parkinson's disease. *Scientific Reports*, 2023. Data: figshare doi:10.6084/m9.figshare.23849127 (CC BY 4.0).
6. Goldberger AL, et al. PhysioBank, PhysioToolkit, and PhysioNet. *Circulation*, 2000; 101(23):e215–e220. Dataset: “Gait in Parkinson's Disease” (Hausdorff et al.).
7. Martínez-Martín P, Rodríguez-Blázquez C, et al. Parkinson's disease severity levels and MDS-Unified Parkinson's Disease Rating Scale. *Parkinsonism & Related Disorders*, 2015; 21(1):50–54.
8. Boersma P, Weenink D. *Praat: doing phonetics by computer* (software).
9. Jadoul Y, Thompson B, de Boer B. Introducing Parselmouth: A Python interface to Praat. *Journal of Phonetics*, 2018; 71:1–15.
10. Hillenbrand J, Houde RA. Acoustic correlates of breathy vocal quality: dysphonic voices and continuous speech. *Journal of Speech and Hearing Research*, 1996; 39:311–321.
11. OpenStreetMap contributors. OpenStreetMap data, Open Database Licence (ODbL); Nominatim and Overpass API usage policies.

*Check each reference's exact page and article numbers against the publisher before submitting the paper.*
