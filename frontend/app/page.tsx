import Link from "next/link";
import { ArrowRight, Activity, AudioLines, ClipboardCheck, ShieldCheck } from "lucide-react";
import { MedicalDisclaimer } from "@/components/medical-disclaimer";

export default function HomePage() {
  return (
    <main>
      <section className="hero-wrap">
        <div className="hero">
          <div className="hero-copy">
            <div className="eyebrow"><span className="eyebrow-dot" /> A research-led assessment companion</div>
            <h1>Multimodal Parkinson’s<br /><em>assessment.</em></h1>
            <p className="hero-intro">A private place to organize voice-only or voice + gait assessment records over time, and bring your observations to a conversation with your care team.</p>
            <div className="hero-actions">
              <Link className="button" href="/register">Create an account <ArrowRight size={17} /></Link>
              <Link className="text-link" href="/how-it-works">See how it works <ArrowRight size={16} /></Link>
            </div>
            <div className="hero-trust"><ShieldCheck size={17} /> Your assessment history is private to your account.</div>
          </div>
          <div className="hero-art" role="img" aria-label="Abstract illustration of voice and optional movement data">
            <div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" />
            <div className="art-card art-card-top"><AudioLines size={19} /><span>Voice</span><div className="waveform">{[12, 21, 30, 18, 40, 24, 34, 16, 27, 13, 31, 18, 11, 24].map((height, i) => <i key={i} style={{ height }} />)}</div></div>
            <div className="art-center"><Activity size={39} strokeWidth={1.25} /><span>Observe<br />over time</span></div>
            <div className="art-card art-card-bottom"><span className="art-check">↗</span><span>Movement<br /><small>Optional gait data</small></span></div>
            <span className="art-caption">A record for reflection,<br />not a diagnosis.</span>
          </div>
        </div>
      </section>
      <section className="section content-width">
        <div className="section-heading"><div><div className="eyebrow">A thoughtful starting point</div><h2>One place to keep<br />the details together.</h2></div><p>Designed to help you track what you’ve shared, understand what is and isn’t available, and prepare for a clinician-led conversation.</p></div>
        <div className="feature-grid">
          <article className="feature-card"><span className="feature-number">01</span><AudioLines /><h3>Record your voice</h3><p>Capture a short voice sample with your permission. Listen back, retry, or delete it before submitting.</p></article>
          <article className="feature-card"><span className="feature-number">02</span><Activity /><h3>Add movement data</h3><p>Optionally include a supported sensor-data file. The platform checks format before accepting it.</p></article>
          <article className="feature-card"><span className="feature-number">03</span><ClipboardCheck /><h3>Keep a clear history</h3><p>Review saved assessment records. Results appear only when a validated analysis has actually completed.</p></article>
        </div>
      </section>
      <section className="statement-band"><div className="content-width statement-inner"><div className="eyebrow">Built around honest limits</div><h2>Useful information starts<br />with knowing what it can’t tell you.</h2><p>This platform is not a diagnostic device. No disease stage, diagnosis, or score is inferred when a validated model is unavailable.</p><Link className="text-link" href="/about">Our approach <ArrowRight size={16} /></Link></div></section>
      <section className="section content-width source-row"><div><div className="eyebrow">Learn from trusted sources</div><h2>Good questions deserve<br />reliable answers.</h2></div><div className="source-links"><a href="https://www.ninds.nih.gov/health-information/disorders/parkinsons-disease" target="_blank" rel="noreferrer">National Institute of Neurological Disorders and Stroke ↗</a><a href="https://www.parkinson.org/understanding-parkinsons" target="_blank" rel="noreferrer">Parkinson’s Foundation ↗</a><a href="https://www.who.int/news-room/fact-sheets/detail/parkinson-disease" target="_blank" rel="noreferrer">World Health Organization ↗</a></div></section>
      <div className="content-width"><MedicalDisclaimer /></div>
    </main>
  );
}
