"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, AudioLines, FileSpreadsheet, Footprints, Mic, Square, Trash2, Upload } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import {
  parseVoiceFeatureDataset,
  previewGaitText,
  readFileText,
  validateGaitFile,
  validateVoiceDuration,
  validateVoiceFile,
  VOICE_FEATURE_COLUMNS,
  VOICE_FEATURE_GROUPS,
  type VoiceFeatureDatasetRow,
} from "@/lib/assessment";
import { canNormalizeAudio, normalizeToWav } from "@/lib/audio";
import type { Assessment, PatientSex } from "@/lib/types";
import { useAuth } from "@/components/auth-provider";
import { ErrorMessage } from "@/components/ui";
import { GaitInfo } from "@/components/gait-info";

type InputMode = "record" | "upload" | "features";

const LEVEL_BARS = 28;
// Below this RMS (about -34 dBFS) a sustained vowel is usually too close to the
// background noise for reliable perturbation measures.
const QUIET_RMS = 0.02;

function formatClock(seconds: number) {
  const whole = Math.floor(seconds);
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}

export function AssessmentWizard() {
  const { user } = useAuth();
  const router = useRouter();
  const [consent, setConsent] = useState(false);
  const [patientName, setPatientName] = useState(user?.name ?? "");
  const [patientAge, setPatientAge] = useState("");
  const [patientSex, setPatientSex] = useState<PatientSex | "">("");
  const [patientLocation, setPatientLocation] = useState("");
  const [modality, setModality] = useState<"voice" | "voice_gait">("voice");
  const [inputMode, setInputMode] = useState<InputMode>("record");
  const [values, setValues] = useState<string[]>(() => VOICE_FEATURE_COLUMNS.map(() => ""));
  const [datasetRows, setDatasetRows] = useState<VoiceFeatureDatasetRow[]>([]);
  const [datasetName, setDatasetName] = useState("");
  const [datasetError, setDatasetError] = useState("");
  const [selectedDatasetRow, setSelectedDatasetRow] = useState(0);
  const [gait, setGait] = useState<File | null>(null);
  const [voice, setVoice] = useState<File | null>(null);
  const [voiceSource, setVoiceSource] = useState("");
  const [voiceUrl, setVoiceUrl] = useState("");
  const [durationSeconds, setDurationSeconds] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => Array(LEVEL_BARS).fill(0.08));
  const [tooQuiet, setTooQuiet] = useState(false);
  const [recordingError, setRecordingError] = useState("");
  const [gaitPreview, setGaitPreview] = useState<string[][]>([]);
  const [gaitError, setGaitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [result, setResult] = useState<Assessment | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const meterContextRef = useRef<AudioContext | null>(null);
  const meterFrameRef = useRef<number | null>(null);
  const recordingStartedAtRef = useRef(0);
  const recordingTimerRef = useRef<number | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);


  useEffect(() => {
    if (user?.name) setPatientName((current) => current || user.name);
  }, [user?.name]);

  useEffect(() => {
    if (!voice) {
      setVoiceUrl("");
      return;
    }
    const url = URL.createObjectURL(voice);
    setVoiceUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [voice]);

  useEffect(() => () => {
    if (recordingTimerRef.current !== null) window.clearInterval(recordingTimerRef.current);
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    stopMeter();
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  function stopMeter() {
    if (meterFrameRef.current !== null) cancelAnimationFrame(meterFrameRef.current);
    meterFrameRef.current = null;
    void meterContextRef.current?.close().catch(() => undefined);
    meterContextRef.current = null;
    setLevels(Array(LEVEL_BARS).fill(0.08));
    setTooQuiet(false);
  }

  function startMeter(stream: MediaStream) {
    const Context = (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext;
    if (!Context) return;
    try {
      const context = new Context();
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(stream).connect(analyser);
      meterContextRef.current = context;
      const data = new Uint8Array(analyser.fftSize);
      const history: number[] = Array(LEVEL_BARS).fill(0.08);
      const recent: number[] = [];
      const startedAt = performance.now();
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let index = 0; index < data.length; index += 1) sum += ((data[index] - 128) / 128) ** 2;
        history.shift();
        const rms = Math.sqrt(sum / data.length);
        history.push(Math.min(1, 0.08 + rms * 4));
        setLevels([...history]);
        recent.push(rms);
        if (recent.length > 90) recent.shift(); // ~1.5 s at 60 fps
        if (performance.now() - startedAt > 1200) setTooQuiet(Math.max(...recent) < QUIET_RMS);
        meterFrameRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      // The level meter is decorative; recording continues without it.
    }
  }

  function clearVoice() {
    setVoice(null);
    setVoiceSource("");
    setDurationSeconds("");
    setRecordingError("");
  }

  async function acceptAudio(source: File) {
    setRecordingError("");
    setPreparing(true);
    try {
      if (canNormalizeAudio()) {
        const normalized = await normalizeToWav(source, source.name);
        const durationError = validateVoiceDuration(normalized.durationSeconds);
        if (durationError) {
          clearVoice();
          setRecordingError(durationError);
          return;
        }
        setVoice(normalized.file);
        setDurationSeconds(normalized.durationSeconds.toFixed(1));
      } else {
        // Without Web Audio the original file is sent; the API needs ffmpeg for non-WAV formats.
        setVoice(source);
        setDurationSeconds("");
      }
      setVoiceSource(source.name);
    } catch (error) {
      clearVoice();
      setRecordingError(error instanceof Error ? error.message : "The audio could not be prepared.");
    } finally {
      setPreparing(false);
    }
  }

  function stopRecording() {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }

  async function startRecording() {
    setRecordingError("");
    if (!consent) {
      setRecordingError("Please review and accept the consent statement before recording.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setRecordingError("Microphone recording is not supported in this browser. Upload a recording instead.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      streamRef.current = stream;
      const mimeType = typeof MediaRecorder.isTypeSupported === "function"
        ? ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"]
          .find((type) => MediaRecorder.isTypeSupported(type))
        : undefined;
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recordingChunksRef.current = [];
      recordingStartedAtRef.current = Date.now();
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordingChunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        setRecordingError("The browser could not complete the microphone recording.");
        setRecording(false);
        if (recordingTimerRef.current !== null) window.clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
        stopMeter();
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      };
      recorder.onstop = () => {
        if (recordingTimerRef.current !== null) window.clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
        stopMeter();
        const duration = Math.min(60, (Date.now() - recordingStartedAtRef.current) / 1000);
        const type = recorder.mimeType || "audio/webm";
        setRecordingSeconds(duration);
        setRecording(false);
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        if (validateVoiceDuration(duration)) {
          setRecordingError("Recording must be at least 3 seconds long. Record again or upload a recording.");
          return;
        }
        const extension = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
        void acceptAudio(new File(recordingChunksRef.current, `microphone-recording.${extension}`, { type }));
      };
      recorderRef.current = recorder;
      clearVoice();
      recorder.start();
      startMeter(stream);
      setRecording(true);
      setRecordingSeconds(0);
      recordingTimerRef.current = window.setInterval(() => {
        const elapsed = (Date.now() - recordingStartedAtRef.current) / 1000;
        setRecordingSeconds(Math.min(60, elapsed));
        if (elapsed >= 60) stopRecording();
      }, 250);
    } catch (error) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setRecording(false);
      setRecordingError(error instanceof DOMException && error.name === "NotAllowedError"
        ? "Microphone permission was denied. Allow microphone access or upload a recording instead."
        : "Could not access the microphone. Check your browser permissions or upload a recording instead.");
    }
  }

  async function selectFeatureDataset(file: File | undefined) {
    setDatasetError("");
    setDatasetName("");
    setDatasetRows([]);
    setSelectedDatasetRow(0);
    if (!file) return;
    try {
      const rows = parseVoiceFeatureDataset(await readFileText(file), file.name);
      setDatasetRows(rows);
      setDatasetName(file.name);
      setSelectedDatasetRow(0);
      setValues(rows[0].values);
    } catch (error) {
      setDatasetError(error instanceof Error ? error.message : "The feature dataset could not be read.");
    }
  }

  const [loadingSample, setLoadingSample] = useState("");

  async function loadSampleGait(path: string, name: string) {
    setLoadingSample(name);
    try {
      const response = await fetch(path);
      if (!response.ok) throw new Error("missing");
      const blob = await response.blob();
      await selectGait(new File([blob], name, { type: "text/plain" }));
    } catch {
      setGaitError("The sample walking recording could not be loaded.");
    } finally {
      setLoadingSample("");
    }
  }

  async function selectGait(file: File | undefined) {
    setGaitPreview([]);
    if (!file) { setGait(null); setGaitError(""); return; }
    const fileError = validateGaitFile(file);
    if (fileError) { setGait(null); setGaitError(fileError); return; }
    const preview = previewGaitText(await readFileText(file), file.name);
    if (preview.error) { setGait(null); setGaitError(preview.error); return; }
    setGait(file); setGaitPreview(preview.rows); setGaitError("");
  }

  const usesAudio = inputMode !== "features";
  const numericValues = values.map(Number);
  const validFeatures = values.every((value) => value.trim() !== "" && Number.isFinite(Number(value)));
  const ageNumber = patientAge.trim() === "" ? null : Number(patientAge);
  const patientError = !patientName.trim()
    ? "Enter the participant's full name."
    : ageNumber !== null && (!Number.isInteger(ageNumber) || ageNumber < 1 || ageNumber > 120)
      ? "Age must be a whole number between 1 and 120."
      : "";
  const voiceReady = Boolean(voice && !validateVoiceFile(voice) && !validateVoiceDuration(Number(durationSeconds)));
  const canSubmit = consent && !patientError && !gaitError && (modality === "voice" || gait !== null) &&
    (usesAudio ? voiceReady : validFeatures) && !recording && !preparing && !submitting;

  function patientFields(form: FormData) {
    form.append("patient_name", patientName.trim());
    if (ageNumber !== null) form.append("patient_age", String(ageNumber));
    if (patientSex) form.append("patient_sex", patientSex);
    if (patientLocation.trim()) form.append("patient_location", patientLocation.trim());
  }

  useEffect(() => {
    if (result) window.scrollTo({ top: 0, behavior: "smooth" });
  }, [result]);

  function handleResult(saved: Assessment) {
    // A completed analysis goes straight to its report; anything else stays here
    // with the explanation and a way to record again.
    if (saved.status === "completed" && saved.result) {
      router.push(`/reports/${saved.id}?submitted=1`);
      return;
    }
    setResult(saved);
  }

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError("");
    const form = new FormData();
    form.append("consent", "true");
    form.append("modality", modality);
    patientFields(form);
    if (usesAudio && voice) {
      form.append("duration_seconds", durationSeconds);
      form.append("voice", voice, voice.name);
      if (gait) form.append("gait", gait, gait.name);
      try { handleResult(await api.submitAssessment(form)); }
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
      handleResult(await api.submitManualAssessment(form));
    } catch (caught) {
      if (modality === "voice" && caught instanceof ApiError && caught.status === 503) {
        try {
          handleResult(await api.submitManualAssessment(form));
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
    // Completed analyses redirect to their report; this view explains why a
    // saved record has no score and offers to record again.
    return <section className="submission-result rejected-card" aria-live="polite">
      <div className="rejected-head">
        <span className="rejected-icon" aria-hidden="true"><AlertTriangle size={22} /></span>
        <div>
          <span className="status-pill status-unavailable">Analysis unavailable</span>
          <h2>Your assessment record was saved</h2>
          <p>{result.unavailable_reason}</p>
        </div>
      </div>
      <ul className="rejected-tips">
        <li>Record in a quiet room with fans and TV switched off.</li>
        <li>Hold the phone or laptop about 20 cm from your mouth.</li>
        <li>Say one steady “aaah” for 5–10 seconds without pausing.</li>
      </ul>
      <div className="button-row">
        <button className="button" type="button" onClick={() => { setResult(null); clearVoice(); setRecordingSeconds(0); }}><Mic size={16} /> Record again</button>
        <Link className="button button-outline" href="/guide">Recording guide</Link>
        <Link className="text-link" href={`/assessments/${result.id}`}>View saved record</Link>
      </div>
    </section>;
  }

  const tabs: { id: InputMode; label: string; icon: typeof Mic }[] = [
    { id: "record", label: "Record", icon: Mic },
    { id: "upload", label: "Upload audio", icon: Upload },
    { id: "features", label: "Feature values", icon: FileSpreadsheet },
  ];

  return <div className="wizard">
    <section className="wizard-card">
      <div className="wizard-step"><span>01</span><div><h2>Participant details and consent</h2><p>Shown on the report. Only the name is required.</p></div></div>
      <div className="patient-grid">
        <label className="patient-name">Full name<input autoComplete="name" value={patientName} onChange={(event) => setPatientName(event.target.value)} placeholder="e.g. Asha Rao" /></label>
        <label>Age<input type="number" inputMode="numeric" min="1" max="120" value={patientAge} onChange={(event) => setPatientAge(event.target.value)} placeholder="Years" /></label>
        <label>Sex<select value={patientSex} onChange={(event) => setPatientSex(event.target.value as PatientSex | "")}>
          <option value="">Not specified</option>
          <option value="female">Female</option>
          <option value="male">Male</option>
          <option value="other">Other</option>
          <option value="prefer_not_to_say">Prefer not to say</option>
        </select></label>
        <label className="patient-location">Location<input autoComplete="address-level2" value={patientLocation} onChange={(event) => setPatientLocation(event.target.value)} placeholder="City, country" /></label>
      </div>
      {patientError && patientName.trim() && <p className="field-error">{patientError}</p>}
      <label className="check-row"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>I understand this is not a diagnosis or medical advice, and I consent to submitting these assessment inputs.</span></label>
    </section>

    <section className="wizard-card">
      <div className="wizard-step"><span>02</span><div><h2>Assessment type</h2><p>Voice + gait combines both into one result.</p></div></div>
      <div className="choice-grid">
        <label className={modality === "voice" ? "choice-card selected" : "choice-card"}><input aria-label="Voice-only assessment" type="radio" name="modality" checked={modality === "voice"} onChange={() => setModality("voice")} /><span><strong>Voice only</strong><small>Microphone only</small></span></label>
        <label className={modality === "voice_gait" ? "choice-card selected" : "choice-card"}><input aria-label="Voice and gait assessment" type="radio" name="modality" checked={modality === "voice_gait"} onChange={() => setModality("voice_gait")} /><span><strong>Voice + gait <em className="recommended-tag">Complete assessment</em></strong><small>Voice and walking, one result</small></span></label>
      </div>
      <GaitInfo />
    </section>

    <section className="wizard-card">
      <div className="wizard-step"><span>03</span><div><h2>Voice input</h2><p>Record or upload a steady “aaah” for 5–10 seconds. <Link className="inline-link" href="/guide">Recording guide</Link></p></div></div>
      <div className="input-tabs" role="tablist" aria-label="Voice input method">
        {tabs.map(({ id, label, icon: Icon }) => <button key={id} type="button" role="tab" aria-selected={inputMode === id} className={inputMode === id ? "input-tab active" : "input-tab"} onClick={() => setInputMode(id)} disabled={recording}><Icon size={16} />{label}</button>)}
      </div>

      {inputMode === "record" && <div className="voice-panel" role="tabpanel" aria-label="Record">
        <div className="recorder-stage">
          <button className={recording ? "mic-button live" : "mic-button"} type="button" aria-label={recording ? "Stop recording" : "Start recording"} onClick={() => recording ? stopRecording() : void startRecording()} disabled={(!recording && !consent) || preparing}>
            {recording ? <Square size={24} fill="currentColor" /> : <Mic size={28} />}
          </button>
          <div className="recorder-readout">
            <strong className="recorder-clock" role={recording ? "status" : undefined}>{formatClock(recordingSeconds)} <small>/ 01:00</small></strong>
            <div className={recording ? "level-meter live" : "level-meter"} aria-hidden="true">{levels.map((level, index) => <i key={index} style={{ transform: `scaleY(${level})` }} />)}</div>
            {recording && tooQuiet && <span className="quiet-warning" role="status">Too quiet — move closer to the microphone and say “aaah” louder.</span>}
            <span className="field-hint">{recording ? "Recording — hold a steady “aaah”, then press stop." : consent ? "Press the microphone to start." : "Accept the consent statement in step 01 to enable the microphone."}</span>
          </div>
        </div>
        <ol className="record-tips">
          <li>Find a quiet room and hold the device about 20 cm from your mouth.</li>
          <li>Take a breath and say <strong>“aaah”</strong> at a comfortable, steady pitch.</li>
          <li>Keep it going for 5–10 seconds (minimum 3).</li>
        </ol>
      </div>}

      {inputMode === "upload" && <div className="voice-panel" role="tabpanel" aria-label="Upload audio">
        <label className="dropzone">
          <Upload size={22} />
          <strong>Choose an audio file</strong>
          <span>WAV, MP3, M4A, WebM or OGG · 3–60 seconds</span>
          <input type="file" aria-label="Upload recorded audio" accept=".webm,.wav,.ogg,.mp3,.m4a,audio/*" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) { if (validateVoiceFile(file)) setRecordingError(validateVoiceFile(file) || ""); else void acceptAudio(file); } }} />
        </label>
      </div>}

      {usesAudio && <>
        {preparing && <p className="preparing-note" role="status"><span className="spinner" aria-hidden="true" /> Preparing audio (converting to 16 kHz WAV)…</p>}
        {recordingError && <ErrorMessage>{recordingError}</ErrorMessage>}
        {voice && !preparing && <div className="voice-ready">
          <span className="voice-ready-icon"><AudioLines size={19} /></span>
          <div className="voice-ready-meta">
            <strong>{voiceSource || voice.name}</strong>
            <small>{durationSeconds ? `${durationSeconds} s` : "Duration unknown"} · {voice.type === "audio/wav" ? "converted to 16 kHz mono WAV" : voice.type || "audio"} · {(voice.size / 1024).toFixed(0)} KB</small>
          </div>
          {voiceUrl && <audio className="audio-preview" controls preload="metadata" src={voiceUrl} onLoadedMetadata={(event) => {
            const duration = event.currentTarget.duration;
            if (!durationSeconds && Number.isFinite(duration) && duration > 0) setDurationSeconds(duration.toFixed(1));
          }}>Audio preview is not supported by this browser.</audio>}
          <button className="icon-button" type="button" aria-label="Remove recording" onClick={clearVoice}><Trash2 size={17} /></button>
          {!durationSeconds && <label className="duration-fallback">Recording duration (seconds)<input type="number" min="3" max="60" step="0.1" value={durationSeconds} onChange={(event) => setDurationSeconds(event.target.value)} /></label>}
          {durationSeconds && validateVoiceDuration(Number(durationSeconds)) && <ErrorMessage>{validateVoiceDuration(Number(durationSeconds))}</ErrorMessage>}
        </div>}
      </>}

      {inputMode === "features" && <div className="voice-panel" role="tabpanel" aria-label="Feature values">
        <div className="dataset-bar">
          <label className="file-picker"><FileSpreadsheet size={16} /> Upload vocal feature dataset<input type="file" accept=".data,.csv,text/csv" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; void selectFeatureDataset(file); }} /></label>
          {datasetRows.length > 1 && <label className="dataset-row-picker">Select dataset record<select value={selectedDatasetRow} onChange={(event) => { const index = Number(event.target.value); setSelectedDatasetRow(index); setValues(datasetRows[index].values); }}>{datasetRows.map((row, index) => <option key={`${row.label}-${index}`} value={index}>{row.label}</option>)}</select></label>}
        </div>
        {datasetError && <ErrorMessage>{datasetError}</ErrorMessage>}
        {datasetName && <p className="file-selected">{datasetName} · {datasetRows.length} records loaded</p>}
        {datasetName && <p className="field-hint">All 16 fields were populated from the selected row. MDVP:PPQ and MDVP:APQ map to PPQ5 and APQ11. The dataset stays in your browser; only the selected values are submitted.</p>}
        {VOICE_FEATURE_GROUPS.map((group) => <fieldset className="feature-group" key={group.title}>
          <legend>{group.title}</legend>
          <div className="feature-grid">{group.columns.map((column) => {
            const index = VOICE_FEATURE_COLUMNS.indexOf(column);
            return <label key={column}>{column}<input aria-label={column} type="number" step="any" value={values[index]} onChange={(event) => setValues((current) => current.map((value, item) => item === index ? event.target.value : value))} /></label>;
          })}</div>
        </fieldset>)}
      </div>}
    </section>

    {modality === "voice_gait" && <section className="wizard-card">
      <div className="wizard-step"><span>04</span><div><h2>Walking (gait) recording</h2><p>Use a sample or upload your own foot-pressure file.</p></div></div>
      <div className="sample-gait">
        <button type="button" className={gait?.name === "sample-walk-parkinsons-GaPt03.txt" ? "sample-card selected" : "sample-card"} aria-pressed={gait?.name === "sample-walk-parkinsons-GaPt03.txt"} onClick={() => void loadSampleGait("/samples/sample-walk-parkinsons-GaPt03.txt", "sample-walk-parkinsons-GaPt03.txt")} disabled={Boolean(loadingSample)}>
          <Footprints size={20} aria-hidden="true" />
          <span><strong>Parkinson’s sample</strong><small>PhysioNet · 2-min walk</small></span>
        </button>
        <button type="button" className={gait?.name === "sample-walk-control-GaCo03.txt" ? "sample-card selected" : "sample-card"} aria-pressed={gait?.name === "sample-walk-control-GaCo03.txt"} onClick={() => void loadSampleGait("/samples/sample-walk-control-GaCo03.txt", "sample-walk-control-GaCo03.txt")} disabled={Boolean(loadingSample)}>
          <Footprints size={20} aria-hidden="true" />
          <span><strong>Healthy sample</strong><small>PhysioNet · 2-min walk</small></span>
        </button>
      </div>
      {loadingSample && <p className="preparing-note" role="status"><span className="spinner" aria-hidden="true" /> Loading sample walking recording…</p>}
      <details className="gait-upload">
        <summary>Upload your own recording</summary>
        <p className="field-hint">Foot-pressure insole file (.txt/.csv), 100 Hz, 19 columns, at least 20 seconds of walking.</p>
        <label className="file-picker">Choose gait file<input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={(event) => void selectGait(event.target.files?.[0])} /></label>
      </details>
      {gait && <p className="file-selected">{gait.name.startsWith("sample-") ? "Using sample: " : ""}{gait.name} · {(gait.size / 1024).toFixed(1)} KB</p>}
      {gaitPreview.length > 0 && !gait?.name.startsWith("sample-") && <div className="preview-wrap"><p className="field-hint">Validated preview (first rows)</p><table className="preview-table"><tbody>{gaitPreview.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={`${index}-${cellIndex}`}>{cell}</td>)}</tr>)}</tbody></table></div>}
      {gaitError && <ErrorMessage>{gaitError}</ErrorMessage>}
    </section>}

    <section className="submission-panel">
      {submitError && <ErrorMessage>{submitError}</ErrorMessage>}<button className="button" type="button" onClick={() => void submit()} disabled={!canSubmit}>{submitting ? "Submitting securely…" : "Submit assessment"}</button>
    </section>
  </div>;
}
