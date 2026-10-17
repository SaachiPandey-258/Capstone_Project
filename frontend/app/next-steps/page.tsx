import Link from "next/link";
import {
  Activity, ArrowRight, Brain, CalendarCheck, ClipboardList, Dumbbell, FileText, HeartHandshake,
  LineChart, MapPinned, MessageCircle, Mic, Pill, RefreshCw, Stethoscope, Zap,
} from "lucide-react";
import { MedicalDisclaimer } from "@/components/medical-disclaimer";
import { HELPLINES } from "@/lib/site";

const RESULT_STEPS = [
  {
    id: "detected",
    tone: "det",
    title: "If your result was Detected",
    points: [
      "Book an appointment with a neurologist, ideally one who sees movement disorders. Take your PDF report.",
      "Write down what you have noticed: tremor, slowness, stiffness, softer voice, smaller handwriting, changes in walking or balance, loss of smell, sleep changes.",
      "Do not start, stop or change any medicine on the basis of this screen.",
    ],
  },
  {
    id: "inconclusive",
    tone: "inc",
    title: "If your result was Inconclusive",
    points: [
      "Record again on another day in a quiet room — one recording can be affected by noise, a cold or tiredness.",
      "If two or three results stay inconclusive, or you have any symptoms, discuss it with a doctor.",
      "Add a walking recording (Voice + gait) if you can — the combined result is inconclusive less often.",
    ],
  },
  {
    id: "not-detected",
    tone: "not",
    title: "If your result was Not detected",
    points: [
      "No voice or walking markers were found in this recording — but a screen cannot rule Parkinson’s out.",
      "If you have symptoms that worry you, see a doctor anyway; symptoms matter more than this result.",
      "Repeating the assessment every few months lets you watch for change on the Progress page.",
    ],
  },
];

const JOURNEY = [
  { icon: CalendarCheck, title: "Book a neurologist", body: "A general physician can refer you, or you can book a neurology OPD directly at a hospital or teaching institute." },
  { icon: Stethoscope, title: "Clinical assessment", body: "The neurologist takes a history and examines movement: slowness (bradykinesia), tremor at rest, stiffness (rigidity), walking and balance." },
  { icon: ClipboardList, title: "Diagnosis", body: "Parkinson’s is diagnosed clinically using the MDS criteria. There is no single blood test. An MRI may be done to rule out other causes; a DaT scan is used in some uncertain cases." },
  { icon: FileText, title: "Care plan", body: "If Parkinson’s is diagnosed, the neurologist explains the stage and agrees a plan: medicines, therapies, exercise and follow-up." },
  { icon: Activity, title: "Treatment & therapies", body: "Medicines to manage symptoms, plus speech, physio and occupational therapy. The plan is adjusted over time." },
  { icon: RefreshCw, title: "Regular reviews", body: "Follow-up visits check how symptoms and medicines are working. Bring your Progress charts and reports." },
];

const CARE = [
  { icon: Pill, title: "Medicines", body: "Levodopa is the most effective medicine for movement symptoms; dopamine agonists, MAO-B inhibitors and others are also used. Choice and dose are decided by the neurologist and changed over time — never self-medicate." },
  { icon: Mic, title: "Speech & voice therapy", body: "A speech-language therapist can help with a soft or monotone voice and swallowing. Programmes such as LSVT LOUD train louder, clearer speech." },
  { icon: Dumbbell, title: "Physiotherapy & exercise", body: "Gait training, cueing (rhythm or visual cues), strength and balance work. Regular exercise — walking, cycling, yoga, tai chi — helps mobility and balance." },
  { icon: HeartHandshake, title: "Occupational therapy & daily life", body: "Practical help with dressing, writing, home safety and staying independent at work and at home." },
  { icon: Zap, title: "Advanced treatments", body: "For some people with longer-standing Parkinson’s, deep brain stimulation (DBS) or other device-based therapies may be considered by a specialist team." },
  { icon: Brain, title: "Mood, sleep & support", body: `Low mood, anxiety and sleep problems are common and treatable. Support groups (such as PDMDS) help people and families. Mental-health helpline: Tele-MANAS ${HELPLINES[1]?.value ?? "14416"}.` },
];

