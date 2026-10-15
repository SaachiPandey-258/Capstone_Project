import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { MedicalDisclaimer } from "@/components/medical-disclaimer";

export default function AboutPage() {
  return (
    <main className="editorial-page content-width">
      <div className="eyebrow">Our Approach</div>
      <h1>Honest limits, meaningful observations.</h1>
      <p className="editorial-lead">
        This platform is built on a simple clinical premise: research machine learning models should assist reflection and clinical dialogue, not fabricate certainty or simulate diagnostic authority.
      </p>
      <div className="editorial-rule" />
      <div className="editorial-columns">
        <div>
          <h2>Responsible AI in Healthcare</h2>
          <p>
            Many digital health tools claim automated diagnosis from casual smartphone recordings. In clinical research, telemonitoring voice recordings and gait force sensors require rigorous acoustic standardization, verified feature extraction (including RPDE, DFA, and PPE metrics), and subject-independent validation.
          </p>
          <p>
            When reference acoustic extraction fixtures or paired sensor streams are not validated, our platform explicitly halts inference and tags records as <strong>Feature validation required</strong> rather than outputting an arbitrary or misleading numerical score.
          </p>
        </div>
        <div>
          <h2>Privacy &amp; Data Ownership</h2>
          <p>
            Your health observations belong to you. Audio files, gait recordings, and metadata are tied directly to your authenticated session and stored in private local storage without third-party tracking or behavioral advertising.
          </p>
          <p>
            You can bring your organized history and validated reports to appointments with your neurologist or movement disorder specialist to support more informed clinical consultations.
          </p>
        </div>
      </div>
      <div className="button-row">
        <Link className="button" href="/register">
          Create an account <ArrowRight size={17} />
        </Link>
        <Link className="text-link" href="/how-it-works">
          Learn how it works <ArrowRight size={16} />
        </Link>
      </div>
      <MedicalDisclaimer />
    </main>
  );
}
