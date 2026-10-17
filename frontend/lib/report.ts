import type { Assessment, PatientSex, ScreeningErrorRates, ScreeningTier } from "@/lib/types";
import { VOICE_FEATURE_COLUMNS } from "@/lib/assessment";

// Spectral measures behind the audio screening model, shown on reports.
const VOICE_QUALITY_COLUMNS = ["CPPS", "F0 SD (semitones)", "F0 range (semitones)", "Spectral tilt (dB)"];

const SEX_LABELS: Record<PatientSex, string> = {
  female: "Female",
  male: "Male",
  other: "Other",
  prefer_not_to_say: "Prefer not to say",
};

const MODEL_LABELS: Record<string, string> = {
  "random-forest-updrs-v1": "Random forest regressor (voice)",
  "ridge-log-updrs-v2": "Ridge regression on log-scaled Praat measures",
  "dual-branch-fusion-updrs-v1": "Dual-branch fusion network (voice + gait)",
  "logistic-pd-screen-v2": "Logistic regression screening classifier",
  "logistic-pd-screen-v3": "Logistic regression on lab voice measures (284 speakers)",
  "rf-spectral-pd-screen-v4": "Random forest on spectral voice measures (phone recordings)",
  "svm-gait-pd-screen-v1": "SVM on stride-timing gait measures (165 people)",
  "late-fusion-mean-v1": "Combined voice + gait (average of both model probabilities)",
};

