/**
 * Browser-side audio normalization.
 *
 * Microphone recordings arrive as WebM/Opus (or MP4/OGG) and uploads can be any
 * browser-decodable codec. The API decodes WAV without ffmpeg, so we decode in
 * the browser and re-encode as mono 16 kHz 16-bit PCM WAV — the exact format the
 * feature extractor resamples to anyway.
 */

export const TARGET_SAMPLE_RATE = 16_000;

export type NormalizedAudio = { file: File; durationSeconds: number };

type AudioContextConstructor = typeof AudioContext;

function audioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as { AudioContext?: AudioContextConstructor; webkitAudioContext?: AudioContextConstructor };
  return scope.AudioContext || scope.webkitAudioContext || null;
}

export function canNormalizeAudio(): boolean {
  return Boolean(audioContextConstructor()) && typeof OfflineAudioContext !== "undefined";
}

export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeText = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
  };
  writeText(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return buffer;
}

/** Decode any browser-supported audio blob and return a mono 16 kHz WAV file. */
export async function normalizeToWav(source: Blob, baseName = "voice-recording"): Promise<NormalizedAudio> {
  const Context = audioContextConstructor();
  if (!Context || typeof OfflineAudioContext === "undefined") {
    throw new Error("This browser cannot convert audio. Upload a WAV file instead.");
  }
  const context = new Context();
  let decoded: AudioBuffer;
  try {
    decoded = await context.decodeAudioData(await source.arrayBuffer());
  } catch {
    throw new Error("This audio format could not be decoded by your browser. Try a WAV, MP3, or M4A file.");
  } finally {
    void context.close();
  }
  const length = Math.max(1, Math.ceil(decoded.duration * TARGET_SAMPLE_RATE));
  const offline = new OfflineAudioContext(1, length, TARGET_SAMPLE_RATE);
  const node = offline.createBufferSource();
  node.buffer = decoded; // multi-channel input is down-mixed to the mono destination
  node.connect(offline.destination);
  node.start();
  const rendered = await offline.startRendering();
  const wav = encodeWav(rendered.getChannelData(0), TARGET_SAMPLE_RATE);
  const name = `${baseName.replace(/\.[^.]+$/, "") || "voice-recording"}.wav`;
  return { file: new File([wav], name, { type: "audio/wav" }), durationSeconds: decoded.duration };
}
