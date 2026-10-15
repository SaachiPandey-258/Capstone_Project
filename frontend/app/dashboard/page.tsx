"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, BookOpen, CalendarDays, ClipboardCheck, Files, LineChart, MapPinned, Mic } from "lucide-react";
import { RequireAuth } from "@/components/require-auth";
import { AssessmentList } from "@/components/assessment-list";
import { VoiceIllustration } from "@/components/illustrations";
import { ErrorMessage, LoadingState } from "@/components/ui";
import { api } from "@/lib/api";
import { reportFindings } from "@/lib/report";
import { useAuth } from "@/components/auth-provider";
import type { Dashboard } from "@/lib/types";

const ACTIONS = [
  { href: "/assessment/new", icon: Mic, title: "New assessment", body: "Record a 5–10 second “aaah”." },
  { href: "/guide", icon: BookOpen, title: "Recording guide", body: "Tips and a live microphone check." },
  { href: "/progress", icon: LineChart, title: "Progress", body: "See how your measures change." },
  { href: "/specialists", icon: MapPinned, title: "Find care", body: "Neurologists and clinics near you." },
];

function DashboardContent() {
  const { user } = useAuth();
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api.dashboard().then(setData).catch((caught) => setError(caught.message));
  }, []);
  const recent = data?.recent_assessments ?? [];
  const latestCompleted = recent.find((item) => item.status === "completed" && item.result) ?? null;
  const latestFindings = latestCompleted ? reportFindings(latestCompleted) : null;
  const latestAssessment = recent[0] ?? null;

  return <main className="private-page content-width">
    <section className="dashboard-hero">
      <div>
        <div className="eyebrow">Your private assessment space</div>
        <h1>Welcome, {user?.name.split(" ")[0]}.</h1>
        <p>Record a short voice sample, get a structured report, and keep track over time.</p>
        <div className="button-row"><Link className="button" href="/assessment/new"><Mic size={16} /> Start an assessment</Link><Link className="text-link" href="/guide">How to record <ArrowRight size={15} /></Link></div>
      </div>
      <VoiceIllustration />
    </section>
    {error && <ErrorMessage>{error}</ErrorMessage>}
    {!data && !error && <LoadingState label="Loading your dashboard…" />}
    {data && <>
      <section className="stat-grid" aria-label="Account summary">
        <article className="stat-card"><span><Files size={16} aria-hidden="true" /> Assessments saved</span><strong>{data.assessment_count}</strong><small>Records saved to your account</small></article>
        <article className="stat-card"><span><ClipboardCheck size={16} aria-hidden="true" /> Completed reports</span><strong>{data.report_count}</strong><small>Ready to view and download</small></article>
        <article className="stat-card"><span><CalendarDays size={16} aria-hidden="true" /> Latest assessment</span><strong className="stat-date">{latestAssessment ? new Date(latestAssessment.created_at).toLocaleDateString() : "—"}</strong><small>{latestAssessment ? (latestAssessment.modality === "voice_gait" ? "Voice + gait" : "Voice only") : "No assessment records yet"}</small></article>
        {latestFindings && latestCompleted
          ? <Link className={`stat-card latest-result tier-${latestFindings.tier ?? "none"}`} href={`/reports/${latestCompleted.id}`}><span>Latest screening</span><strong className={`verdict-text verdict-${latestFindings.tier ?? "none"}`}>{latestFindings.verdict}</strong><small>{latestFindings.probability !== null ? `${Math.round(latestFindings.probability * 100)}% model probability · ` : ""}Open report →</small></Link>
          : <article className="stat-card"><span>Latest screening</span><strong>—</strong><small>Complete an assessment to see a result</small></article>}
      </section>
      <section className="quick-actions" aria-label="Quick actions">
        {ACTIONS.map(({ href, icon: Icon, title, body }) => <Link key={href} className="quick-action" href={href}><span className="quick-action-icon"><Icon size={20} aria-hidden="true" /></span><strong>{title}</strong><small>{body}</small><ArrowRight className="quick-action-arrow" size={16} aria-hidden="true" /></Link>)}
      </section>
      <section className="content-section"><div className="section-title-row"><div><div className="eyebrow">Your history</div><h2>Recent assessments</h2></div><Link className="text-link" href="/assessments">View all <ArrowRight size={15} /></Link></div>
        {recent.length ? <AssessmentList assessments={recent.slice(0, 4)} /> : <p className="muted">When you submit an assessment, it will appear here.</p>}
      </section>
      <p className="caution-note">Records in your history are not diagnoses or recommendations. Discuss health concerns with a qualified clinician.</p>
    </>}
  </main>;
}

export default function DashboardPage() {
  return <RequireAuth><DashboardContent /></RequireAuth>;
}
