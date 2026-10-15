"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Mic, Trash2, X } from "lucide-react";
import { RequireAuth } from "@/components/require-auth";
import { ReportDownload } from "@/components/report-download";
import { ReportView } from "@/components/report-view";
import { ErrorMessage, LoadingState } from "@/components/ui";
import { api } from "@/lib/api";
import type { Assessment } from "@/lib/types";

function ReportDetails() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const justSubmitted = useSearchParams().get("submitted") === "1";
  const [report, setReport] = useState<Assessment | null>(null);
  const [error, setError] = useState("");
  const [bannerOpen, setBannerOpen] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    api.report(params.id).then(setReport).catch((caught) => setError(caught.message));
  }, [params.id]);

  async function remove() {
    setDeleting(true);
    try {
      await api.deleteAssessment(params.id);
      router.push("/reports");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The report could not be deleted.");
      setDeleting(false);
    }
  }

  return (
    <main className="private-page content-width">
      {justSubmitted && bannerOpen && report && <div className="success-banner" role="status">
        <span className="success-check" aria-hidden="true"><CheckCircle2 size={22} /></span>
        <div><strong>Assessment submitted — your report is ready.</strong><p>It has been saved to Reports and My assessments. Download the PDF to share it with your neurologist.</p></div>
        <button type="button" className="icon-button" aria-label="Dismiss" onClick={() => setBannerOpen(false)}><X size={16} /></button>
      </div>}
      <div className="report-toolbar">
        <div><div className="eyebrow">Clinical records</div><h1>Assessment report</h1></div>
        {report && <div className="button-row">
          <ReportDownload report={report} />
          <Link className="button button-outline" href="/assessment/new"><Mic size={16} /> New assessment</Link>
        </div>}
      </div>
      {error && <><ErrorMessage>{error}</ErrorMessage><Link className="text-link" href="/reports">Back to reports</Link></>}
      {!report && !error && <LoadingState label="Loading your report…" />}
      {report && <>
        <ReportView report={report} />
        <div className="button-row report-footer-actions">
          <Link className="text-link" href="/reports">All reports</Link>
          <Link className="text-link" href="/progress">See progress over time</Link>
          {!confirming
            ? <button type="button" className="icon-text-button danger" onClick={() => setConfirming(true)}><Trash2 size={15} /> Delete report</button>
            : <span className="confirm-delete" role="group" aria-label="Confirm deletion">
                <span>Delete this report and its recording permanently?</span>
                <button type="button" className="button button-small button-danger" onClick={() => void remove()} disabled={deleting}>{deleting ? "Deleting…" : "Delete"}</button>
                <button type="button" className="icon-text-button" onClick={() => setConfirming(false)} disabled={deleting}>Cancel</button>
              </span>}
        </div>
      </>}
    </main>
  );
}

export default function ReportDetailsPage() {
  return <RequireAuth><ReportDetails /></RequireAuth>;
}
