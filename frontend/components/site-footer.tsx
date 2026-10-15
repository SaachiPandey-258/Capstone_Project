import Link from "next/link";
import { ArrowUp, ArrowUpRight, MapPin, Phone, ShieldCheck } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { HELPLINES, INDIA_RESOURCES, SITE } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-main content-width">
        <div className="footer-brand-block">
          <Link className="brand footer-brand" href="/" aria-label="Parkinson’s Assessment home"><BrandLogo /></Link>
          <p>{SITE.tagline}. Record a short voice sample, get a structured research report, and find care near you.</p>
          <ul className="footer-contact">
            <li><MapPin size={15} aria-hidden="true" /><span>{SITE.institution}</span></li>
          </ul>
        </div>
        <nav className="footer-col" aria-label="Platform">
          <strong>Platform</strong>
          <Link href="/assessment/new">New assessment</Link>
          <Link href="/assessments">My assessments</Link>
          <Link href="/reports">Reports</Link>
          <Link href="/progress">Progress</Link>
          <Link href="/specialists">Find care in India</Link>
        </nav>
        <nav className="footer-col" aria-label="Learn">
          <strong>Learn</strong>
          <Link href="/guide">Recording guide</Link>
          <Link href="/how-it-works">How it works</Link>
          <Link href="/resources">Resources</Link>
          <Link href="/about">About the research</Link>
        </nav>
        <div className="footer-col footer-support">
          <strong>Support in India</strong>
          {HELPLINES.map((line) => (
            <span key={line.value} className="footer-helpline"><Phone size={14} aria-hidden="true" />{line.label}: <a href={`tel:${line.value}`}>{line.value}</a></span>
          ))}
          {INDIA_RESOURCES.slice(0, 2).map((resource) => (
            <a key={resource.href} href={resource.href} target="_blank" rel="noreferrer">{resource.name.replace(/ \(.*\)$/, "")} <ArrowUpRight size={13} aria-hidden="true" /></a>
          ))}
        </div>
      </div>
      <div className="footer-disclaimer content-width">
        <ShieldCheck size={18} aria-hidden="true" />
        <p><strong>Not a diagnostic tool.</strong> Results are research outputs and must not be used for treatment decisions. Please consult a qualified neurologist about any symptoms.</p>
      </div>
      <div className="footer-bottom content-width">
        <span>© {new Date().getFullYear()} {SITE.name}. Research use only.</span>
        <span>Maps &amp; listings © OpenStreetMap contributors</span>
        <a className="footer-top" href="#top"><ArrowUp size={14} aria-hidden="true" /> Back to top</a>
      </div>
    </footer>
  );
}
