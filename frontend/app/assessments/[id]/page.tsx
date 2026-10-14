"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { RequireAuth } from "@/components/require-auth";
import { ErrorMessage, LoadingState } from "@/components/ui";
import { ReportView } from "@/components/report-view";
import { api } from "@/lib/api";
import type { Assessment } from "@/lib/types";

function RecordDetails() {
  const params = useParams<{ id: string }>();
  const [record, setRecord] = useState<Assessment | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { api.assessment(params.id).then(setRecord).catch((caught) => setError(caught.message)); }, [params.id]);
  if (error) return <main className="private-page content-width"><ErrorMessage>{error}</ErrorMessage><Link className="text-link" href="/assessments">Back to assessments</Link></main>;
  if (!record) return <main className="private-page content-width"><LoadingState label="Loading assessment…" /></main>;
  return <main className="private-page content-width">
    <div className="eyebrow">Assessment record</div><h1>Assessment details</h1>
    <section className="detail-card" aria-label="Assessment record details">
      <div className="section-title-row"><div><h2>{record.modality === "voice_gait" ? "Voice + gait assessment" : "Voice assessment"}</h2><p>{new Date(record.created_at).toLocaleString()}</p></div><span className={`status-pill status-${record.status}`}>{record.status === "validation_required" ? "Feature validation required" : record.status === "unavailable" ? "Analysis unavailable" : record.status}</span></div>
      <dl className="detail-list"><div><dt>Record ID</dt><dd><code>{record.id}</code></dd></div><div><dt>Recording length</dt><dd>{record.duration_seconds} seconds</dd></div><div><dt>Submitted files</dt><dd>{record.files.map((file) => file.name).join(", ") || "No file metadata"}</dd></div></dl>
      {record.status === "completed" && record.result
        ? <ReportView report={record} />
        : <div className="result-limit"><strong>{record.status === "processing" ? "Analysis is still processing." : "No report or score is available."}</strong><br />{record.unavailable_reason}</div>}
    </section>
    <div className="button-row"><Link className="button button-outline" href="/assessments">Back to history</Link>{record.status === "completed" && record.result && <Link className="text-link" href={`/reports/${record.id}`}>Open report</Link>}</div>
    <p className="caution-note">This research interface does not diagnose Parkinson’s disease and does not provide medical advice.</p>
  </main>;
}

export default function AssessmentDetailPage() {
  return <RequireAuth><RecordDetails /></RequireAuth>;
}
