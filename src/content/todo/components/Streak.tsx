// ?inline keeps these data: URLs in dev too. A plain path would load from the
// Canvas page's own origin and 404 (see themePresets.ts).
import flame1 from "../../../assets/streak/flame-1.png?inline";
import flame2 from "../../../assets/streak/flame-2.png?inline";
import flame3 from "../../../assets/streak/flame-3.png?inline";
import flame4 from "../../../assets/streak/flame-4.png?inline";
import flame5 from "../../../assets/streak/flame-5.png?inline";
import { streakTier } from "../streak";
import { useStreak } from "../useStreak";

/* One flame per tier: grey, orange, blue, purple, red. */
const FLAMES = [flame1, flame2, flame3, flame4, flame5];

export default function Streak() {
  const { streak, loading } = useStreak();
  const tier = streakTier(streak?.current ?? 0);

  return (
    // The tier picks the --streak-gradient-tier-N pair from todo.css.
    <div
      className={loading ? "blms-streak blms-streak--loading" : "blms-streak"}
      style={{
        "--streak-bg": `var(--streak-gradient-tier-${tier}-bg)`,
        "--streak-text": `var(--streak-gradient-tier-${tier}-text)`,
      }}
      title={streak ? `Longest streak: ${streak.longest} ${streak.longest === 1 ? "day" : "days"}` : undefined}
    >
      <img src={FLAMES[tier - 1]} alt="" height="36" width="36" />
      {/* A dash while loading, or if the planner couldn't be read. */}
      <span className="blms-streak__number">{streak ? streak.current : "–"}</span>
      <span className="blms-streak__units">day streak</span>
    </div>
  );
}
