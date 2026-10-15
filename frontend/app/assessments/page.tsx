"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Activity, AlertTriangle, CheckCircle2, ClipboardList, Mic, Plus } from "lucide-react";
import { RequireAuth } from "@/components/require-auth";
import { AssessmentList } from "@/components/assessment-list";
import { ErrorMessage, LoadingState, PageHeading } from "@/components/ui";
import { VoiceIllustration } from "@/components/illustrations";
import { api } from "@/lib/api";
import { reportFindings } from "@/lib/report";
import type { Assessment } from "@/lib/types";

type Filter = "all" | "completed" | "attention";

function AssessmentsContent() {
  const [assessments, setAssessments] = useState<Assessment[] | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    api.assessments().then(setAssessments).catch((err) => setError(err.message));
  }, []);

  async function deleteAssessment(id: string) {
    await api.deleteAssessment(id);
    setAssessments((current) => current?.filter((item) => item.id !== id) ?? null);
  }

  const stats = useMemo(() => {
    const list = assessments ?? [];
    const completed = list.filter((item) => item.status === "completed");
    const latest = completed[0] ? reportFindings(completed[0]) : null;
    return {
      total: list.length,
      completed: completed.length,
      attention: list.length - completed.length,
      latest: latest?.verdict ?? "—",
    };
  }, [assessments]);

  const visible = (assessments ?? []).filter((item) =>
    filter === "all" ? true : filter === "completed" ? item.status === "completed" : item.status !== "completed");

  return (
    <main className="private-page content-width">
      <div className="page-heading-row">
        <PageHeading eyebrow="Assessment history" title="My assessments">
          Every voice and voice + gait assessment saved to your account. Open a report, review a record, or delete what you no longer need.
        </PageHeading>
        <Link className="button" href="/assessment/new"><Plus size={16} /> New assessment</Link>
      </div>

      {error && <ErrorMessage>{error}</ErrorMessage>}
      {!assessments && !error && <LoadingState label="Loading your assessments…" />}
      {assessments && assessments.length > 0 && <>
        <section className="summary-strip" aria-label="Assessment summary">
          <div><ClipboardList size={18} aria-hidden="true" /><span>Total saved</span><strong>{stats.total}</strong></div>
          <div><CheckCircle2 size={18} aria-hidden="true" /><span>With report</span><strong>{stats.completed}</strong></div>
          <div><AlertTriangle size={18} aria-hidden="true" /><span>Need attention</span><strong>{stats.attention}</strong></div>
          <div><Activity size={18} aria-hidden="true" /><span>Latest screening</span><strong>{stats.latest}</strong></div>
        </section>
        <div className="filter-tabs" role="tablist" aria-label="Filter assessments">
          {([["all", `All (${stats.total})`], ["completed", `With report (${stats.completed})`], ["attention", `Need attention (${stats.attention})`]] as const).map(([value, label]) => (
            <button key={value} type="button" role="tab" aria-selected={filter === value} className={filter === value ? "filter-tab active" : "filter-tab"} onClick={() => setFilter(value)}>{label}</button>
          ))}
        </div>
        {visible.length > 0
          ? <AssessmentList assessments={visible} onDelete={deleteAssessment} />
          : <p className="muted filter-empty">No assessments match this filter.</p>}
      </>}
      {assessments && assessments.length === 0 && (
        <section className="empty-hero">
          <VoiceIllustration />
          <div>
            <h2>No assessments yet</h2>
            <p>A voice assessment takes about two minutes: enter the patient’s details, record a steady “aaah” for 5–10 seconds, and your report is ready straight away.</p>
            <div className="button-row">
              <Link className="button" href="/assessment/new"><Mic size={16} /> Start your first assessment</Link>
              <Link className="text-link" href="/guide">See the recording guide</Link>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}

export default function AssessmentsPage() {
  return <RequireAuth><AssessmentsContent /></RequireAuth>;
}
