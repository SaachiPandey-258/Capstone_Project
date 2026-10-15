import type { Assessment } from "@/lib/types";

const MIN_DURATION_SECONDS = 3;
const MAX_DURATION_SECONDS = 60;
const MAX_GAIT_BYTES = 10 * 1024 * 1024;
const AUDIO_TYPES = ["audio/webm", "audio/ogg", "audio/mp4", "audio/wav", "audio/mpeg"];
const MAX_FEATURE_FILE_BYTES = 10 * 1024 * 1024;

export const VOICE_FEATURE_COLUMNS = [
  "Jitter(%)",
  "Jitter(Abs)",
  "Jitter:RAP",
  "Jitter:PPQ5",
  "Jitter:DDP",
  "Shimmer",
  "Shimmer(dB)",
  "Shimmer:APQ3",
  "Shimmer:APQ5",
  "Shimmer:APQ11",
  "Shimmer:DDA",
  "NHR",
  "HNR",
  "RPDE",
  "DFA",
  "PPE",
];

export const VOICE_FEATURE_GROUPS = [
  { title: "Frequency perturbation (jitter)", columns: VOICE_FEATURE_COLUMNS.slice(0, 5) },
  { title: "Amplitude perturbation (shimmer)", columns: VOICE_FEATURE_COLUMNS.slice(5, 11) },
  { title: "Noise and nonlinear dynamics", columns: VOICE_FEATURE_COLUMNS.slice(11) },
];

export type VoiceFeatureDatasetRow = {
  label: string;
  values: string[];
};

export function validateVoiceDuration(seconds: number): string | null {
  if (!Number.isFinite(seconds)) return "Enter a valid recording duration.";
  if (seconds < MIN_DURATION_SECONDS) return `Recording must be at least ${MIN_DURATION_SECONDS} seconds long.`;
  if (seconds > MAX_DURATION_SECONDS) return `Recording must be ${MAX_DURATION_SECONDS} seconds or less.`;
  return null;
}

export function validateVoiceFile(file: File): string | null {
  const validType = AUDIO_TYPES.some((type) => file.type === type || file.type.startsWith(`${type};`));
  const validExtension = /\.(webm|ogg|oga|m4a|mp4|mp3|wav)$/i.test(file.name);
  return validType || validExtension ? null : "Choose an audio file in WebM, OGG, M4A, MP4, or WAV format.";
}

export function validateGaitFile(file: File): string | null {
  if (!/\.(csv|txt)$/i.test(file.name)) return "Choose a gait data CSV or TXT file.";
  if (file.size > MAX_GAIT_BYTES) return "The gait file is too large. Choose a file smaller than 10 MB.";
  return null;
}

export function readFileText(file: File): Promise<string> {
  if (typeof file.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("The selected file could not be read as text."));
    };
    reader.onerror = () => reject(reader.error || new Error("The selected file could not be read."));
    reader.readAsText(file);
  });
}

export function parseVoiceFeatureDataset(text: string, filename: string): VoiceFeatureDatasetRow[] {
  if (!/\.(csv|data)$/i.test(filename)) {
    throw new Error("Choose the repository's parkinsons.data file or a CSV dataset.");
  }
  if (new Blob([text]).size > MAX_FEATURE_FILE_BYTES) {
    throw new Error("The feature dataset is too large. Choose a file smaller than 10 MB.");
  }

  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) throw new Error("The feature dataset must include a header and at least one data row.");

  const parseCsvRow = (line: string) => {
    const cells: string[] = [];
    let cell = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index];
      if (character === '"' && quoted && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = !quoted;
      } else if (character === "," && !quoted) {
        cells.push(cell.trim());
        cell = "";
      } else {
        cell += character;
      }
    }
    if (quoted) throw new Error("The feature dataset contains an unclosed quoted field.");
    cells.push(cell.trim());
    return cells;
  };
  const normalize = (value: string) => value.trim().toLowerCase().replace(/^mdvp:/, "").replace(/[^a-z0-9]/g, "");
  const header = parseCsvRow(lines[0]);
  const normalizedHeader = header.map(normalize);
  const aliases = [
    ["jitter"],
    ["jitterabs"],
    ["jitterrap", "rap"],
    ["jitterppq5", "ppq5", "ppq"],
    ["jitterddp", "ddp"],
    ["shimmer"],
    ["shimmerdb"],
    ["shimmerapq3", "apq3"],
    ["shimmerapq5", "apq5"],
    ["shimmerapq11", "apq11", "apq"],
    ["dda", "shimmerdda"],
    ["nhr"],
    ["hnr"],
    ["rpde"],
    ["dfa"],
    ["ppe"],
  ];
  const indexes = aliases.map((names, columnIndex) => {
    const index = normalizedHeader.findIndex((headerName) => names.includes(headerName));
    if (index < 0) {
      throw new Error(`The feature dataset is missing a column for ${VOICE_FEATURE_COLUMNS[columnIndex]}.`);
    }
    return index;
  });
  const labelIndex = normalizedHeader.indexOf("name");

  return lines.slice(1).map((line, rowIndex) => {
    const cells = parseCsvRow(line);
    const values = indexes.map((index) => cells[index] ?? "");
    if (values.some((value) => value === "" || !Number.isFinite(Number(value)))) {
      throw new Error(`Dataset row ${rowIndex + 2} does not contain 16 finite vocal features.`);
    }
    return {
      label: (labelIndex >= 0 && cells[labelIndex]) || `Row ${rowIndex + 1}`,
      values,
    };
  });
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
