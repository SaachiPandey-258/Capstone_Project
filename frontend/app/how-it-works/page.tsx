import Link from "next/link";
import { ArrowRight, AudioWaveform, FileText, Gauge, LineChart, Mic, ShieldCheck } from "lucide-react";
import { MedicalDisclaimer } from "@/components/medical-disclaimer";
import { GaitInfo } from "@/components/gait-info";

const PIPELINE = [
  { icon: Mic, title: "Record", body: "A steady “aaah” for 5–10 seconds in your browser, or upload an audio file." },
  { icon: ShieldCheck, title: "Quality check", body: "We keep only the steadiest stretch of voice and reject recordings that are too short or too noisy." },
  { icon: AudioWaveform, title: "Measure", body: "Praat measures jitter, shimmer and HNR, plus voice clarity (CPPS), pitch steadiness and spectral shape." },
  { icon: Gauge, title: "Screen", body: "Voice and (optionally) gait models each score your input; with both, their probabilities are combined into one result: Not detected, Inconclusive or Detected." },
  { icon: FileText, title: "Report", body: "A formal report with participant details, findings and limitations — downloadable as PDF." },
  { icon: LineChart, title: "Track", body: "Repeat assessments over weeks and follow your measures on the Progress page." },
];

export default function HowItWorksPage() {
  return (
    <main className="editorial-page content-width">
      <div className="eyebrow">Platform guide</div>
      <h1>How the assessment works.</h1>
      <p className="editorial-lead">From a short voice sample to a structured research report in under a minute. Here is what happens at each step.</p>

      <ol className="pipeline" aria-label="Assessment pipeline">
        {PIPELINE.map(({ icon: Icon, title, body }, index) => (
          <li key={title} className="pipeline-step" style={{ animationDelay: `${index * 110}ms` }}>
            <span className="pipeline-icon"><Icon size={22} aria-hidden="true" /></span>
            <span className="pipeline-no">{String(index + 1).padStart(2, "0")}</span>
            <h2>{title}</h2>
            <p>{body}</p>
          </li>
        ))}
      </ol>

      <section className="explain-grid">
        <article className="explain-card">
          <h2>What the screening result means</h2>
          <ul className="tier-explain">
            <li><span className="tier-dot tier-not" /> <strong>Not detected</strong> — no voice markers associated with Parkinson’s were found. A voice screen cannot rule Parkinson’s out.</li>
            <li><span className="tier-dot tier-inc" /> <strong>Inconclusive</strong> — the result is borderline. Record again in a quiet room, or speak to a clinician about any symptoms.</li>
            <li><span className="tier-dot tier-det" /> <strong>Detected</strong> — voice markers associated with Parkinson’s were found. This is a reason to see a neurologist, not a diagnosis.</li>
          </ul>
        </article>
        <article className="explain-card">
          <h2>How accurate is it?</h2>
          <p>The audio model was trained and tested on phone recordings of 78 people (39 with Parkinson’s), with age balancing because the healthy group was younger. On people it had not seen:</p>
          <ul className="accuracy-list">
            <li><strong>55%</strong> of people with Parkinson’s were flagged “Detected”; 15% were “Not detected”.</li>
            <li><strong>13%</strong> of healthy people were wrongly flagged “Detected”; 53% were “Not detected”.</li>
            <li><strong>Voice + gait combined:</strong> AUC 0.84 vs 0.77 for either alone — 66% of people with Parkinson’s flagged “Detected” with 14% of healthy people wrongly flagged (simulated pairing, see manual).</li>
          </ul>
          <p className="muted">It is a research screening aid with modest accuracy — not a medical device.</p>
        </article>
      </section>

      <section className="explain-card gait-explain">
        <h2>Voice + gait: the optional walking assessment</h2>
        <GaitInfo open />
      </section>

      <div className="button-row">
        <Link className="button" href="/guide">Read the recording guide <ArrowRight size={17} /></Link>
        <Link className="text-link" href="/resources">Explore resources <ArrowRight size={16} /></Link>
      </div>
      <MedicalDisclaimer />
    </main>
  );
}
