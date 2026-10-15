import type { CSSProperties } from "react";

export const UPDRS_BANDS = [
  { label: "Mild", from: 0, to: 32, color: "var(--band-mild)" },
  { label: "Moderate", from: 32, to: 58, color: "var(--band-moderate)" },
  { label: "Severe", from: 58, to: 108, color: "var(--band-severe)" },
] as const;

const CX = 130;
const CY = 128;
const R = 100;

function point(value: number, max: number, radius = R) {
  const angle = Math.PI * (1 - value / max);
  return [CX + radius * Math.cos(angle), CY - radius * Math.sin(angle)];
}

function arc(from: number, to: number, max: number) {
  const [x1, y1] = point(from, max);
  const [x2, y2] = point(to, max);
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${R} ${R} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

/** Semicircular gauge for the estimated motor UPDRS (Part III) score. */
export function SeverityGauge({ value, max = 108, muted = false }: { value: number; max?: number; muted?: boolean }) {
  const clamped = Math.max(0, Math.min(max, value));
  const rotation = (clamped / max) * 180 - 90;
  const ticks = [0, 32, 58, 108];
  return (
    <svg className={muted ? "severity-gauge muted" : "severity-gauge"} viewBox="0 0 260 158" role="img"
      aria-label={`Estimated motor UPDRS ${value.toFixed(1)} of ${max}`}>
      <path d={arc(0, max, max)} className="gauge-track" />
      {UPDRS_BANDS.map((band) => (
        <path key={band.label} d={arc(band.from + 0.6, band.to - 0.6, max)} className="gauge-band" style={{ stroke: band.color }} />
      ))}
      {ticks.map((tick) => {
        const [x, y] = point(tick, max, R - 24);
        return <text key={tick} x={x} y={y + 4} className="gauge-tick" textAnchor="middle">{tick}</text>;
      })}
      <g className="gauge-needle" style={{ "--needle": `${rotation}deg` } as CSSProperties}>
        <path d={`M ${CX - 4} ${CY} L ${CX} ${CY - R + 14} L ${CX + 4} ${CY} Z`} />
      </g>
      <circle cx={CX} cy={CY} r="9" className="gauge-hub" />
    </svg>
  );
}
