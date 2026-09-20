import { useMemo } from "preact/hooks";
import { type Task } from "../plannerApi";

interface Props {
  tasks: Task[];
}

/*
 * Each open course gets a segment sized by its share of the window's work; the
 * green "done" segment flex-grows into whatever is left, so it fills the bar as
 * tasks get ticked off.
 *
 * Segments after the first are pulled back 20px by todo.css so their rounded
 * ends tuck under the segment before them. OVERLAP_PERCENT adds that width back
 * on, otherwise every overlap would shrink the bar and the green segment would
 * over-report progress. 8% of a ~250px sidebar is that same 20px.
 */
const OVERLAP_PERCENT = 8;

export default function ProgressBar({ tasks }: Props) {
  const { percent, completed, segments } = useMemo(() => {
    const total = tasks.length;
    const open = tasks.filter((task) => !task.complete);
    const completedCount = total - open.length;

    // One entry per course, biggest first, so the layering looks deliberate.
    const byCourse = new Map<string, { color: string; name: string; count: number }>();
    for (const task of open) {
      const entry = byCourse.get(task.courseKey);
      if (entry) entry.count += 1;
      else byCourse.set(task.courseKey, { color: task.color, name: task.courseName, count: 1 });
    }
    const ordered = [...byCourse.entries()]
      .map(([key, value]) => ({ key, ...value }))
      .sort((a, b) => b.count - a.count);

    return {
      percent: total === 0 ? 100 : Math.round((completedCount / total) * 100),
      completed: completedCount,
      segments: ordered.map((segment, index) => ({
        ...segment,
        // The very first segment in the bar has no negative margin to undo.
        width: (segment.count / total) * 100 + (completedCount === 0 && index === 0 ? 0 : OVERLAP_PERCENT),
        // Earlier segments sit on top of later ones so the overlap reads left to right.
        zIndex: ordered.length - index,
      })),
    };
  }, [tasks]);

  return (
    <div>
      <h3 style="margin-left: 8px; margin-bottom: 2px; font-weight: 700;">{percent}%</h3>
      <div
        className={"blms-progressbar"}
        style={completed / tasks.length === 1 ? "border-color: #47ca59" : ""}
        role="img"
        aria-label={`${completed} of ${tasks.length} complete`}
      >
        {completed > 0 && (
          <div className="blms-progressbar__segment segment--completed">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke-width="3"
              stroke="currentColor"
              class="size-6"
              aria-hidden="true"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="m4.5 12.75 6 6 9-13.5"
              />
            </svg>
          </div>
        )}
        {segments.map((segment) => (
          <div
            key={segment.key}
            className="blms-progressbar__segment"
            title={`${segment.name}: ${segment.count} left`}
            style={{
              width: `${segment.width}%`,
              backgroundColor: segment.color,
              zIndex: segment.zIndex,
            }}
          />
        ))}
      </div>
    </div>
  );
}
