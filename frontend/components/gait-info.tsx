import { Footprints } from "lucide-react";

/** Plain-language explanation of gait and the walking recording the portal uses. */
export function GaitInfo({ open = false }: { open?: boolean }) {
  return (
    <details className="gait-info" open={open}>
      <summary><Footprints size={17} aria-hidden="true" /> What is gait, and why does it matter?</summary>
      <div className="gait-info-body">
        <svg className="footsteps" viewBox="0 0 220 70" aria-hidden="true">
          {[0, 1, 2, 3, 4, 5].map((step) => (
            <g key={step} className="footstep" style={{ animationDelay: `${step * 0.35}s` }} transform={`translate(${14 + step * 34} ${step % 2 ? 36 : 12})`}>
              <ellipse cx="9" cy="10" rx="7" ry="10" />
              <ellipse cx="9" cy="24" rx="5" ry="5" />
            </g>
          ))}
        </svg>
        <div>
          <p><strong>Gait is the way a person walks</strong> — step rhythm, timing and left–right balance. Parkinson’s often makes steps shorter, less regular and uneven between sides.</p>
          <p>The gait model reads these timing changes from a foot-pressure (sensor insole) recording. No recording? Use a sample, or choose Voice only.</p>
        </div>
      </div>
    </details>
  );
}
