/** Lightweight animated SVG illustrations (no external images). Decorative only. */

export function VoiceIllustration({ className = "" }: { className?: string }) {
  return (
    <svg className={`illustration voice-illustration ${className}`} viewBox="0 0 320 220" aria-hidden="true">
      <circle cx="160" cy="112" r="96" className="ill-halo" />
      <g className="ill-person">
        <circle cx="120" cy="86" r="26" className="ill-skin" />
        <path d="M94 82c0-18 12-30 28-30 15 0 25 9 27 22-10-6-22-2-30-8-6 9-14 13-25 16Z" className="ill-hair" />
        <path d="M70 196c4-38 24-62 50-62s46 24 50 62Z" className="ill-shirt" />
        <ellipse cx="141" cy="96" rx="5" ry="4" className="ill-mouth" />
      </g>
      <g className="ill-waves">
        <path d="M160 96c8 0 8 0 8 0" />
        <path className="ill-wave w1" d="M164 82a20 20 0 0 1 0 28" />
        <path className="ill-wave w2" d="M174 72a34 34 0 0 1 0 48" />
        <path className="ill-wave w3" d="M184 62a48 48 0 0 1 0 68" />
      </g>
      <g className="ill-phone">
        <rect x="212" y="58" width="58" height="104" rx="12" className="ill-phone-body" />
        <rect x="219" y="70" width="44" height="72" rx="5" className="ill-phone-screen" />
        {[0, 1, 2, 3, 4, 5, 6].map((index) => (
          <rect key={index} className="ill-eq" style={{ animationDelay: `${index * 0.11}s` }} x={224 + index * 5.6} y="96" width="3.2" height="22" rx="1.6" />
        ))}
        <circle cx="241" cy="152" r="4" className="ill-rec" />
      </g>
    </svg>
  );
}

export function ReportIllustration({ className = "" }: { className?: string }) {
  return (
    <svg className={`illustration report-illustration ${className}`} viewBox="0 0 320 220" aria-hidden="true">
      <circle cx="160" cy="112" r="96" className="ill-halo" />
      <rect x="92" y="34" width="136" height="168" rx="10" className="ill-paper" />
      <rect x="108" y="52" width="70" height="8" rx="4" className="ill-line strong" />
      <rect x="108" y="68" width="104" height="5" rx="2.5" className="ill-line" />
      <rect x="108" y="79" width="88" height="5" rx="2.5" className="ill-line" />
      <path d="M126 160a34 34 0 0 1 68 0" className="ill-gauge-track" />
      <path d="M126 160a34 34 0 0 1 22-31.7" className="ill-gauge g1" />
      <path d="M148 128.3a34 34 0 0 1 24 0" className="ill-gauge g2" />
      <path d="M172 128.3a34 34 0 0 1 22 31.7" className="ill-gauge g3" />
      <g className="ill-needle"><path d="M158 160l2-28 2 28Z" /></g>
      <circle cx="160" cy="160" r="4.5" className="ill-hub" />
      <rect x="108" y="176" width="104" height="5" rx="2.5" className="ill-line" />
      <g className="ill-check"><circle cx="226" cy="48" r="17" /><path d="M218 48l6 6 11-12" /></g>
    </svg>
  );
}

export function ProgressIllustration({ className = "" }: { className?: string }) {
  return (
    <svg className={`illustration progress-illustration ${className}`} viewBox="0 0 320 220" aria-hidden="true">
      <circle cx="160" cy="112" r="96" className="ill-halo" />
      <rect x="62" y="48" width="196" height="132" rx="12" className="ill-paper" />
      {[76, 106, 136, 166].map((y) => <path key={y} d={`M80 ${y}H240`} className="ill-grid" />)}
      <path d="M84 150 L118 128 L152 138 L186 104 L220 112 L238 84" className="ill-trend" pathLength={1} />
      {[[84, 150], [118, 128], [152, 138], [186, 104], [220, 112], [238, 84]].map(([x, y], index) => (
        <circle key={x} cx={x} cy={y} r="4.5" className="ill-dot" style={{ animationDelay: `${0.25 + index * 0.18}s` }} />
      ))}
    </svg>
  );
}

export function MapIllustration({ className = "" }: { className?: string }) {
  return (
    <svg className={`illustration map-illustration ${className}`} viewBox="0 0 320 220" aria-hidden="true">
      <circle cx="160" cy="112" r="96" className="ill-halo" />
      <path d="M70 70l60-20 60 20 60-20v110l-60 20-60-20-60 20Z" className="ill-paper" />
      <path d="M130 50v110M190 70v110" className="ill-grid" />
      <path d="M86 120c30-20 60 10 90-12s50-6 64-20" className="ill-road" />
      <g className="ill-pin">
        <path d="M160 58c-17 0-30 13-30 29 0 22 30 50 30 50s30-28 30-50c0-16-13-29-30-29Z" />
        <circle cx="160" cy="87" r="10" className="ill-pin-hole" />
      </g>
      <ellipse cx="160" cy="146" rx="16" ry="4" className="ill-pin-shadow" />
    </svg>
  );
}
