"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { previewGaitText, validateGaitFile } from "@/lib/assessment";
import type { Assessment, ModelAvailability } from "@/lib/types";
import { ErrorMessage } from "@/components/ui";
import { ReportView } from "@/components/report-view";

const VOICE_FEATURE_COLUMNS = [
  "Jitter(%)", "Jitter(Abs)", "Jitter:RAP", "Jitter:PPQ5", "Jitter:DDP",
  "Shimmer", "Shimmer(dB)", "Shimmer:APQ3", "Shimmer:APQ5", "Shimmer:APQ11",
  "Shimmer:DDA", "NHR", "HNR", "RPDE", "DFA", "PPE",
];

export function AssessmentWizard() {
  const [consent, setConsent] = useState(false);
  const [modality, setModality] = useState<"voice" | "voice_gait">("voice");
  const [values, setValues] = useState<string[]>(() => VOICE_FEATURE_COLUMNS.map(() => ""));
  const [gait, setGait] = useState<File | null>(null);
  const [voice, setVoice] = useState<File | null>(null);
  const [durationSeconds, setDurationSeconds] = useState("5");
  const [gaitPreview, setGaitPreview] = useState<string[][]>([]);
  const [gaitError, setGaitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [result, setResult] = useState<Assessment | null>(null);
  const [availability, setAvailability] = useState<ModelAvailability | null>(null);

  useEffect(() => {
    api.modelAvailability().then(setAvailability).catch(() => setAvailability(null));
  }, []);

  async function selectGait(file: File | undefined) {
    setGaitPreview([]);
    if (!file) { setGait(null); setGaitError(""); return; }
    const fileError = validateGaitFile(file);
    if (fileError) { setGait(null); setGaitError(fileError); return; }
    const preview = previewGaitText(await file.text(), file.name);
    if (preview.error) { setGait(null); setGaitError(preview.error); return; }
    setGait(file); setGaitPreview(preview.rows); setGaitError("");
  }

  const numericValues = values.map(Number);
  const validFeatures = values.every((value) => value.trim() !== "" && Number.isFinite(Number(value)));
  const canSubmit = consent && !gaitError && (modality === "voice" || gait !== null) &&
    (voice !== null || validFeatures) && Number(durationSeconds) >= 3 &&
    Number(durationSeconds) <= 60 && !submitting;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError("");
    const form = new FormData();
    form.append("consent", "true");
    form.append("modality", modality);
    if (voice) {
      form.append("duration_seconds", durationSeconds);
      form.append("voice", voice, voice.name);
      if (gait) form.append("gait", gait, gait.name);
      try { setResult(await api.submitAssessment(form)); }
      catch (caught) { setSubmitError(caught instanceof ApiError ? caught.message : "The assessment could not be submitted."); }
      finally { setSubmitting(false); }
      return;
    }
    form.append("feature_columns", JSON.stringify(VOICE_FEATURE_COLUMNS));
    form.append("features", JSON.stringify(numericValues));
    if (gait) form.append("gait", gait, gait.name);
    try {
      if (modality === "voice") {
        await api.predictVoiceFeatures(VOICE_FEATURE_COLUMNS, numericValues);
      }
      setResult(await api.submitManualAssessment(form));
    } catch (caught) {
      if (modality === "voice" && caught instanceof ApiError && caught.status === 503) {
        try {
          setResult(await api.submitManualAssessment(form));
        } catch (fallback) {
          setSubmitError(fallback instanceof ApiError ? fallback.message : "The assessment could not be saved.");
        }
      } else {
        setSubmitError(caught instanceof ApiError ? caught.message : "The assessment could not be submitted.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return <section className="submission-result" aria-live="polite">
      {result.status === "completed" && result.result ? <><span className="status-pill status-completed">Analysis completed</span><h2>Your assessment record was saved</h2><ReportView report={result} /></> : <><span className="status-pill status-unavailable">Analysis unavailable</span><h2>Your assessment record was saved</h2><p>{result.unavailable_reason}</p></>}
      <p className="record-meta">Record ID: <code>{result.id}</code></p>
      <div className="button-row"><Link className="button" href={`/assessments/${result.id}`}>View saved record</Link><Link className="button button-outline" href="/assessments">Assessment history</Link></div>
    </section>;
  }

  return <div className="wizard">
    <section className="wizard-card">
      <div className="wizard-step"><span>01</span><div><h2>Consent and privacy</h2><p>This exploratory research workflow is not diagnostic or medical advice. Your submitted values are saved to your account.</p></div></div>
      <label className="check-row"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>I understand this is not a diagnosis or medical advice, and I consent to submitting these assessment inputs.</span></label>
    </section>
    <section className="wizard-card">
      <div className="wizard-step"><span>02</span><div><h2>Choose assessment inputs</h2><p>Use either automatic audio extraction or the exact 16-feature manual vocal form. Optional gait scoring requires a validated 200x19 recording and compatible local fusion artifacts.</p></div></div>
      <div className="choice-grid">
        <label className={modality === "voice" ? "choice-card selected" : "choice-card"}><input aria-label="Voice-only assessment" type="radio" name="modality" checked={modality === "voice"} onChange={() => setModality("voice")} /><span><strong>Voice only</strong><small>Manual vocal feature form</small></span></label>
        <label className={modality === "voice_gait" ? "choice-card selected" : "choice-card"}><input aria-label="Voice and gait assessment" type="radio" name="modality" checked={modality === "voice_gait"} onChange={() => setModality("voice_gait")} /><span><strong>Voice + gait</strong><small>Validated fusion when artifacts are available</small></span></label>
      </div>
    </section>
    <section className="wizard-card">
      <div className="wizard-step"><span>03</span><div><h2>Provide voice input</h2><p>Upload a 3–60 second supported recording for automatic extraction, or enter the exact 16-feature contract manually. Audio extraction remains research-only and fails closed on quality or dependency problems.</p></div></div>
      <label className="file-picker">Choose voice recording<input type="file" accept=".webm,.wav,.ogg,.mp3,.m4a,audio/*" onChange={(event) => setVoice(event.target.files?.[0] || null)} /></label>
      {voice && <><p className="file-selected">{voice.name} · {(voice.size / 1024).toFixed(1)} KB</p><label>Recording duration (seconds)<input type="number" min="3" max="60" step="0.1" value={durationSeconds} onChange={(event) => setDurationSeconds(event.target.value)} /></label></>}
      {!voice && <><p className="field-hint">No recording selected. Manual precomputed features remain supported for reproducible research inputs.</p>
      <div className="feature-grid">{VOICE_FEATURE_COLUMNS.map((column, index) => <label key={column}>{column}<input aria-label={column} type="number" step="any" value={values[index]} onChange={(event) => setValues((current) => current.map((value, item) => item === index ? event.target.value : value))} /></label>)}</div>
      </>}
    </section>
    {modality === "voice_gait" && <section className="wizard-card">
      <div className="wizard-step"><span>04</span><div><h2>Select gait data</h2><p>Upload the training contract: at least 200 rows of 19 columns in time, eight left sensors, eight right sensors, and two total-force columns. The first 200 rows are selected deterministically.</p></div></div>
      <label className="file-picker">Choose gait file<input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={(event) => void selectGait(event.target.files?.[0])} /></label>
      {gait && <p className="file-selected">{gait.name} · {(gait.size / 1024).toFixed(1)} KB</p>}
      {gaitPreview.length > 0 && <div className="preview-wrap"><p className="field-hint">Validated preview (first rows)</p><table className="preview-table"><tbody>{gaitPreview.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={`${index}-${cellIndex}`}>{cell}</td>)}</tr>)}</tbody></table></div>}
      {gaitError && <ErrorMessage>{gaitError}</ErrorMessage>}
    </section>}
    <section className="submission-panel"><div><strong>Analysis availability</strong><p>{availability?.voice.artifact_available ? "The local research voice artifact is available for this exact 16-feature input." : "A compatible local voice artifact is not currently available; your submission will be saved as unavailable without a score."} {modality === "voice_gait" && (availability?.fusion.portal_inference_available ? "Validated fusion artifacts are available." : availability?.fusion.reason || "Fusion artifacts are unavailable.")}</p></div>
      {submitError && <ErrorMessage>{submitError}</ErrorMessage>}<button className="button" type="button" onClick={() => void submit()} disabled={!canSubmit}>{submitting ? "Submitting securely…" : "Submit assessment"}</button>
      {!canSubmit && !submitting && <span className="field-hint">Consent, a supported 3–60 second recording or all 16 finite numeric values{modality === "voice_gait" ? ", and a valid gait file" : ""} are required.</span>}
    </section>
  </div>;
}
