# Morrow — Parkinson’s Assessment & Monitoring Platform

Morrow is a unified research and monitoring portal for organizing voice and optional gait-data submissions, assessment history, reports, and progress analytics. It has one account model; there are no doctor/patient roles.

> **Medical disclaimer:** Morrow is not a medical device. It does not diagnose Parkinson’s disease, provide medical advice, or replace care from a qualified clinician. Do not use it to make treatment decisions. Speak with a healthcare professional about health concerns.

## Current capabilities and limits

- Public education pages, account registration/sign-in, protected account pages, and Google OpenID Connect sign-in (when configured).
- Consent-gated voice recording/upload and manual vocal feature entry using the exact 16-column order in `scripts/feature_contract.py`, plus validated CSV/TXT gait file upload with a preview.
- A FastAPI API stores user accounts, expiring sessions, consent metadata, assessment records, and uploaded files in local SQLite/filesystem storage. Assessment history and dashboard counts are account-scoped.
- The frontend calls the API for authentication, manual feature submission/history, reports, dashboard data, analytics, and specialist search. Loading, session-expiration, request-error, empty, and unavailable states are surfaced explicitly.
- Research artifacts are generated locally and excluded from Git. Voice-only recordings are decoded to mono 16 kHz PCM, extracted with `praat-parselmouth` plus SciPy RPDE/DFA/PPE implementations, strictly validated, and scored only when the exact artifact/scaler contract succeeds. The precomputed endpoint still accepts exactly 16 already-computed acoustic values and returns an exploratory `motor_UPDRS` estimate marked non-diagnostic. Gait uploads must contain at least 200 numeric rows and exactly 19 columns in the dataset order; inference deterministically selects the first 200 rows and uses the eight left/right sensor columns without additional gait normalization. Fusion remains unavailable in this checkout because `models/fusion_model.pt` and `models/fusion_vocal_scaler.joblib` are absent; records explain that exact blocker instead of fabricating a score.
- Specialist search uses public OpenStreetMap community data: Nominatim geocodes a manually entered city/postal code, and Overpass returns nearby, specialty-tagged listings within the chosen radius. Optional browser geolocation sends coordinates only after the user requests it. Results include OpenStreetMap links and attribution; unknown locations return an empty result and service failures return an explicit unavailable state. No provider listings are fabricated.
- No camera-based gait assessment, cloud-only services, clinical diagnosis, or disease staging is implemented.

## Local setup

Requirements: Python 3.11+ is recommended (the API tests also pass on Python 3.9, but that runtime is end-of-life and emits a Google-auth support warning) and Node.js 20.9+ with npm. For an API-only setup, install only the backend requirements; the root `requirements.txt` also includes the existing research/ML stack.

### 1. Start the API

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements-dev.txt

# Run the versioned SQLite schema migration (also applied on API startup).
python -m backend.migrate

# Optional: export a matching Google OAuth web-client ID to enable Google sign-in.
export GOOGLE_CLIENT_ID=""
export FRONTEND_ORIGINS="http://localhost:3000"
# Identify this installation in OpenStreetMap requests; a contact email is recommended.
export OSM_USER_AGENT="MorrowResearchPortal/1.0"
export OSM_CONTACT_EMAIL=""
uvicorn backend.app:app --reload --host 0.0.0.0 --port 8000
```

The API is available at `http://localhost:8000`; its OpenAPI page is at `/docs`. By default it creates `backend/.data/portal.sqlite3` and stores uploads under `backend/uploads/`. Set `APP_DATA_DIR` and `APP_UPLOAD_DIR` to change those locations. These local files are ignored by Git.

For automatic extraction, use a 3–60 second single-speaker recording with clear sustained voicing and no intentional clipping. WAV works without external codecs; install `ffmpeg` and ensure it is on `PATH` for WebM, OGG, MP3, or M4A uploads. The extractor resamples to mono 16 kHz. Browser recordings with silence, excessive noise, clipping, unsupported codecs, or insufficient stable voicing are retained as validation-required records rather than scored.

### Generate local research artifacts

Use the included research dataset and scripts to create the ignored artifacts locally:

```bash
# Install the research stack from the repository root.
python -m pip install -r requirements.txt

# Generates models/baseline_rf_model.pkl and models/baseline_rf_metrics.json.
python -m scripts.train_vocal

# Optional, computationally heavier research experiment. Generates
# fusion_model.pt, fusion_vocal_scaler.joblib, and fusion_metrics.json.
python -m scripts.train_fusion
```

