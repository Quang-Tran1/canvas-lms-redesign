import { type Task } from "../plannerApi";
import TypeIcon from "./TypeIcon";
import { useLayoutEffect, useRef } from "preact/hooks";

interface Props {
  task: Task;
  onComplete: (task: Task) => void;
  leaving: boolean;
  leaveOrder: number;
  onExited: (key: string) => void;
}

export default function TaskCard({ task, onComplete, leaving, leaveOrder, onExited }: Props) {
  const cardRef = useRef<HTMLLIElement>(null);

  useLayoutEffect(() => {
    if (leaving && cardRef.current) {
      cardRef.current.style.setProperty("--h", `${cardRef.current.offsetHeight}px`);
    }
  }, [leaving]);

  return (
    // --course-color feeds the icon tile and the course line in todo.css.
    <li
      ref={cardRef}
      className={leaving ? "blms-taskcard is-leaving" : "blms-taskcard"}
      style={{ "--course-color": task.color, "--leave-delay": `${leaveOrder * 20}ms` }}
      onAnimationEnd={(event) => {
        if (event.animationName === "taskAnimOut") onExited(task.key);
      }}
    >
      <span className="blms-taskcard__icon">
        <TypeIcon type={task.plannableType} />
      </span>
      <div className="blms-taskcard-details">
        <button
          className="blms-taskcard-details__btn"
          type="button"
          aria-label={`Mark "${task.title}" complete`}
          onClick={() => onComplete(task)}
        >
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
        </button>
        <a className="blms-taskcard-details__title" href={task.url} title={task.title}>
          {task.title}
        </a>
        <p className="blms-taskcard-details__context">{task.courseName}</p>
        <ul className="blms-taskcard-details-chips">
          {task.dueText && (
            <li className="blms-taskcard-details-chips__chip">
              <strong>Due</strong>{" "}
              <time dateTime={task.due?.toISOString()}>{task.dueText}</time>
            </li>
          )}
          {task.points !== null && (
            <li className="blms-taskcard-details-chips__chip">{formatPoints(task.points)} pts</li>
          )}
          {task.missing ? (
            <li className="blms-taskcard-details-chips__chip chip--alert">Missing</li>
          ) : task.late ? (
            <li className="blms-taskcard-details-chips__chip chip--alert">Late</li>
          ) : null}
        </ul>
      </div>
    </li>
  );
}

/* Canvas sends points as a float: 50 should read "50", 12.5 stays "12.5". */
function formatPoints(points: number): string {
  return Number.isInteger(points) ? String(points) : String(Math.round(points * 100) / 100);
}
