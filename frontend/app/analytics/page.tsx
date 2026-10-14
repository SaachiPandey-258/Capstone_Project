"use client";

import { useEffect, useState } from "react";
import { RequireAuth } from "@/components/require-auth";
import { AnalyticsView } from "@/components/analytics-view";
import { ErrorMessage, LoadingState, PageHeading } from "@/components/ui";
import { api } from "@/lib/api";
import type { Assessment } from "@/lib/types";

function AnalyticsContent() {
  const [assessments, setAssessments] = useState<Assessment[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { api.assessments().then(setAssessments).catch((caught) => setError(caught.message)); }, []);
  return <main className="private-page content-width">
    <PageHeading eyebrow="Comparable measures" title="Assessment analytics">Patterns appear only when completed results share the same validated measure, unit, and input pathway.</PageHeading>
    {error && <ErrorMessage>{error}</ErrorMessage>}
    {!assessments && !error && <LoadingState label="Loading assessment data…" />}
    {assessments && <AnalyticsView assessments={assessments} />}
  </main>;
}

export default function AnalyticsPage() {
  return <RequireAuth><AnalyticsContent /></RequireAuth>;
}
