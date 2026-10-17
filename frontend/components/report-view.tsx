import type { CSSProperties } from "react";
import Link from "next/link";
import { MapPinned } from "lucide-react";
import type { Assessment } from "@/lib/types";
import { SeverityGauge, UPDRS_BANDS } from "@/components/severity-gauge";
import { BrandMark } from "@/components/brand-logo";
import {
  assessmentRows,
  featureRows,
  formatDateTime,
  gaitRows,
  participantRows,
  reportFindings,
  reportNumber,
  tierLabel,
  NEXT_STEP_ANCHOR,
  NEXT_STEP_TEXT,
  reportNotes,
  reportTitle,
} from "@/lib/report";

export function ReportView({ report }: { report: Assessment }) {
  const findings = report.status === "completed" ? reportFindings(report) : null;
  if (!findings) {
    return <section className="empty-state report-unavailable" aria-labelledby="report-status">
      <span className="status-pill status-unavailable">No completed analysis</span>
      <h2 id="report-status">There is no report to display</h2>
      <p>This assessment does not include a completed, validated analysis. No score, prediction, disease stage, or diagnosis is available.</p>
    </section>;
  }
  const features = featureRows(report);
  const half = Math.ceil(features.length / 2);
  const gait = gaitRows(report);
  let sectionNo = 3;
  const detectionClass = findings.tier === "detected" ? "positive" : findings.tier === "not_detected" ? "negative" : findings.tier === "inconclusive" ? "borderline" : "neutral";
  const severityApplies = findings.tier === "detected";
  return <article className="formal-report" aria-labelledby="report-heading">
    <header className="formal-report-head">
      <div className="formal-report-brand"><BrandMark size={36} /><div><strong>Parkinson’s Assessment &amp; Monitoring</strong><small>Research voice analysis</small></div></div>
      <div className="formal-report-ids">
        <span>Report no. <strong>{reportNumber(report)}</strong></span>
        <span>Issued {formatDateTime(report.created_at)}</span>
      </div>
    </header>
    <h2 id="report-heading" className="formal-report-title">{reportTitle(report)}</h2>

    <section className="formal-section">
      <h3>1. Participant information</h3>
      <dl className="formal-grid">{participantRows(report).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    </section>

    <section className="formal-section">
      <h3>2. Assessment details</h3>
      <dl className="formal-grid">{assessmentRows(report).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    </section>

    <section className="formal-section">
      <h3>3. Findings</h3>
      <div className={severityApplies ? "findings-grid" : "findings-grid single"}>
        <div className={`detection-card ${detectionClass}`}>
          <span className="detection-label">{findings.combined ? "Voice + gait screening" : "Voice screening"}</span>
          <strong className="detection-verdict">{findings.verdict}</strong>
          {findings.probability !== null && <div className="probability">
            <div className="probability-track zoned" aria-hidden="true" style={{ "--low": `${findings.low * 100}%`, "--high": `${findings.high * 100}%` } as CSSProperties}>
              <span className="probability-marker" style={{ "--fill": `${(findings.probability * 100).toFixed(1)}%` } as CSSProperties} />
            </div>
            <div className="probability-scale"><span>Not detected</span><span>Inconclusive</span><span>Detected</span></div>
            <div className="probability-legend"><span>Probability <strong>{(findings.probability * 100).toFixed(0)}%</strong></span></div>
          </div>}
          {findings.parts.length > 0 && <div className="screening-parts" aria-label="Contributing models">
            {findings.parts.map((part) => <div key={part.label} className={`screening-part tier-${part.tier}`}>
              <span className="screening-part-label">{part.label}</span>
              <div className="mini-track" style={{ "--low": `${part.low * 100}%`, "--high": `${part.high * 100}%` } as CSSProperties}>
                <span className="mini-marker" style={{ left: `${part.probability * 100}%` }} />
              </div>
              <span className="screening-part-value">{Math.round(part.probability * 100)}% · {tierLabel(part.tier)}</span>
            </div>)}
          </div>}
          {findings.reliability && <p className="detection-reliability">{findings.reliability}</p>}
          {findings.gaitNote && <p className="field-hint">{findings.gaitNote}</p>}
        </div>
        {severityApplies && <div className="gauge-card">
          <span className="detection-label">Estimated severity (motor UPDRS)</span>
          <SeverityGauge value={findings.score} max={findings.max} />
          <div className="gauge-readout"><strong>{findings.score.toFixed(1)}</strong><span>{findings.mae ? ` ± ${findings.mae.toFixed(0)}` : ""} / {findings.max}</span></div>
          <span className={`severity-chip band-${findings.band.toLowerCase()}`}>{findings.band}</span>
          <ul className="gauge-legend">{UPDRS_BANDS.map((band) => <li key={band.label}><i style={{ background: band.color }} />{band.label}</li>)}</ul>
        </div>}
      </div>
      {findings.tier && <div className={`next-step-box tone-${findings.tier}`}>
        <div><strong>Next step:</strong> {NEXT_STEP_TEXT[findings.tier]}</div>
        <div className="next-step-actions">
          <Link className="button button-small" href="/specialists?category=neurology"><MapPinned size={15} /> Find a neurologist</Link>
          <Link className="button button-small button-outline" href={`/next-steps#${NEXT_STEP_ANCHOR[findings.tier]}`}>Next steps &amp; care</Link>
        </div>
      </div>}
      {report.result?.screening_unavailable_reason && <p className="field-hint">Screening unavailable: {String(report.result.screening_unavailable_reason)}</p>}
    </section>

    {features.length > 0 && <section className="formal-section">
      <h3>{++sectionNo}. Acoustic measurements</h3>
      <div className="formal-table-wrap"><table className="formal-table">
        <thead><tr><th>Feature</th><th>Value</th><th>Feature</th><th>Value</th></tr></thead>
        <tbody>{Array.from({ length: half }, (_, row) => <tr key={row}>
          <td>{features[row][0]}</td><td>{features[row][1]}</td>
          <td>{features[row + half]?.[0] ?? ""}</td><td>{features[row + half]?.[1] ?? ""}</td>
        </tr>)}</tbody>
      </table></div>
    </section>}

    {gait.length > 0 && <section className="formal-section">
      <h3>{++sectionNo}. Gait measurements</h3>
      <div className="formal-table-wrap"><table className="formal-table">
        <thead><tr><th>Measure</th><th>Value</th><th>Measure</th><th>Value</th></tr></thead>
        <tbody>{Array.from({ length: Math.ceil(gait.length / 2) }, (_, row) => {
          const right = gait[row + Math.ceil(gait.length / 2)];
          return <tr key={row}><td>{gait[row][0]}</td><td>{gait[row][1]}</td><td>{right?.[0] ?? ""}</td><td>{right?.[1] ?? ""}</td></tr>;
        })}</tbody>
      </table></div>
    </section>}

    <section className="formal-section formal-notes">
      <h3>{++sectionNo}. Notes</h3>
      <ul>{reportNotes(report, findings).map((note) => <li key={note}>{note}</li>)}</ul>
    </section>

    <footer className="formal-report-foot">
      <span>Record ID {report.id}</span>
      <span>Research output only · Not a diagnosis or medical advice</span>
    </footer>
  </article>;
}
