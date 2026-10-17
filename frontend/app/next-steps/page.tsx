import Link from "next/link";
import {
  Activity, ArrowRight, CalendarCheck, ClipboardList, Dumbbell, HeartHandshake, LineChart,
  MapPinned, MessageCircle, RefreshCw, Stethoscope, Users,
} from "lucide-react";
import { MedicalDisclaimer } from "@/components/medical-disclaimer";
import { HELPLINES } from "@/lib/site";

const RESULT_STEPS = [
  { id: "detected", tone: "det", title: "Detected", points: ["See a neurologist and take your PDF report.", "Note any changes you have noticed in movement, voice or walking."] },
  { id: "inconclusive", tone: "inc", title: "Inconclusive", points: ["Record again on another day in a quiet room.", "See a doctor if it stays inconclusive or you have symptoms."] },
  { id: "not-detected", tone: "not", title: "Not detected", points: ["No markers were found in this recording.", "A screen cannot rule Parkinson’s out — see a doctor about any symptoms."] },
];

const JOURNEY = [
  { icon: CalendarCheck, title: "Book a neurologist", body: "Through a general physician or a hospital neurology OPD." },
  { icon: Stethoscope, title: "Clinical examination", body: "The neurologist asks about symptoms and examines movement, walking and balance." },
  { icon: ClipboardList, title: "Diagnosis", body: "Only a doctor can diagnose Parkinson’s. Tests may be used to rule out other conditions." },
  { icon: Users, title: "Care plan", body: "If needed, the care team agrees a plan suited to the person." },
  { icon: RefreshCw, title: "Regular reviews", body: "Follow-up visits review how things are going. Bring your reports and Progress charts." },
];

const CARE = [
  { icon: Users, title: "A care team", body: "Care is usually led by a neurologist and can involve physiotherapists, speech and occupational therapists, and counsellors." },
  { icon: Dumbbell, title: "Therapies & activity", body: "Physiotherapy, speech therapy and staying physically active are commonly part of care — as advised by the care team." },
  { icon: HeartHandshake, title: "Support", body: "Support groups (such as PDMDS) and helplines help people and families. Mental-health helpline: Tele-MANAS 14416." },
];

export default function NextStepsPage() {
  return (
    <main className="editorial-page content-width next-steps">
      <div className="eyebrow">After your result</div>
      <h1>Next steps and care.</h1>
      <p className="editorial-lead">What to do after a result and what to expect from a doctor. General information only — not medical advice.</p>

      <div className="button-row">
        <Link className="button" href="/specialists?category=neurology"><MapPinned size={17} /> Find a neurologist near you</Link>
        <Link className="button button-outline" href="/specialists?category=physical-therapy">Find physiotherapy</Link>
        <Link className="button button-outline" href="/specialists?category=organizations">Find support organisations</Link>
      </div>

      <section className="result-steps" aria-label="What to do for each result">
        {RESULT_STEPS.map((item) => (
          <article key={item.id} id={item.id} className={`result-step tone-${item.tone}`}>
            <h2>If the result was {item.title}</h2>
            <ul>{item.points.map((point) => <li key={point}>{point}</li>)}</ul>
          </article>
        ))}
      </section>

      <section className="journey">
        <div className="eyebrow">The care journey</div>
        <h2>What usually happens next</h2>
        <ol className="journey-list">
          {JOURNEY.map(({ icon: Icon, title, body }, index) => (
            <li key={title} className="journey-step" style={{ animationDelay: `${index * 120}ms` }}>
              <span className="journey-icon"><Icon size={20} aria-hidden="true" /></span>
              <div><span className="journey-no">Step {index + 1}</span><h3>{title}</h3><p>{body}</p></div>
            </li>
          ))}
        </ol>
      </section>

      <section className="care-options">
        <div className="eyebrow">Care and support</div>
        <h2>Who can help</h2>
        <p className="muted">Decisions about treatment are made by doctors, for each person.</p>
        <div className="care-grid">
          {CARE.map(({ icon: Icon, title, body }) => (
            <article key={title} className="care-card"><span className="care-icon"><Icon size={20} aria-hidden="true" /></span><h3>{title}</h3><p>{body}</p></article>
          ))}
        </div>
      </section>

      <section className="result-change" id="can-it-change">
        <div className="eyebrow">Understanding your results over time</div>
        <h2>Can a “Detected” result change to “Not detected”?</h2>
        <p>Yes — and it is important to know why:</p>
        <div className="change-grid">
          <article><h3><RefreshCw size={17} aria-hidden="true" /> Recordings vary</h3><p>Noise, a cold, tiredness or time of day change voice and walking measures.</p></article>
          <article><h3><MessageCircle size={17} aria-hidden="true" /> False alarms happen</h3><p>About 1 in 7 healthy people receive “Detected”.</p></article>
          <article><h3><Activity size={17} aria-hidden="true" /> Symptoms can change</h3><p>Care and therapy advised by doctors can change voice and walking, and so the score.</p></article>
        </div>
        <div className="change-warning">A change to “Not detected” does <strong>not</strong> mean Parkinson’s has gone. Keep following medical advice; never change care because of a screening result.</div>
        <div className="button-row">
          <Link className="button" href="/progress"><LineChart size={17} /> Track your results over time</Link>
          <Link className="button button-outline" href="/guide">How to record consistently</Link>
        </div>
      </section>

      <section className="sources">
        <h2>Sources and further reading</h2>
        <ul>
          <li><a href="https://www.who.int/news-room/fact-sheets/detail/parkinson-disease" target="_blank" rel="noreferrer">World Health Organization — Parkinson disease fact sheet</a></li>
          <li><a href="https://www.nice.org.uk/guidance/ng71" target="_blank" rel="noreferrer">NICE guideline NG71 — Parkinson’s disease in adults</a></li>
          <li><a href="https://www.parkinsonssocietyindia.com/" target="_blank" rel="noreferrer">Parkinson’s Disease and Movement Disorder Society (India)</a></li>
        </ul>
        <p className="muted">Emergency in India: call {HELPLINES[0]?.value ?? "112"}.</p>
        <Link className="text-link" href="/specialists?category=neurology">Find a neurologist near you <ArrowRight size={15} /></Link>
      </section>
      <MedicalDisclaimer />
    </main>
  );
}
