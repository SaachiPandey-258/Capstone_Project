"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Mic } from "lucide-react";
import { RequireAuth } from "@/components/require-auth";
import { AssessmentList } from "@/components/assessment-list";
import { ReportIllustration } from "@/components/illustrations";
import { ErrorMessage, LoadingState, PageHeading } from "@/components/ui";
import { api } from "@/lib/api";
import type { Assessment } from "@/lib/types";

function ReportsContent() {
  const [reports, setReports] = useState<Assessment[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.reports().then(setReports).catch((err) => setError(err.message));
  }, []);

  async function deleteReport(id: string) {
    await api.deleteAssessment(id);
    setReports((current) => current?.filter((item) => item.id !== id) ?? null);
  }

  return (
    <main className="private-page content-width">
      <div className="page-heading-row">
        <PageHeading eyebrow="Clinical records" title="Reports">
          Every completed assessment produces a formal report you can open, download as PDF, and share with your neurologist.
        </PageHeading>
        <Link className="button" href="/assessment/new"><Mic size={16} /> New assessment</Link>
      </div>

      {error && <ErrorMessage>{error}</ErrorMessage>}
      {!reports && !error && <LoadingState label="Loading your reports…" />}
      {reports && (reports.length > 0
        ? <AssessmentList assessments={reports} onDelete={deleteReport} />
        : <section className="empty-hero">
            <ReportIllustration />
            <div>
              <h2>No reports yet</h2>
              <p>Reports appear here as soon as an assessment is analysed. Assessments that need a better recording stay in your history without a score.</p>
              <div className="button-row">
                <Link className="button" href="/assessment/new">Start an assessment <ArrowRight size={16} /></Link>
                <Link className="text-link" href="/assessments">View saved assessments</Link>
              </div>
            </div>
          </section>)}
    </main>
  );
}

export default function ReportsPage() {
  return <RequireAuth><ReportsContent /></RequireAuth>;
}