`models/` is excluded from Git. The voice trainer saves the fitted scaler, exact 16-feature order, and model metadata together in `baseline_rf_model.pkl`, which is the portal's expected artifact format. Set `MODEL_ARTIFACTS_DIR` if artifacts are stored elsewhere; the default is the repository's `models/` directory. Train and serve with compatible Python, scikit-learn, and joblib environments, and only load artifacts generated from trusted local sources because joblib files are executable serialized objects.

The precomputed inference endpoint requires an authenticated JSON request containing both `feature_columns` and `features`; the column names and numeric values must each match the exact order defined in `scripts/feature_contract.py`. It rejects missing, reordered, non-finite, or incompatible values and returns only a research estimate, not a diagnosis. WAV is decoded in-process; WebM/OGG/MP3/M4A require an installed `ffmpeg`. Missing decoders, short/silent/clipped recordings, failed nonlinear validation, missing artifacts, and incompatible artifacts are persisted as explicit validation-required/unavailable records with no fabricated score. Extracted feature rows, extractor version, and signal-quality metadata are retained only after complete feature validation.

### 2. Start the frontend

In another terminal:

```bash
cd frontend
npm install
cp ../.env.example .env.local
# Edit .env.local: set NEXT_PUBLIC_API_URL=http://localhost:8000.
npm run dev
```

Open `http://localhost:3000`. `NEXT_PUBLIC_GOOGLE_CLIENT_ID` in `frontend/.env.local` must match the backend `GOOGLE_CLIENT_ID` to show Google sign-in.

## Google OAuth setup

1. Create a **Web application** OAuth client in the Google Cloud Console and configure its consent screen.
2. Add the exact frontend origin (for example, `http://localhost:3000`) under **Authorized JavaScript origins**. The current Google Identity Services popup flow does not use an OAuth redirect URI; do not add one for this flow.
3. Set the same web-client ID as `GOOGLE_CLIENT_ID` in the API environment and `NEXT_PUBLIC_GOOGLE_CLIENT_ID` in the frontend environment. Add each production frontend origin to Google’s authorized JavaScript origins and to the API’s comma-separated `FRONTEND_ORIGINS`. The client ID is public; never expose a client secret in frontend code.
4. The browser supplies a Google ID credential; the API verifies its signature, audience, expiry, issuer, and verified email with Google’s auth library before issuing a portal session. Email/password sign-in and registration remain available when these optional IDs are unset.

## OpenStreetMap specialist search

Specialist search uses the public Nominatim geocoder and Overpass API without an API key or paid service. Nominatim requests are rate-limited to at most one per second and cached per API process; nearby-provider responses are cached for 15 minutes. Requests have a finite timeout, and provider failures are shown as unavailable rather than replaced with sample results. Set `OSM_USER_AGENT` to a descriptive application/version identifier and, preferably, `OSM_CONTACT_EMAIL` to an operator email as recommended by Nominatim’s usage policy. Public OSM services can be temporarily unavailable or impose their own fair-use limits; deployments needing higher volume should use a self-hosted service or a provider that permits the intended usage.

Listings are based on community-entered specialty tags and may be incomplete or out of date. Results are not endorsements or a substitute for confirming services with a provider. Display the included OpenStreetMap attribution and copyright link whenever results are shown. Manual city/postal-code search is always available; optional browser geolocation is requested only after the user activates it.

## Migrations and persistence

SQLite schema migrations are versioned in `backend/migrations/` and tracked with SQLite `user_version`. The startup migration runner applies all pending migrations in order and rejects gaps; run `python -m backend.migrate` before starting the API if desired. Assessment and report/history queries are scoped to the authenticated account, with SQLite indexes for owner/date and owner/status/date lookups. Back up both the configured database directory and upload directory. There is no remote storage, account recovery, email verification, or account deletion flow in this research prototype.

## Docker

With Docker Compose installed, copy `.env.example` to `.env`, set the OAuth client ID if desired, then run:

```bash
docker compose up --build
```

The API is published at `http://localhost:8000` and the frontend at `http://localhost:3000`. Compose persists SQLite data and uploaded files in named local volumes. The frontend API URL and public Google client ID are build arguments, so rebuild the frontend after changing them. This is a local container setup, not cloud infrastructure.

