import type { Assessment } from "@/lib/types";

const MIN_DURATION_SECONDS = 3;
const MAX_DURATION_SECONDS = 60;
const MAX_GAIT_BYTES = 10 * 1024 * 1024;
const AUDIO_TYPES = ["audio/webm", "audio/ogg", "audio/mp4", "audio/wav"];

export function validateVoiceDuration(seconds: number): string | null {
  if (seconds < MIN_DURATION_SECONDS) return `Recording must be at least ${MIN_DURATION_SECONDS} seconds long.`;
  if (seconds > MAX_DURATION_SECONDS) return `Recording must be ${MAX_DURATION_SECONDS} seconds or less.`;
  return null;
}

export function validateVoiceFile(file: File): string | null {
  const validType = AUDIO_TYPES.some((type) => file.type === type || file.type.startsWith(`${type};`));
  const validExtension = /\.(webm|ogg|oga|m4a|mp4|wav)$/i.test(file.name);
  return validType || validExtension ? null : "Choose an audio file in WebM, OGG, M4A, MP4, or WAV format.";
}

export function validateGaitFile(file: File): string | null {
  if (!/\.(csv|txt)$/i.test(file.name)) return "Choose a gait data CSV or TXT file.";
  if (file.size > MAX_GAIT_BYTES) return "The gait file is too large. Choose a file smaller than 10 MB.";
  return null;
}

type Preview = { rows: string[][]; error: string | null };

export function previewGaitText(text: string, filename: string): Preview {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return { rows: [], error: "The gait file is empty." };
  const delimiter = filename.toLowerCase().endsWith(".csv") ? "," : /\s+/;
  const allRows = lines.map((line) => line.split(delimiter).map((cell) => cell.trim()));
  const firstIsHeader = allRows[0].some((cell) => cell !== "" && Number.isNaN(Number(cell)));
  const dataRows = firstIsHeader ? allRows.slice(1) : allRows;
  if (!dataRows.length || dataRows.some((row) => row.length !== 19 || row.some((cell) => cell === "" || Number.isNaN(Number(cell))))) {
    return { rows: allRows.slice(0, 6), error: "The gait file must contain exactly 19 numeric columns in the documented sensor order." };
  }
  if (dataRows.length < 200) {
    return { rows: allRows.slice(0, 6), error: "The gait file must contain at least 200 numeric rows." };
  }
  return { rows: allRows.slice(0, 6), error: null };
}

export function hasValidFusionInputs(
  modality: Assessment["modality"],
  voice: File | null,
  duration: number,
  gait: File | null,
  gaitError: string,
): boolean {
  return Boolean(
    voice
      && !validateVoiceFile(voice)
      && !validateVoiceDuration(duration)
      && (modality === "voice" || (gait && !gaitError)),
  );
}