export default function NextStepsPage() {
  return (
    <main className="editorial-page content-width next-steps">
      <div className="eyebrow">After your result</div>
      <h1>Next steps, diagnosis and care.</h1>
      <p className="editorial-lead">What to do after a screening result, what happens when you see a neurologist, and how Parkinson’s is treated. This page is general information, not medical advice.</p>

      <div className="button-row">
        <Link className="button" href="/specialists?category=neurology"><MapPinned size={17} /> Find a neurologist near you</Link>
        <Link className="button button-outline" href="/specialists?category=physical-therapy">Find physiotherapy</Link>
        <Link className="button button-outline" href="/specialists?category=organizations">Find support organisations</Link>
      </div>

      <section className="result-steps" aria-label="What to do for each result">
        {RESULT_STEPS.map((item) => (
          <article key={item.id} id={item.id} className={`result-step tone-${item.tone}`}>
            <h2>{item.title}</h2>
            <ul>{item.points.map((point) => <li key={point}>{point}</li>)}</ul>
          </article>
        ))}
      </section>

      <section className="journey">
        <div className="eyebrow">The care journey</div>
        <h2>What usually happens after you see a doctor</h2>
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
        <div className="eyebrow">Treatment and care</div>
        <h2>How Parkinson’s is managed</h2>
        <p className="muted">There is currently no cure, but treatment can control symptoms well for many years. Care is usually a team effort.</p>
        <div className="care-grid">
          {CARE.map(({ icon: Icon, title, body }) => (
            <article key={title} className="care-card"><span className="care-icon"><Icon size={20} aria-hidden="true" /></span><h3>{title}</h3><p>{body}</p></article>
          ))}
        </div>
      </section>

      <section className="result-change" id="can-it-change">
        <div className="eyebrow">Understanding your results over time</div>
        <h2>Can a “Detected” result change to “Not detected”?</h2>
        <p>Yes, the screening result can change between assessments — but it is important to understand <strong>why</strong>:</p>
        <div className="change-grid">
          <article><h3><RefreshCw size={17} aria-hidden="true" /> Recordings vary</h3><p>Background noise, a cold, tiredness or the time of day change voice and walking measures. That is why a single result should never be over-interpreted.</p></article>
          <article><h3><MessageCircle size={17} aria-hidden="true" /> The first result was a false alarm</h3><p>About 1 in 7 healthy people receive “Detected”. Repeated “Not detected” results, together with a normal doctor’s examination, make this likely.</p></article>
          <article><h3><Activity size={17} aria-hidden="true" /> Treatment improves symptoms</h3><p>Medicines, voice therapy (e.g. LSVT LOUD) and physiotherapy can make the voice louder and clearer and walking more regular, which can lower the score.</p></article>
          <article><h3><Pill size={17} aria-hidden="true" /> Medicine timing</h3><p>Symptoms often differ when medicine is working (“on”) or wearing off (“off”). Record at a similar time relative to doses to compare fairly.</p></article>
        </div>
        <div className="change-warning">
          <strong>What it does not mean:</strong> a change from Detected to Not detected after treatment shows that symptoms in your voice or walking have improved — <strong>not that Parkinson’s has gone</strong>. Parkinson’s is a long-term condition; keep following your neurologist’s plan, and never stop medicines because of a screening result.
        </div>
        <div className="button-row">
          <Link className="button" href="/progress"><LineChart size={17} /> Track your results over time</Link>
          <Link className="button button-outline" href="/guide">How to record consistently</Link>
        </div>
      </section>

      <section className="sources">
        <h2>Sources and further reading</h2>
        <ul>
          <li><a href="https://www.who.int/news-room/fact-sheets/detail/parkinson-disease" target="_blank" rel="noreferrer">World Health Organization — Parkinson disease fact sheet</a></li>
          <li><a href="https://www.nice.org.uk/guidance/ng71" target="_blank" rel="noreferrer">NICE guideline NG71 — Parkinson’s disease in adults (diagnosis and management)</a></li>
          <li><a href="https://pubmed.ncbi.nlm.nih.gov/26474316/" target="_blank" rel="noreferrer">Postuma et al. (2015) — MDS clinical diagnostic criteria for Parkinson’s disease, Movement Disorders</a></li>
          <li><a href="https://www.lsvtglobal.com/" target="_blank" rel="noreferrer">LSVT Global — LSVT LOUD speech therapy programme</a></li>
          <li><a href="https://www.parkinsonssocietyindia.com/" target="_blank" rel="noreferrer">Parkinson’s Disease and Movement Disorder Society (India) — support groups and therapy programmes</a></li>
        </ul>
        <p className="muted">Emergency in India: call {HELPLINES[0]?.value ?? "112"}.</p>
        <Link className="text-link" href="/specialists?category=neurology">Find a neurologist near you <ArrowRight size={15} /></Link>
      </section>
      <MedicalDisclaimer />
    </main>
  );
}
