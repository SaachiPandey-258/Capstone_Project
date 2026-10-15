"use client";

import { useEffect, useState } from "react";
import { RequireAuth } from "@/components/require-auth";
import { ProgressView } from "@/components/progress-view";
import { ErrorMessage, LoadingState, PageHeading } from "@/components/ui";
import { api } from "@/lib/api";
import type { Assessment } from "@/lib/types";

function ProgressContent() {
  const [assessments, setAssessments] = useState<Assessment[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { api.assessments().then(setAssessments).catch((caught) => setError(caught.message)); }, []);
  return <main className="private-page content-width">
    <PageHeading eyebrow="Your trends" title="Progress">
      How your screening result and voice measures change across completed assessments.
    </PageHeading>
    {error && <ErrorMessage>{error}</ErrorMessage>}
    {!assessments && !error && <LoadingState label="Loading your progress…" />}
    {assessments && <ProgressView assessments={assessments} />}
  </main>;
}

export default function ProgressPage() {
  return <RequireAuth><ProgressContent /></RequireAuth>;
}
