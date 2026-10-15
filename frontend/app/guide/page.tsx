"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, Mic } from "lucide-react";
import { MicCheck } from "@/components/mic-check";
import { MedicalDisclaimer } from "@/components/medical-disclaimer";

const STEPS = [
  {
    title: "Find a quiet room",
    body: "Switch off fans, AC and TV if you can. Background noise is the most common reason a recording is rejected.",
    scene: "room",
  },
  {
    title: "Hold the phone or laptop about 20 cm away",
    body: "Roughly the length of your hand with fingers spread. Sit upright and relax your shoulders.",
    scene: "distance",
  },
  {
    title: "Take a breath and say a steady “aaah”",
    body: "Use your normal, comfortable pitch and loudness — like at a doctor’s check-up. Don’t sing or change the pitch.",
    scene: "voice",
  },
  {
    title: "Hold it for 5–10 seconds, then press stop",
    body: "At least 3 seconds is required. The portal measures the steadiest part of your voice automatically.",
    scene: "timer",
  },
] as const;

function StepScene({ scene }: { scene: (typeof STEPS)[number]["scene"] }) {
  return (
    <svg className={`guide-scene scene-${scene}`} viewBox="0 0 360 220" aria-hidden="true">
      <rect x="10" y="10" width="340" height="200" rx="22" className="scene-bg" />
      {scene === "room" && <g>
        <rect x="40" y="40" width="90" height="70" rx="8" className="scene-window" />
        <g className="scene-noise">
          <path d="M240 70q10-10 20 0t20 0" /><path d="M250 95q10-10 20 0t20 0" /><path d="M240 120q10-10 20 0t20 0" />
        </g>
        <path d="M232 60l70 76" className="scene-strike" />
        <rect x="60" y="140" width="240" height="44" rx="10" className="scene-sofa" />
      </g>}
      {scene === "distance" && <g>
        <circle cx="110" cy="100" r="34" className="scene-face" />
        <rect x="236" y="62" width="46" height="84" rx="10" className="scene-phone" />
        <path d="M150 166H232" className="scene-ruler" />
        <path d="M150 158v16M232 158v16" className="scene-ruler" />
        <text x="191" y="194" textAnchor="middle" className="scene-label">≈ 20 cm</text>
      </g>}
      {scene === "voice" && <g>
        <circle cx="110" cy="110" r="38" className="scene-face" />
        <ellipse cx="136" cy="118" rx="7" ry="9" className="scene-mouth" />
        {[0, 1, 2].map((index) => <path key={index} className="scene-wave" style={{ animationDelay: `${index * 0.35}s` }} d={`M${160 + index * 22} ${92 - index * 12}a${28 + index * 14} ${28 + index * 14} 0 0 1 0 ${52 + index * 24}`} />)}
        <text x="282" y="122" className="scene-aah">aaah…</text>
      </g>}
      {scene === "timer" && <g>
        <circle cx="180" cy="110" r="66" className="scene-dial" />
        <circle cx="180" cy="110" r="66" className="scene-dial-progress" pathLength={1} />
        <text x="180" y="122" textAnchor="middle" className="scene-time">0:08</text>
      </g>}
    </svg>
  );
}

export default function GuidePage() {
  const [step, setStep] = useState(0);
  const [autoplay, setAutoplay] = useState(true);
  useEffect(() => {
    if (!autoplay) return;
    const timer = window.setInterval(() => setStep((current) => (current + 1) % STEPS.length), 5200);
    return () => window.clearInterval(timer);
  }, [autoplay]);
  const go = (next: number) => { setAutoplay(false); setStep((next + STEPS.length) % STEPS.length); };

  return (
    <main className="editorial-page content-width guide-page">
      <div className="eyebrow">Recording guide</div>
      <h1>Record a good voice sample in one minute.</h1>
      <p className="editorial-lead">A clear, steady “aaah” is all the assessment needs. Follow these four steps, then test your microphone below before recording.</p>

      <section className="guide-player" aria-roledescription="carousel" aria-label="Recording steps">
        <div className="guide-stage" key={step}>
          <StepScene scene={STEPS[step].scene} />
          <div className="guide-copy">
            <span className="guide-step-no">Step {step + 1} of {STEPS.length}</span>
            <h2>{STEPS[step].title}</h2>
            <p>{STEPS[step].body}</p>
          </div>
        </div>
        <div className="guide-controls">
          <button type="button" className="icon-button" onClick={() => go(step - 1)} aria-label="Previous step"><ArrowLeft size={17} /></button>
          <div className="guide-dots">{STEPS.map((item, index) => (
            <button key={item.title} type="button" aria-label={`Step ${index + 1}: ${item.title}`} aria-current={index === step} className={index === step ? "guide-dot active" : "guide-dot"} onClick={() => go(index)}>
              {index === step && autoplay && <span className="guide-dot-fill" />}
            </button>
          ))}</div>
          <button type="button" className="icon-button" onClick={() => go(step + 1)} aria-label="Next step"><ArrowRight size={17} /></button>
        </div>
      </section>

      <section className="guide-check">
        <div>
          <div className="eyebrow">Try it now</div>
          <h2>Microphone check</h2>
          <p>Say “aaah” and watch the meter. Aim for the green “Good level” message.</p>
        </div>
        <MicCheck />
      </section>

      <section className="guide-dos">
        <div><h3><Check size={18} aria-hidden="true" /> Do</h3><ul><li>Record at a similar time of day each time</li><li>Use the same device for every assessment</li><li>Sit upright and breathe normally first</li></ul></div>
        <div><h3>Avoid</h3><ul><li>Whispering, singing or changing pitch</li><li>Covering the microphone with your hand</li><li>Recording right after coughing or shouting</li></ul></div>
      </section>

      <div className="button-row">
        <Link className="button" href="/assessment/new"><Mic size={16} /> Start an assessment</Link>
        <Link className="text-link" href="/how-it-works">How the analysis works <ArrowRight size={15} /></Link>
      </div>
      <MedicalDisclaimer />
    </main>
  );
}
