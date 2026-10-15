"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";

type Verdict = "idle" | "quiet" | "good" | "loud";

const BARS = 32;

/** Live microphone level check: nothing is recorded or uploaded. */
export function MicCheck() {
  const [active, setActive] = useState(false);
  const [levels, setLevels] = useState<number[]>(() => Array(BARS).fill(0.06));
  const [verdict, setVerdict] = useState<Verdict>("idle");
  const [error, setError] = useState("");
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const frameRef = useRef<number | null>(null);

  function stop() {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void contextRef.current?.close().catch(() => undefined);
    contextRef.current = null;
    setActive(false);
    setLevels(Array(BARS).fill(0.06));
  }

  useEffect(() => stop, []);

  async function start() {
    setError("");
    const Context = typeof window !== "undefined" ? window.AudioContext : undefined;
    if (!navigator.mediaDevices?.getUserMedia || !Context) {
      setError("Microphone access is not supported in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      streamRef.current = stream;
      const context = new Context();
      contextRef.current = context;
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      context.createMediaStreamSource(stream).connect(analyser);
      const data = new Float32Array(analyser.fftSize);
      const history: number[] = Array(BARS).fill(0.06);
      const recent: number[] = [];
      setActive(true);
      const tick = () => {
        analyser.getFloatTimeDomainData(data);
        let sum = 0;
        let peak = 0;
        for (let index = 0; index < data.length; index += 1) {
          sum += data[index] * data[index];
          peak = Math.max(peak, Math.abs(data[index]));
        }
        const rms = Math.sqrt(sum / data.length);
        history.shift();
        history.push(Math.min(1, 0.06 + rms * 4));
        setLevels([...history]);
        recent.push(peak > 0.98 ? 2 : rms);
        if (recent.length > 45) recent.shift();
        const loudest = Math.max(...recent);
        setVerdict(loudest >= 2 ? "loud" : loudest < 0.02 ? "quiet" : "good");
        frameRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      setError("Microphone permission was denied or no microphone is available.");
      stop();
    }
  }

  const messages: Record<Verdict, string> = {
    idle: "Press start, then say a steady “aaah”. Nothing is recorded or uploaded.",
    quiet: "Too quiet — move closer to the microphone or say “aaah” a little louder.",
    good: "Good level — this is the right distance and loudness for an assessment.",
    loud: "Too loud — the sound is clipping. Move the device a little further away.",
  };

  return (
    <div className={`mic-check verdict-${active ? verdict : "idle"}`}>
      <button type="button" className={active ? "mic-button live" : "mic-button"} onClick={() => (active ? stop() : void start())} aria-label={active ? "Stop microphone check" : "Start microphone check"}>
        {active ? <Square size={22} fill="currentColor" /> : <Mic size={26} />}
      </button>
      <div className="mic-check-body">
        <div className={active ? "level-meter live" : "level-meter"} aria-hidden="true">{levels.map((level, index) => <i key={index} style={{ transform: `scaleY(${level})` }} />)}</div>
        <p role="status">{error || messages[active ? verdict : "idle"]}</p>
      </div>
    </div>
  );
}
