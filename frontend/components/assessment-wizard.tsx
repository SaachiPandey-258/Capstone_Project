"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { hasValidFusionInputs, previewGaitText, validateGaitFile, validateVoiceDuration, validateVoiceFile } from "@/lib/assessment";
import type { Assessment } from "@/lib/types";
import { ErrorMessage } from "@/components/ui";
import { ReportView } from "@/components/report-view";

const MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];

export function AssessmentWizard() {
  const [consent, setConsent] = useState(false);
  const [modality, setModality] = useState<"voice" | "voice_gait">("voice");
  const [recording, setRecording] = useState(false);
  const [permissionPending, setPermissionPending] = useState(false);
  const [voice, setVoice] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [voiceError, setVoiceError] = useState("");
  const [recorderError, setRecorderError] = useState("");
  const [gait, setGait] = useState<File | null>(null);
  const [gaitPreview, setGaitPreview] = useState<string[][]>([]);
  const [gaitError, setGaitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [result, setResult] = useState<Assessment | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const audioUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => {
      const seconds = Math.min(60, Math.floor((Date.now() - startedAtRef.current) / 1000));
      setElapsed(seconds);
      if (seconds >= 60 && recorderRef.current?.state === "recording") recorderRef.current.stop();
    }, 250);
    return () => window.clearInterval(timer);
  }, [recording]);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
  }, []);

  function resetVoice() {
    if (recording) recorderRef.current?.stop();
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = null;
    setAudioUrl(null);
    setVoice(null);
    setDuration(0);
    setElapsed(0);
    setVoiceError("");
    setRecorderError("");
  }

  async function startRecording() {
    setRecorderError("");
    setVoiceError("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setRecorderError("This browser does not support microphone recording. Try a recent version of Chrome, Firefox, or Safari.");
      return;
    }
    setPermissionPending(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        const seconds = Math.min(60, Math.max(0, Math.floor((Date.now() - startedAtRef.current) / 1000)));
        setDuration(seconds);
        setElapsed(seconds);
        const type = recorder.mimeType || "audio/webm";
        const extension = type.includes("ogg") ? "ogg" : type.includes("mp4") ? "m4a" : type.includes("wav") ? "wav" : "webm";
        const recordingFile = new File(chunksRef.current, `voice-recording.${extension}`, { type });
        if (recordingFile.size > 0) {
          if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
          audioUrlRef.current = URL.createObjectURL(recordingFile);
          setAudioUrl(audioUrlRef.current);
          setVoice(recordingFile);
          setVoiceError(validateVoiceFile(recordingFile) || validateVoiceDuration(seconds) || "");
        } else {
          setRecorderError("No audio was captured. Please try recording again.");
        }
        setRecording(false);
      };
      startedAtRef.current = Date.now();
      recorder.start();
      setRecording(true);
    } catch (caught) {
      const name = caught instanceof DOMException ? caught.name : "";
      setRecorderError(name === "NotAllowedError" || name === "PermissionDeniedError"
        ? "Microphone permission was denied. Allow microphone access in your browser settings to record."
        : "The microphone could not be opened. Check that it is connected and try again.");
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    } finally {
      setPermissionPending(false);
    }
  }

  async function selectGait(file: File | undefined) {
    setGaitPreview([]);
    if (!file) {
      setGait(null);
      setGaitError("");
      return;
    }
    const fileError = validateGaitFile(file);
    if (fileError) {
      setGait(null);
      setGaitError(fileError);
      return;
    }
    try {
      const preview = previewGaitText(await file.text(), file.name);
      if (preview.error) {
        setGait(null);
        setGaitError(preview.error);
      } else {
        setGait(file);
        setGaitPreview(preview.rows);
        setGaitError("");
      }
    } catch {
      setGait(null);
      setGaitError("The selected file could not be read. Choose a readable CSV or TXT file.");
    }
  }

  const canSubmit = consent && !recording && !permissionPending
    && hasValidFusionInputs(modality, voice, duration, gait, gaitError) && !submitting;

  async function submit() {
    if (!canSubmit || !voice) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      const form = new FormData();
      form.append("consent", "true");
      form.append("modality", modality);
      form.append("duration_seconds", String(duration));
      form.append("voice", voice, voice.name);
      if (modality === "voice_gait" && gait) form.append("gait", gait, gait.name);
      setResult(await api.submitAssessment(form));
    } catch (caught) {
      setSubmitError(caught instanceof ApiError ? caught.message : "The assessment could not be uploaded. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <section className="submission-result" aria-live="polite">
        {result.status === "completed" && result.result ? (
          <>
            <span className="status-pill status-completed">Analysis completed</span>
            <h2>Your assessment record was saved</h2>
            <ReportView report={result} />
          </>
        ) : <>
        <span className={`status-pill status-${result.status}`}>{result.status === "validation_required" ? "Feature validation required" : result.status === "unavailable" ? "Analysis unavailable" : result.status}</span>
        <h2>Your assessment record was saved</h2>
        <p>{result.status === "validation_required"
          ? "Required audio features have not been validated. No scaler or model inference was run, and no prediction or score was generated."
          : result.status === "processing"
            ? "The analysis service is still processing this assessment."
            : "The analysis service is not currently available for this data. No prediction or score was generated."}</p>
        <div className="result-limit">{result.unavailable_reason}</div>
        </>}
        <p className="record-meta">Record ID: <code>{result.id}</code></p>
        <div className="button-row"><Link className="button" href={`/assessments/${result.id}`}>View saved record</Link><Link className="button button-outline" href="/assessments">Assessment history</Link></div>
      </section>
    );
  }

  return (
    <div className="wizard">
      <section className="wizard-card">
        <div className="wizard-step"><span>01</span><div><h2>Consent and privacy</h2><p>Your files are uploaded to your account. Consent before proceeding is required. You can stop at any time.</p></div></div>
        <label className="check-row"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>I understand this is not a diagnosis or medical advice, and I consent to uploading the selected assessment files.</span></label>
      </section>
      <section className="wizard-card">
        <div className="wizard-step"><span>02</span><div><h2>Choose assessment inputs</h2><p>Choose a single voice assessment or include a valid gait file. A fusion submission is blocked unless both inputs pass validation.</p></div></div>
        <div className="choice-grid">
          <label className={modality === "voice" ? "choice-card selected" : "choice-card"}><input aria-label="Voice-only assessment" type="radio" name="modality" value="voice" checked={modality === "voice"} onChange={() => setModality("voice")} /><span><strong>Voice only</strong><small>One voice recording</small></span></label>
          <label className={modality === "voice_gait" ? "choice-card selected" : "choice-card"}><input aria-label="Voice and gait assessment" type="radio" name="modality" value="voice_gait" checked={modality === "voice_gait"} onChange={() => setModality("voice_gait")} /><span><strong>Voice + gait</strong><small>Both validated inputs required</small></span></label>
        </div>
      </section>
      <section className="wizard-card">
        <div className="wizard-step"><span>03</span><div><h2>Record your voice</h2><p>Use a quiet space. Your browser will ask for microphone access only after you start recording.</p></div></div>
        <div className="recorder-box">
          <div className="recorder-top"><span className={recording ? "record-dot live" : "record-dot"} />{recording ? "Recording" : voice ? "Recording ready to review" : "Microphone not active"}</div>
          <div className="timer" aria-live="polite">{recording ? elapsed : duration}<span> / 60 sec</span></div>
          <div className="button-row">
            {!recording ? <button className="button" type="button" onClick={() => void startRecording()} disabled={permissionPending}>{permissionPending ? "Requesting permission…" : voice ? "Record again" : "Start recording"}</button> : <button className="button button-danger" type="button" onClick={() => recorderRef.current?.stop()}>Stop recording</button>}
            {voice && !recording && (
              <>
                <span className="sr-only">Audio playback only; no transcript is generated.</span>
                {/* eslint-disable-next-line jsx-a11y/media-has-caption -- User recordings are not transcribed or sent to a transcription service. */}
                <audio controls src={audioUrl || undefined} aria-label="Play back your voice recording" />
                <button className="button button-outline" type="button" onClick={resetVoice}>Delete recording</button>
              </>
            )}
          </div>
          <p className="field-hint">Accepted length: 3–60 seconds; supported browser audio formats up to 25 MB. Listen back before uploading.</p>
          {voiceError && <ErrorMessage>{voiceError}</ErrorMessage>}
          {recorderError && <ErrorMessage>{recorderError}</ErrorMessage>}
        </div>
      </section>
      {modality === "voice_gait" && <section className="wizard-card">
        <div className="wizard-step"><span>04</span><div><h2>Select gait data</h2><p>Upload numeric sensor data as CSV or tab-delimited TXT (up to 25 MB). A short preview is shown before upload.</p></div></div>
        <label className="file-picker">Choose gait file<input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={(event) => void selectGait(event.target.files?.[0])} /></label>
        {gait && <p className="file-selected">{gait.name} · {(gait.size / 1024).toFixed(1)} KB</p>}
        {gaitPreview.length > 0 && <div className="preview-wrap"><p className="field-hint">Validated preview (first rows)</p><table className="preview-table"><tbody>{gaitPreview.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={`${index}-${cellIndex}`}>{cell}</td>)}</tr>)}</tbody></table></div>}
        {gaitError && <ErrorMessage>{gaitError}</ErrorMessage>}
      </section>}
      <section className="submission-panel">
        <div><strong>Analysis availability</strong><p>At this time no deployable inference model or voice-processing pipeline is installed. Uploading saves a record, but cannot produce a score.</p></div>
        {submitError && <ErrorMessage>{submitError}</ErrorMessage>}
        <button className="button" type="button" onClick={() => void submit()} disabled={!canSubmit}>{submitting ? "Uploading securely…" : "Submit assessment"}</button>
        {!canSubmit && !submitting && <span className="field-hint">Consent, a valid voice recording{modality === "voice_gait" ? ", and valid gait data" : ""} are required.</span>}
      </section>
    </div>
  );
}
