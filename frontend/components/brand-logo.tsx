import { useId } from "react";

/** Brand mark: a voice waveform inside a rounded shield, the portal's two ideas (voice + care). */
export function BrandMark({ size = 40, animated = false }: { size?: number; animated?: boolean }) {
  const id = useId().replace(/:/g, "");
  const bars = [
    { x: 11, h: 8 },
    { x: 16, h: 16 },
    { x: 21, h: 24 },
    { x: 26, h: 14 },
    { x: 31, h: 20 },
  ];
  return (
    <svg className={animated ? "brand-svg animated" : "brand-svg"} width={size} height={size} viewBox="0 0 44 44" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1d4f8f" />
          <stop offset="1" stopColor="#0f2c52" />
        </linearGradient>
        <linearGradient id={`${id}-wave`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7fe0c8" />
          <stop offset="1" stopColor="#bcd6f7" />
        </linearGradient>
      </defs>
      <path d="M22 2.5c6.4 0 12.6 1.6 17 4.4v14.6c0 9.7-7.2 17.2-17 20-9.8-2.8-17-10.3-17-20V6.9C9.4 4.1 15.6 2.5 22 2.5Z" fill={`url(#${id}-bg)`} />
      {bars.map((bar, index) => (
        <rect key={bar.x} className="brand-bar" style={{ animationDelay: `${index * 0.12}s` }}
          x={bar.x - 1.6} y={21 - bar.h / 2} width="3.2" height={bar.h} rx="1.6" fill={`url(#${id}-wave)`} />
      ))}
    </svg>
  );
}

export function BrandLogo({ animated = false }: { animated?: boolean }) {
  return (
    <span className="brand-lockup">
      <BrandMark animated={animated} />
      <span className="brand-copy">
        <strong>Parkinson’s</strong>
        <small>Assessment &amp; Monitoring</small>
      </span>
    </span>
  );
}
