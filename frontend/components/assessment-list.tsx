import Link from "next/link";
import type { Assessment } from "@/lib/types";

export function AssessmentList({ assessments }: { assessments: Assessment[] }) {
  return <div className="assessment-list">{assessments.map((item) => (
    <Link className="assessment-row" href={`/assessments/${item.id}`} key={item.id}>
      <span className="assessment-symbol" aria-hidden="true">{item.modality === "voice_gait" ? "↗" : "◌"}</span>
      <span className="assessment-main"><strong>{item.modality === "voice_gait" ? "Voice + gait assessment" : "Voice assessment"}</strong><small>{new Date(item.created_at).toLocaleString()} · {item.files.length} file{item.files.length === 1 ? "" : "s"}</small></span>
      <span className={`status-pill status-${item.status}`}>{statusLabel(item.status)}</span>
      <span className="assessment-arrow" aria-hidden="true">→</span>
    </Link>
  ))}</div>;
}

function statusLabel(status: Assessment["status"]) {
  if (status === "validation_required") return "Feature validation required";
  if (status === "unavailable") return "Analysis unavailable";
  return status.charAt(0).toUpperCase() + status.slice(1);
}
