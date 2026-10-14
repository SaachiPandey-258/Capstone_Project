import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Assessment } from "@/lib/types";

type TrendResult = { trend_value: number; metric_name: string; unit: string };

function trendResult(assessment: Assessment): TrendResult | null {
  if (assessment.status !== "completed" || !assessment.result) return null;
  const value = assessment.result.trend_value;
  const metric = assessment.result.metric_name;
  const unit = assessment.result.unit;
  if (typeof value !== "number" || !Number.isFinite(value) || typeof metric !== "string" || typeof unit !== "string") return null;
  return { trend_value: value, metric_name: metric, unit };
}

export function AnalyticsView({ assessments }: { assessments: Assessment[] }) {
  const comparable = useMemo(() => assessments
    .map((assessment) => ({ assessment, metric: trendResult(assessment) }))
    .filter((item): item is { assessment: Assessment; metric: TrendResult } => item.metric !== null)
    .sort((a, b) => a.assessment.created_at.localeCompare(b.assessment.created_at)), [assessments]);

  const metricKey = comparable[0]?.metric.metric_name;
  const unit = comparable[0]?.metric.unit;
  const modality = comparable[0]?.assessment.modality;
  const sameMetric = comparable.filter((item) =>
    item.metric.metric_name === metricKey
    && item.metric.unit === unit
    && item.assessment.modality === modality,
  );
  const hasTrend = sameMetric.length >= 2;
  const chartData = sameMetric.map(({ assessment, metric }) => ({
    date: new Date(assessment.created_at).toLocaleDateString(),
    value: metric.trend_value,
  }));

  return <section className="analytics-card" aria-live="polite">
    <div className="eyebrow">Comparable completed measures</div>
    {hasTrend ? <>
      <h2>{metricKey} over time</h2><p className="muted">Only completed results with the same measure and unit are shown. This chart is descriptive, not diagnostic.</p>
      <div className="chart-wrap" role="img" aria-label={`${metricKey} over ${sameMetric.length} completed comparable assessments`}><ResponsiveContainer width="100%" height={280}><LineChart data={chartData} margin={{ top: 12, right: 18, left: 0, bottom: 8 }}><CartesianGrid stroke="#e2e8f1" vertical={false} /><XAxis dataKey="date" tickLine={false} axisLine={false} /><YAxis unit={` ${unit}`} tickLine={false} axisLine={false} /><Tooltip formatter={(value) => [`${value} ${unit}`, metricKey]} /><Line type="monotone" dataKey="value" stroke="#28518a" strokeWidth={3} dot={{ r: 4, fill: "#28518a" }} activeDot={{ r: 6 }} /></LineChart></ResponsiveContainer></div>
    </> : <div className="empty-analytics"><h2>Not enough comparable data yet</h2><p>Progress trends require at least two completed assessments with the same validated measure and unit. Current records may be unavailable, incomplete, or use different modalities.</p></div>}
    <p className="trend-warning">Different assessment types or incomplete analyses must not be compared. This view does not assign disease stages or diagnoses.</p>
  </section>;
}
