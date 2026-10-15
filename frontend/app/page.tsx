import Link from "next/link";
import {
  Activity,
  ArrowRight,
  AudioLines,
  ChartNoAxesCombined,
  Check,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import { MedicalDisclaimer } from "@/components/medical-disclaimer";

const waveHeights = [17, 25, 35, 21, 44, 29, 16, 36, 49, 27, 19, 39, 25, 46, 30, 18, 34, 23, 41, 28, 17, 36, 24];

export default function HomePage() {
  return (
    <main>
      <section className="home-hero-wrap">
        <div className="home-hero content-width">
          <div className="home-hero-copy">
            <div className="eyebrow hero-kicker"><span className="eyebrow-dot" /> A thoughtful companion for your care journey</div>
            <h1>Parkinson’s<br /><em>assessment, in context.</em></h1>
            <p className="home-hero-intro">
              Keep voice and optional movement observations in one private place. Review your history and bring it to a conversation with your care team.
            </p>
            <div className="home-hero-actions">
              <Link className="button" href="/register">Create your private account <ArrowRight size={17} /></Link>
              <Link className="text-link" href="/how-it-works">Explore how it works <ArrowRight size={16} /></Link>
            </div>
            <Link className="home-signin-link" href="/signin">Already have an account? <strong>Sign in</strong></Link>
            <div className="home-trust-note"><ShieldCheck size={18} /> Your records stay connected to your account.</div>
          </div>

          <div className="home-visual" aria-label="Voice analysis overview">
            <div className="visual-orb visual-orb-one" />
            <div className="visual-orb visual-orb-two" />
            <div className="visual-topline"><i className="live-dot" /> VOICE ANALYSIS</div>
            <div className="visual-heading"><span>One sustained “aaah”</span><strong>Your voice, measured.<br />Your history, together.</strong></div>
            <div className="visual-capture" aria-hidden="true">
              <span className="visual-icon"><AudioLines size={17} /></span>
              <div className="visual-wave">{waveHeights.map((height, index) => <i key={index} style={{ height, animationDelay: `${(index % 8) * -0.14}s` }} />)}</div>
              <span className="visual-timer">00:07</span>
            </div>
            <ul className="visual-features" aria-label="Measured acoustic features">
              {["Jitter", "Shimmer", "HNR", "NHR", "RPDE", "DFA", "PPE"].map((feature, index) => <li key={feature} style={{ animationDelay: `${0.9 + index * 0.09}s` }}>{feature}</li>)}
              <li className="visual-features-more" style={{ animationDelay: "1.55s" }}>16 features</li>
            </ul>
            <div className="visual-chart" aria-hidden="true">
              <div className="chart-labels"><span>Assessment history</span><span>Motor UPDRS trend</span></div>
              <svg viewBox="0 0 460 112" preserveAspectRatio="none">
                <path className="chart-gridline" d="M0 20H460 M0 56H460 M0 92H460" />
                <path className="chart-area" d="M0 77 C28 76 29 49 59 53 S91 77 115 65 S146 28 174 38 S205 78 233 65 S263 47 290 54 S319 79 347 61 S379 28 405 38 S438 58 460 25 V112 H0Z" />
                <path className="chart-line" pathLength={1} d="M0 77 C28 76 29 49 59 53 S91 77 115 65 S146 28 174 38 S205 78 233 65 S263 47 290 54 S319 79 347 61 S379 28 405 38 S438 58 460 25" />
              </svg>
              <div className="chart-axis"><span>First assessment</span><span>Latest</span></div>
            </div>
            <div className="visual-bottom">
              <div className="voice-mini-card">
                <span className="visual-icon"><ShieldCheck size={17} /></span>
                <span><strong>Screening</strong><small>Voice pattern check</small></span>
                <Check size={16} />
              </div>
              <div className="movement-mini-card">
                <span className="visual-icon"><Activity size={17} /></span>
                <span><strong>Movement</strong><small>Optional gait data</small></span>
                <Check size={16} />
              </div>
            </div>
            <div className="visual-footnote"><LockKeyhole size={13} /> Private to your account · share reports with your clinician</div>
          </div>
        </div>
      </section>

      <section className="trust-strip" aria-label="Platform principles">
        <div className="content-width trust-strip-inner">
          <div><LockKeyhole size={18} /><span><strong>Private by design</strong><small>Account-scoped records</small></span></div>
          <div><AudioLines size={18} /><span><strong>Voice observations</strong><small>Review and organize</small></span></div>
          <div><Activity size={18} /><span><strong>Optional movement data</strong><small>Validated file formats</small></span></div>
          <div><ShieldCheck size={18} /><span><strong>Honest about limits</strong><small>Research use only</small></span></div>
        </div>
      </section>

      <section className="home-section content-width reveal">
        <div className="home-section-heading">
          <div><div className="eyebrow">A calmer way to keep track</div><h2>More context for the<br />conversations that matter.</h2></div>
          <p>Small observations can be hard to keep organized. The Parkinson’s Assessment Portal gives you a private place to collect them and review what has actually been recorded.</p>
        </div>
        <div className="home-feature-grid">
          <article className="home-feature-card">
            <span className="home-feature-index">01 / CAPTURE</span>
            <div className="home-feature-icon"><AudioLines size={21} /></div>
            <h3>Start with your voice</h3>
            <p>Record or upload a voice sample, or use supported research features. Review what you submit and keep the record with your history.</p>
            <Link href="/how-it-works">How it works <ArrowRight size={15} /></Link>
          </article>
          <article className="home-feature-card">
            <span className="home-feature-index">02 / ORGANIZE</span>
            <div className="home-feature-icon"><ChartNoAxesCombined size={21} /></div>
            <h3>See your history together</h3>
            <p>Keep past submissions and completed reports together, with clear status when an analysis is not available.</p>
            <Link href="/register">Create an account <ArrowRight size={15} /></Link>
          </article>
          <article className="home-feature-card">
            <span className="home-feature-index">03 / PREPARE</span>
            <div className="home-feature-icon"><ShieldCheck size={21} /></div>
            <h3>Bring useful context to care</h3>
            <p>Review your records before appointments and discuss health questions with a qualified healthcare professional.</p>
            <Link href="/about">Our approach <ArrowRight size={15} /></Link>
          </article>
        </div>
      </section>

      <section className="home-approach reveal">
        <div className="content-width home-approach-inner">
          <div className="approach-mark"><ShieldCheck size={25} /></div>
          <div>
            <div className="eyebrow">Careful by design</div>
            <h2>Clarity matters more<br />than false certainty.</h2>
            <p>This Parkinson’s assessment portal is for research and monitoring—not a medical device. We show results only when analysis has been validated, and we never present an unavailable result as a diagnosis.</p>
            <Link className="text-link" href="/about">Read about our approach <ArrowRight size={16} /></Link>
          </div>
          <div className="approach-points">
            <div><span><Check size={16} /></span><p><strong>Clear status</strong><small>Know whether a report is ready.</small></p></div>
            <div><span><Check size={16} /></span><p><strong>No invented scores</strong><small>Unavailable analyses stay unavailable.</small></p></div>
            <div><span><Check size={16} /></span><p><strong>Clinician-led care</strong><small>Use health concerns as a reason to talk with a professional.</small></p></div>
          </div>
        </div>
      </section>

      <section className="home-cta content-width reveal">
        <div className="home-cta-copy"><div className="eyebrow">A private place to begin</div><h2>Make room for a more<br />informed conversation.</h2><p>Create an account to organize your assessment history in one place.</p></div>
        <div className="home-cta-actions"><Link className="button" href="/register">Create an account <ArrowRight size={17} /></Link><Link className="home-cta-signin" href="/signin">Already have an account? Sign in</Link></div>
      </section>

      <div className="content-width"><MedicalDisclaimer /></div>
    </main>
  );
}