export function reportNumber(report: Assessment) {
  return `PD-${report.id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

export function formatDateTime(value: string) {
  return new Date(value).toLocaleString(undefined, {
    year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export function modelLabel(model: unknown) {
  return typeof model === "string" ? MODEL_LABELS[model] ?? model : "—";
}

export function participantRows(report: Assessment): [string, string][] {
  const patient = report.patient;
  return [
    ["Name", patient?.full_name || "Not recorded"],
    ["Age", patient?.age != null ? `${patient.age} years` : "Not recorded"],
    ["Sex", patient?.sex ? SEX_LABELS[patient.sex] : "Not recorded"],
    ["Location", patient?.location || "Not recorded"],
  ];
}

export function assessmentRows(report: Assessment): [string, string][] {
  const fromAudio = report.files.some((file) => file.kind === "voice");
  return [
    ["Date", formatDateTime(report.created_at)],
    ["Assessment", report.modality === "voice_gait" ? "Voice + gait" : "Voice only"],
    ["Voice input", fromAudio ? `Recording (${report.duration_seconds} s)` : "Feature values"],
    ...gaitSourceRow(report),
  ];
}

const SHORT_MODEL_NAMES: Record<string, string> = {
  "rf-spectral-pd-screen-v4": "voice (spectral, phone-trained)",
  "logistic-pd-screen-v3": "voice (lab measures)",
  "svm-gait-pd-screen-v1": "gait (stride timing)",
};

/** Short bullet notes for the end of the report. */
export function reportNotes(report: Assessment, findings: Findings): string[] {
  const result = report.result;
  const models = result?.screening_basis === "voice_gait" && result.voice_screening && result.gait_screening
    ? `${SHORT_MODEL_NAMES[result.voice_screening.model] ?? result.voice_screening.model} + ${SHORT_MODEL_NAMES[result.gait_screening.model] ?? result.gait_screening.model}, averaged`
    : SHORT_MODEL_NAMES[result?.screening_model ?? ""] ?? result?.screening_model ?? "unavailable";
  const notes = [
    "Research screening only — not a diagnosis and not clinically validated.",
    "About 1 in 7 healthy people receive “Detected”, and about 1 in 7 people with Parkinson’s receive “Not detected”.",
  ];
  if (findings.tier === "detected") {
    notes.push(`Severity is an indicative motor UPDRS (Part III) estimate${findings.mae ? ` (± ${findings.mae.toFixed(0)} points)` : ""}: mild ≤ 32, moderate 33–58, severe ≥ 59.`);
  }
  notes.push(`Screening model: ${models}.`);
  return notes;
}

export function reportTitle(report: Assessment) {
  return report.modality === "voice_gait" ? "Voice & Gait Screening Report" : "Voice Screening Report";
}

export type Findings = {
  score: number;
  max: number;
  mae: number | null;
  band: string;
  tier: ScreeningTier | null;
  probability: number | null;
  low: number;
  high: number;
  errorRates: ScreeningErrorRates | null;
  verdict: string;
  headline: string;
  interpretation: string;
  reliability: string | null;
  combined: boolean;
  parts: { label: string; probability: number; tier: ScreeningTier; low: number; high: number }[];
  gaitNote: string | null;
};

const TIER_LABELS: Record<ScreeningTier, string> = {
  detected: "Detected",
  inconclusive: "Inconclusive",
  not_detected: "Not detected",
};

export function tierLabel(tier: ScreeningTier) {
  return TIER_LABELS[tier];
}

const pct = (value: number) => `${Math.round(value * 100)}%`;

export function reportFindings(report: Assessment): Findings | null {
  const result = report.result;
  if (!result || typeof result.prediction !== "number") return null;
  const score = result.prediction;
  const max = typeof result.updrs_scale_max === "number" ? result.updrs_scale_max : 108;
  const mae = typeof result.prediction_mae === "number" ? result.prediction_mae : null;
  const band = result.severity_band ?? (score <= 32 ? "Mild" : score <= 58 ? "Moderate" : "Severe");
  const probability = typeof result.pd_probability === "number" ? result.pd_probability : null;
  // Records created before three-tier screening only carry a single threshold.
  const legacyThreshold = typeof result.pd_threshold === "number" ? result.pd_threshold : 0.5;
  const low = typeof result.pd_low_threshold === "number" ? result.pd_low_threshold : legacyThreshold;
  const high = typeof result.pd_high_threshold === "number" ? result.pd_high_threshold : legacyThreshold;
  const tier: ScreeningTier | null = result.screening_tier
    ?? (typeof result.pd_detected === "boolean" ? (result.pd_detected ? "detected" : "not_detected") : null);
  const errorRates = result.screening_error_rates ?? null;
  const p = probability === null ? "" : ` (model probability ${pct(probability)})`;
  const severity = `The estimated motor UPDRS (Part III) score is ${score.toFixed(1)}${mae ? ` ± ${mae.toFixed(0)}` : ""}, in the ${band.toLowerCase()} band; this estimate is indicative only.`;
  let verdict = "Unavailable";
  let headline = "Screening unavailable";
  let interpretation = severity;
  let reliability: string | null = null;
  if (tier === "detected") {
    verdict = "Detected";
    headline = "Voice markers associated with Parkinson’s detected";
    interpretation = `The screening model found acoustic markers associated with Parkinson’s disease${p}. ${severity} A clinical assessment is recommended to interpret this result.`;
    if (errorRates?.healthy_detected != null && errorRates.pd_detected != null) {
      reliability = `In testing, ${pct(errorRates.pd_detected)} of people with Parkinson’s and ${pct(errorRates.healthy_detected)} of healthy people got this result.`;
    }
  } else if (tier === "not_detected") {
    verdict = "Not detected";
    headline = "No voice markers associated with Parkinson’s detected";
    interpretation = `The screening model did not find acoustic markers associated with Parkinson’s disease${p}. The severity estimate is not applicable without detected markers. A voice screen cannot rule out Parkinson’s; consult a clinician about any symptoms.`;
    if (errorRates?.healthy_not_detected != null && errorRates.pd_not_detected != null) {
      reliability = `In testing, ${pct(errorRates.healthy_not_detected)} of healthy people and ${pct(errorRates.pd_not_detected)} of people with Parkinson’s got this result.`;
    }
  } else if (tier === "inconclusive") {
    verdict = "Inconclusive";
    headline = "Voice markers are borderline";
    interpretation = `The screening result falls between the decision thresholds${p}, so the voice sample does not support either conclusion. Record again in a quiet room, or discuss any symptoms with a clinician. The severity estimate is not applicable to an inconclusive screen.`;
    if (errorRates?.healthy_inconclusive != null && errorRates.pd_inconclusive != null) {
      reliability = `In testing, ${pct(errorRates.pd_inconclusive)} of people with Parkinson’s and ${pct(errorRates.healthy_inconclusive)} of healthy people got this result.`;
    }
  }
  const voicePart = result.voice_screening;
  const gaitPart = result.gait_screening;
  const combined = result.screening_basis === "voice_gait" && Boolean(voicePart && gaitPart);
  const parts = combined && voicePart && gaitPart ? [
    { label: "Voice", probability: voicePart.probability, tier: voicePart.tier, low: voicePart.low_threshold, high: voicePart.high_threshold },
    { label: "Gait", probability: gaitPart.probability, tier: gaitPart.tier, low: gaitPart.low_threshold, high: gaitPart.high_threshold },
  ] : [];
  if (combined && voicePart && gaitPart) {
    headline = headline.replace("Voice markers", "Voice and gait markers").replace("No voice markers", "No voice or gait markers").replace("Voice markers are borderline", "Voice and gait markers are borderline");
    if (reliability) {
      reliability = reliability
        .replace(/^In testing,/, "In simulated testing,")
        .replace("healthy speakers", "healthy people");
    }
    const combinedText = interpretation
      .replace("The screening model found acoustic markers", "The combined screening found voice and gait markers")
      .replace("The screening model did not find acoustic markers", "The combined screening did not find voice or gait markers")
      .replace("A voice screen cannot rule out", "A screen cannot rule out");
    interpretation = `This result combines the voice model (${pct(voicePart.probability)}) and the gait model (${pct(gaitPart.probability)}) by averaging their probabilities. ${combinedText}`;
  }
  const gaitNote = typeof result.gait_screening_unavailable_reason === "string"
    ? `Gait could not be screened (${result.gait_screening_unavailable_reason}); the result is based on voice only.`
    : null;
  return { score, max, mae, band, tier, probability, low, high, errorRates, verdict, headline, interpretation, reliability, combined, parts, gaitNote };
}

export function featureRows(report: Assessment): [string, string][] {
  const features = report.extracted_features;
  if (!features) return [];
  return [...VOICE_FEATURE_COLUMNS, ...VOICE_QUALITY_COLUMNS]
    .filter((column) => typeof features[column] === "number")
    .map((column) => [column, Number(features[column]).toPrecision(5)]);
}

export const SEVERITY_NOTE = "Severity bands follow published MDS-UPDRS Part III cut-offs (mild ≤ 32, moderate 33–58, severe ≥ 59; Martínez-Martín et al., 2015). They describe motor severity and are not Hoehn & Yahr stages.";

export const LIMITATIONS = "The screening classifier was trained on 951 sustained-vowel recordings from 284 speakers in two research datasets and evaluated on speakers it had not seen; the severity model was trained on 42 people with early-stage Parkinson’s and is no more accurate than the cohort average for new people. With gait data, a separate gait model (165 people) is combined with the voice model by averaging their probabilities; that combination was evaluated by simulation, not on people who gave both. No model is clinically validated, and phone or laptop microphones differ from research recording setups. These are research outputs only — not a diagnosis, clinical score, or substitute for assessment by a qualified clinician.";

export function gaitRows(report: Assessment): [string, string][] {
  const features = report.result?.gait_features;
  if (!features) return [];
  return Object.entries(features).map(([name, value]) => [name, Number(value).toPrecision(4)]);
}

function gaitSourceRow(report: Assessment): [string, string][] {
  const gait = report.files.find((file) => file.kind === "gait");
  if (!gait) return [];
  return [["Walking input", gait.name.startsWith("sample-") ? "Sample recording (PhysioNet dataset)" : "Uploaded recording"]];
}

export const NEXT_STEP_TEXT: Record<ScreeningTier, string> = {
  detected: "See a neurologist and take this report with you.",
  inconclusive: "Record again on another day; see a doctor if it stays inconclusive or you have symptoms.",
  not_detected: "No markers found. A screen cannot rule Parkinson’s out — see a doctor about any symptoms.",
};

export const NEXT_STEP_ANCHOR: Record<ScreeningTier, string> = {
  detected: "detected",
  inconclusive: "inconclusive",
  not_detected: "not-detected",
};
