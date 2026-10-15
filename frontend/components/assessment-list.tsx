"use client";

import { useState } from "react";
import Link from "next/link";
import { AudioLines, CalendarClock, FileText, Footprints, Trash2, UserRound } from "lucide-react";
import type { Assessment } from "@/lib/types";
import { reportFindings } from "@/lib/report";

export function statusLabel(status: Assessment["status"]) {
  if (status === "validation_required") return "Needs a new recording";
  if (status === "unavailable") return "Analysis unavailable";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function AssessmentCard({
  item, onDelete, index,
}: { item: Assessment; onDelete?: (id: string) => Promise<void>; index: number }) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const findings = item.status === "completed" ? reportFindings(item) : null;
  const completed = Boolean(findings);
  const Icon = item.modality === "voice_gait" ? Footprints : AudioLines;

  async function remove() {
    if (!onDelete) return;
    setDeleting(true);
    setError("");
    try {
      await onDelete(item.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The assessment could not be deleted.");
      setDeleting(false);
      setConfirming(false);
    }
  }

  return (
    <article className={`assessment-card tier-${findings?.tier ?? item.status}`} style={{ animationDelay: `${Math.min(index, 8) * 50}ms` }}>
      <div className="assessment-card-top">
        <span className="assessment-icon" aria-hidden="true"><Icon size={19} /></span>
        <div className="assessment-card-title">
          <strong>{item.modality === "voice_gait" ? "Voice + gait assessment" : "Voice assessment"}</strong>
          <small><CalendarClock size={13} aria-hidden="true" /> {new Date(item.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</small>
        </div>
        <span className={`status-pill status-${item.status}`}>{statusLabel(item.status)}</span>
      </div>
      {item.patient?.full_name && <p className="assessment-patient"><UserRound size={14} aria-hidden="true" /> {item.patient.full_name}{item.patient.age ? `, ${item.patient.age} y` : ""}{item.patient.location ? ` · ${item.patient.location}` : ""}</p>}
      {completed && findings ? (
        <div className="assessment-metrics">
          <div><span>Screening</span><strong className={`verdict-text verdict-${findings.tier ?? "none"}`}>{findings.verdict}</strong></div>
          <div><span>Probability</span><strong>{findings.probability === null ? "—" : `${Math.round(findings.probability * 100)}%`}</strong></div>
          <div><span>UPDRS est.</span><strong>{findings.tier === "detected" ? findings.score.toFixed(1) : "n/a"}</strong></div>
        </div>
      ) : (
        <p className="assessment-reason">{item.unavailable_reason || "No analysis is available for this record."}</p>
      )}
      <div className="assessment-actions">
        {completed
          ? <Link className="button button-small" href={`/reports/${item.id}`}><FileText size={15} /> View report</Link>
          : <Link className="button button-small button-outline" href={`/assessments/${item.id}`}>View record</Link>}
        {onDelete && !confirming && <button type="button" className="icon-text-button danger" onClick={() => setConfirming(true)} aria-label={`Delete assessment from ${new Date(item.created_at).toLocaleString()}`}><Trash2 size={15} /> Delete</button>}
        {onDelete && confirming && <span className="confirm-delete" role="group" aria-label="Confirm deletion">
          <span>Delete permanently?</span>
          <button type="button" className="button button-small button-danger" onClick={() => void remove()} disabled={deleting}>{deleting ? "Deleting…" : "Delete"}</button>
          <button type="button" className="icon-text-button" onClick={() => setConfirming(false)} disabled={deleting}>Cancel</button>
        </span>}
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
    </article>
  );
}

export function AssessmentList({
  assessments, onDelete,
}: { assessments: Assessment[]; onDelete?: (id: string) => Promise<void> }) {
  return <div className="assessment-grid">{assessments.map((item, index) => (
    <AssessmentCard key={item.id} item={item} onDelete={onDelete} index={index} />
  ))}</div>;
}
