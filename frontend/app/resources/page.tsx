import Link from "next/link";
import { ArrowRight, ExternalLink } from "lucide-react";
import { MedicalDisclaimer } from "@/components/medical-disclaimer";

export default function ResourcesPage() {
  const resources = [
    {
      title: "Parkinson’s Foundation Specialist Finder",
      source: "parkinson.org",
      description: "Search for Movement Disorder Society accredited centers of excellence, specialized neurologists, and multidisciplinary care teams.",
      href: "https://www.parkinson.org/resources-support/find-a-specialist",
    },
    {
      title: "NINDS Parkinson's Disease Information",
      source: "ninds.nih.gov",
      description: "Comprehensive medical information on symptoms, causes, clinical trials, and emerging treatments from the National Institute of Neurological Disorders and Stroke.",
      href: "https://www.ninds.nih.gov/health-information/disorders/parkinsons-disease",
    },
    {
      title: "Movement Disorder Society (MDS)",
      source: "movementdisorders.org",
      description: "Global professional association of clinicians, scientists, and healthcare providers dedicated to research and clinical care in Parkinson's and movement disorders.",
      href: "https://www.movementdisorders.org/",
    },
    {
      title: "MDS-UPDRS Rating Scale Overview",
      source: "movementdisorders.org",
      description: "Information regarding the unified Parkinson's disease rating scale, the clinical gold standard for monitoring motor signs and disease progression.",
      href: "https://www.movementdisorders.org/MDS/MDS-Rating-Scales/MDS-Unified-Parkinsons-Disease-Rating-Scale-MDS-UPDRS.htm",
    },
  ];

  return (
    <main className="editorial-page content-width">
      <div className="eyebrow">Care &amp; Support</div>
      <h1>Trusted Parkinson’s resources.</h1>
      <p className="editorial-lead">
        Curated links to recognized medical organizations, clinical guidelines, and professional patient advocacy networks.
      </p>
      <div className="editorial-rule" />
      <div className="resource-list">
        {resources.map((item) => (
          <a
            key={item.href}
            href={item.href}
            target="_blank"
            rel="noreferrer"
            className="resource-card"
          >
            <h2>
              {item.title} <span>({item.source})</span> <ExternalLink size={15} style={{ verticalAlign: -1, marginLeft: 4 }} />
            </h2>
            <p>{item.description}</p>
          </a>
        ))}
      </div>
      <div className="button-row">
        <Link className="button" href="/specialists">
          Find a local specialist <ArrowRight size={17} />
        </Link>
      </div>
      <MedicalDisclaimer />
    </main>
  );
}
