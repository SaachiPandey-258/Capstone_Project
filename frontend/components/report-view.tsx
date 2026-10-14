import type { Assessment } from "@/lib/types";

export function ReportView({ report }: { report: Assessment }) {
  if (report.status !== "completed" || !report.result) {
    return <section className="empty-state report-unavailable" aria-labelledby="report-status">
      <span className="status-pill status-unavailable">No completed analysis</span>
      <h2 id="report-status">There is no report to display</h2>
      <p>This assessment does not include a completed, validated analysis. No score, prediction, disease stage, or diagnosis is available.</p>
    </section>;
  }
  const result = report.result;
  return <section className="report-card" aria-labelledby="report-heading">
    <div className="section-title-row"><div><div className="eyebrow">Completed analysis</div><h2 id="report-heading">Assessment report</h2></div><span className="status-pill status-completed">Completed</span></div>
    <dl className="report-meta-grid">
      <div><dt>Assessment date</dt><dd>{new Date(report.created_at).toLocaleString()}</dd></div>
      <div><dt>Input pathway</dt><dd>{report.modality === "voice_gait" ? "Voice + gait" : "Voice only"}</dd></div>
      <div><dt>Recording length</dt><dd>{report.duration_seconds} seconds</dd></div>
    </dl>
    {typeof result.summary === "string" && <p className="report-summary">{result.summary}</p>}
    <dl className="detail-list">{Object.entries(result).filter(([key, value]) => key !== "summary" && (typeof value === "string" || typeof value === "number")).map(([key, value]) => <div key={key}><dt>{key.replaceAll("_", " ")}</dt><dd>{String(value)}</dd></div>)}</dl>
    <p className="caution-note">Research output only; not a diagnosis or a substitute for professional medical advice.</p>
  </section>;
}