Compose mounts the host `models/` directory read-only into the API container. Generate the artifacts on the host with the commands above before or after starting Compose; `/api/models/status` will report their availability without copying model binaries into the image.

## Tests, lint, typecheck, and build

```bash
# Backend API/auth/persistence/upload tests
source .venv/bin/activate
pytest backend/tests

# Research split, scaling, artifact, and inference-contract tests
python -m pytest tests -q

# Frontend (from frontend/)
npm run lint
npm run typecheck
npm run test:run
npm run build
```

Tests use mocked browser devices and local temporary databases; they do not need user data, OAuth credentials, model files, or provider credentials.

## Scientific limitations and data sources

The bundled datasets and training scripts support research experimentation only. The existing voice scripts use tabular acoustic features, and the multimodal script trains on prepared vocal and sensor data. A microphone recording uploaded by this portal is not equivalent to those preprocessed inputs. The training schema is exactly `Jitter(%)`, `Jitter(Abs)`, `Jitter:RAP`, `Jitter:PPQ5`, `Jitter:DDP`, `Shimmer`, `Shimmer(dB)`, `Shimmer:APQ3`, `Shimmer:APQ5`, `Shimmer:APQ11`, `Shimmer:DDA`, `NHR`, `HNR`, `RPDE`, `DFA`, and `PPE` in that order. Praat-compatible measures and the documented recurrence-entropy, detrended-fluctuation, and pitch-period-entropy formulas are engineering implementations, not clinical validation; deterministic reference fixtures and independent participant-level validation are still required. Training metrics or dataset labels must not be interpreted as clinical performance. No included result establishes diagnostic accuracy or clinical utility.

- The vocal UPDRS baseline and the drawing-image trainer use participant-grouped splits. The vocal `StandardScaler` is fitted only on training participants and saved with the model. The drawing trainer's `testing/` images are excluded from fitting and validation; the provided train/test directories overlap by participant, so that directory is not an independent external test set.
- The gait-fusion trainer groups by the mapped motor participant and fits/saves its vocal scaler on training samples only. Vocal and gait records originate in separate cohorts without verified shared identities: `scripts/dataset_alignment.py` matches them approximately by age and UPDRS values. This is artificial pairing, not same-person multimodal evidence, and does not support clinical or independent-cohort claims.
- `scripts/fusion_engine.py` aligns different datasets by class instead of verified identity; its results are not subject-level multimodal evaluation. The checked-in example metric chart and generated meta-learner features were removed. `scripts/plot_comparison.py` now requires actual metrics from completed training runs rather than embedding fixed scores.
- CNN and gait-fusion training remain research experiments. The baseline model's completed subject-held-out run in this checkout had negative R², so it does not demonstrate useful prediction. No result establishes clinical validity, generalization to new populations, or benefit from fusion.

The scripts do not implement validated camera-based gait capture or inference. This portal is not for diagnosis, screening, or treatment decisions; consult a qualified healthcare professional for medical advice. Training drawing CNNs may download ImageNet weights; CNN and fusion training can be computationally expensive.

## Future camera-gait roadmap

Camera-based capture is not implemented. Any future work should remain optional
and require explicit, per-session consent; visible recording controls and
preview/deletion; local-first processing without sending video to a third party;
documented retention limits; accessibility review; and independent,
participant-level scientific validation before showing any analysis. Until
those safeguards and validation exist, voice/gait submissions remain
unscored records and camera capture stays unavailable.

Educational links shown in the app point to the [U.S. National Institute of Neurological Disorders and Stroke](https://www.ninds.nih.gov/health-information/disorders/parkinsons-disease), [Parkinson’s Foundation](https://www.parkinson.org/understanding-parkinsons), [World Health Organization](https://www.who.int/news-room/fact-sheets/detail/parkinson-disease), and [NHS](https://www.nhs.uk/conditions/parkinsons-disease/). They are independent sources, not providers or endorsements.

## Repository layout

- `frontend/` — Next.js App Router, accessible responsive UI, real API client, and Vitest/Testing Library tests.
- `backend/` — FastAPI service, SQLite migration, upload validation, and API tests.
- `scripts/`, `data/`, `models/` — existing research tooling/data; generated model binaries are not committed.
