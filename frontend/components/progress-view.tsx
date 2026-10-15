"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Activity, ArrowDownRight, ArrowUpRight, AudioLines, Gauge, Mic } from "lucide-react";
import {
  CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { Assessment } from "@/lib/types";
import { reportFindings } from "@/lib/report";
import { ProgressIllustration } from "@/components/illustrations";

const MEASURES = [
  { key: "CPPS", label: "Voice clarity (CPPS, dB)", hint: "Higher usually means a clearer, less breathy voice." },
  { key: "F0 SD (semitones)", label: "Pitch steadiness (F0 SD, semitones)", hint: "Lower means a steadier pitch while holding “aaah”." },
  { key: "HNR", label: "Harmonics-to-noise ratio (dB)", hint: "Higher means less noise in the voice." },
  { key: "Jitter(%)", label: "Jitter (cycle-to-cycle pitch variation)", hint: "Lower means more regular vocal-fold vibration." },
  { key: "Shimmer", label: "Shimmer (cycle-to-cycle loudness variation)", hint: "Lower means steadier loudness." },
] as const;

type Point = {
  date: string;
  probability: number | null;
  verdict: string;
  updrs: number;
  measures: Record<string, number | null>;
};

function points(assessments: Assessment[]): { series: Point[]; low: number; high: number } {
  const completed = assessments
    .filter((item) => item.status === "completed" && item.result)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const latest = completed.length ? reportFindings(completed[completed.length - 1]) : null;
  // Probabilities from different screening models are not comparable; follow the latest one.
  const model = completed.length ? completed[completed.length - 1].result?.screening_model : undefined;
  const series = completed.map((item) => {
    const findings = reportFindings(item)!;
    const features = item.extracted_features ?? {};
    return {
      date: new Date(item.created_at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
      probability: item.result?.screening_model === model && findings.probability !== null
        ? Math.round(findings.probability * 100) : null,
      verdict: findings.verdict,
      updrs: Number(findings.score.toFixed(1)),
      measures: Object.fromEntries(MEASURES.map(({ key }) => [key, typeof features[key] === "number" ? features[key] : null])),
    };
  });
  return { series, low: (latest?.low ?? 0.35) * 100, high: (latest?.high ?? 0.7) * 100 };
}

export function ProgressView({ assessments }: { assessments: Assessment[] }) {
  const [measure, setMeasure] = useState<(typeof MEASURES)[number]["key"]>("CPPS");
  const { series, low, high } = useMemo(() => points(assessments), [assessments]);
  const withProbability = series.filter((point) => point.probability !== null);
  const measureInfo = MEASURES.find((item) => item.key === measure)!;
  const measureSeries = series
    .filter((point) => point.measures[measure] !== null)
    .map((point) => ({ date: point.date, value: Number((point.measures[measure] as number).toPrecision(4)) }));

  if (series.length < 2) {
    return <section className="empty-hero">
      <ProgressIllustration />
      <div>
        <h2>Not enough comparable data yet</h2>
        <p>Trends appear once you have at least two completed assessments. Record a steady “aaah” at a similar time of day each week to see how voice measures change.</p>
        <p className="muted">{series.length === 1 ? "You have one completed assessment so far." : "You have no completed assessments yet."}</p>
        <div className="button-row"><Link className="button" href="/assessment/new"><Mic size={16} /> Record an assessment</Link><Link className="text-link" href="/guide">Recording guide</Link></div>
      </div>
    </section>;
  }

  const first = withProbability[0];
  const last = withProbability[withProbability.length - 1];
  const change = first && last ? last.probability! - first.probability! : null;

  return <div className="progress-layout">
    <section className="summary-strip" aria-label="Progress summary">
      <div><Activity size={18} aria-hidden="true" /><span>Completed assessments</span><strong>{series.length}</strong></div>
      <div><Gauge size={18} aria-hidden="true" /><span>Latest screening</span><strong>{series[series.length - 1].verdict}</strong></div>
      <div>{change !== null && change > 0 ? <ArrowUpRight size={18} aria-hidden="true" /> : <ArrowDownRight size={18} aria-hidden="true" />}<span>Probability change</span><strong>{change === null ? "—" : `${change > 0 ? "+" : ""}${change} pts`}</strong></div>
      <div><AudioLines size={18} aria-hidden="true" /><span>Latest voice clarity</span><strong>{typeof series[series.length - 1].measures.CPPS === "number" ? `${(series[series.length - 1].measures.CPPS as number).toFixed(1)} dB` : "—"}</strong></div>
    </section>

    <section className="analytics-card">
      <div className="chart-head"><div><div className="eyebrow">Screening</div><h2>Model probability over time</h2></div>
        <ul className="zone-legend"><li className="zone-not">Not detected &lt; {Math.round(low)}%</li><li className="zone-inc">Inconclusive</li><li className="zone-det">Detected ≥ {Math.round(high)}%</li></ul></div>
      <div className="chart-wrap" role="img" aria-label={`Screening probability over ${withProbability.length} assessments`}>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={withProbability} margin={{ top: 12, right: 18, left: 0, bottom: 8 }}>
            <ReferenceArea y1={0} y2={low} fill="#3f9b74" fillOpacity={0.08} />
            <ReferenceArea y1={low} y2={high} fill="#d79a2b" fillOpacity={0.09} />
            <ReferenceArea y1={high} y2={100} fill="#c2493f" fillOpacity={0.08} />
            <CartesianGrid stroke="#e2e8f1" vertical={false} />
            <XAxis dataKey="date" tickLine={false} axisLine={false} />
            <YAxis domain={[0, 100]} unit="%" tickLine={false} axisLine={false} width={54} />
            <Tooltip formatter={(value, _name, item) => [`${value}% · ${(item.payload as Point).verdict}`, "Screening"]} />
            <Line type="monotone" dataKey="probability" stroke="#1d4f8f" strokeWidth={3} dot={{ r: 5, fill: "#1d4f8f" }} activeDot={{ r: 7 }} animationDuration={900} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="trend-warning">Single recordings vary. Look for consistent changes across several assessments, and discuss them with a neurologist rather than reacting to one result.</p>
    </section>

    <section className="analytics-card">
      <div className="chart-head"><div><div className="eyebrow">Voice measures</div><h2>{measureInfo.label}</h2><p className="muted">{measureInfo.hint}</p></div>
        <label className="measure-picker">Measure<select value={measure} onChange={(event) => setMeasure(event.target.value as typeof measure)}>{MEASURES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label></div>
      {measureSeries.length >= 2
        ? <div className="chart-wrap" role="img" aria-label={`${measureInfo.label} over ${measureSeries.length} assessments`}>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={measureSeries} margin={{ top: 12, right: 18, left: 0, bottom: 8 }}>
                <CartesianGrid stroke="#e2e8f1" vertical={false} />
                <XAxis dataKey="date" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} width={56} domain={["auto", "auto"]} />
                <Tooltip formatter={(value) => [value, measureInfo.label]} />
                <Line type="monotone" dataKey="value" stroke="#2f8f78" strokeWidth={3} dot={{ r: 5, fill: "#2f8f78" }} activeDot={{ r: 7 }} animationDuration={900} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        : <p className="muted">This measure is available only for recorded or uploaded audio. Record at least two voice assessments to see it.</p>}
    </section>
  </div>;
}
