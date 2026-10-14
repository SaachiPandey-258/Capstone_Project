"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarDays, ClipboardCheck, Files } from "lucide-react";
import { RequireAuth } from "@/components/require-auth";
import { AssessmentList } from "@/components/assessment-list";
import { EmptyState, ErrorMessage, LoadingState } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import type { Dashboard } from "@/lib/types";

function DashboardContent() {
  const { user } = useAuth();
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api.dashboard().then(setData).catch((caught) => setError(caught.message));
  }, []);
  const latestAssessment = data?.recent_assessments.reduce<Dashboard["recent_assessments"][number] | null>(
    (latest, assessment) => !latest || assessment.created_at > latest.created_at ? assessment : latest,
    null,
  ) ?? null;
  return <main className="private-page content-width">
    <div className="dashboard-welcome"><div><div className="eyebrow">Your private assessment space</div><h1>Welcome, {user?.name.split(" ")[0]}.</h1><p>Review your saved records and choose what to do next.</p></div><Link className="button" href="/assessment/new">Start an assessment <ArrowRight size={17} /></Link></div>
    {error && <ErrorMessage>{error}</ErrorMessage>}
    {!data && !error && <LoadingState label="Loading your dashboard…" />}
    {data && <>
      <section className="stat-grid" aria-label="Account summary">
        <article className="stat-card"><span><Files size={16} aria-hidden="true" /> Assessments saved</span><strong>{data.assessment_count}</strong><small>Records saved to your account</small></article>
        <article className="stat-card"><span><ClipboardCheck size={16} aria-hidden="true" /> Completed reports</span><strong>{data.report_count}</strong><small>Only completed analyses appear here</small></article>
        <article className="stat-card"><span><CalendarDays size={16} aria-hidden="true" /> Latest assessment</span><strong className="stat-date">{latestAssessment ? new Date(latestAssessment.created_at).toLocaleDateString() : "—"}</strong><small>{latestAssessment ? `${latestAssessment.modality === "voice_gait" ? "Voice + gait" : "Voice only"} · ${latestAssessment.status === "validation_required" ? "Feature validation required" : latestAssessment.status === "unavailable" ? "Analysis unavailable" : latestAssessment.status}` : "No assessment records yet"}</small></article>
      </section>
      <section className="content-section"><div className="section-title-row"><div><div className="eyebrow">Your history</div><h2>Recent assessments</h2></div><Link className="text-link" href="/assessments">View all <ArrowRight size={15} /></Link></div>
        {data.recent_assessments.length ? <AssessmentList assessments={data.recent_assessments} /> : <EmptyState title="Your history starts here">When you submit an assessment, its saved record will appear here. No scores are shown unless an analysis actually completes.</EmptyState>}
      </section>
      <p className="caution-note">Records in your history are not diagnoses or recommendations. Discuss health concerns with a qualified clinician.</p>
    </>}
  </main>;
}

export default function DashboardPage() {
  return <RequireAuth><DashboardContent /></RequireAuth>;
}
