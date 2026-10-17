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
          <p><strong>Gait means the way a person walks</strong>: step length, rhythm, how long each foot stays on the ground and how even the left and right sides are.</p>
          <p>Parkinson’s often changes walking: shorter or shuffling steps, less regular timing from one stride to the next, and differences between the left and right sides. The gait model measures exactly these timing changes.</p>
          <p>Voice and walking are affected by Parkinson’s in different ways, so combining them gives a more reliable result than either alone (combined AUC 0.84 vs 0.77). The gait model uses a <strong>foot-pressure recording</strong> from sensor insoles worn while walking for 20 seconds or more, recorded 100 times per second.</p>
          <ul>
            <li><strong>Have an insole recording?</strong> Choose <strong>Voice + gait</strong> and upload it.</li>
            <li><strong>No recording yet?</strong> Choose Voice + gait and load a <strong>sample walking recording</strong> from a public research dataset to see the complete assessment, or run <strong>Voice only</strong> for now.</li>
          </ul>
        </div>
      </div>
    </details>
  );
}
