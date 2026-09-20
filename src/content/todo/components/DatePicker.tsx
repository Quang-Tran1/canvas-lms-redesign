import { SCOPE_LABELS, type Scope } from "../dateRange";

interface Props {
  /** What to show on the middle button, e.g. "Today" or "Sep 7 - 13". */
  label: string;
  /** Names the arrows for screen readers: "Previous week", "Next month". */
  scope: Scope;
  /** True when the window already contains today, so the middle button is a no-op. */
  isCurrent: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
}

export default function DatePicker({
  label,
  scope,
  isCurrent,
  onPrevious,
  onNext,
  onToday,
}: Props) {
  const unit = SCOPE_LABELS[scope].toLowerCase();

  return (
    <div className="blms-datepicker">
      <button
        className="blms-datepicker__btn"
        id="left"
        type="button"
        aria-label={`Previous ${unit}`}
        onClick={onPrevious}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke-width="2"
          stroke="currentColor"
          class="size-6"
          aria-hidden="true"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M15.75 19.5 8.25 12l7.5-7.5"
          />
        </svg>
      </button>
      <button
        className="blms-datepicker__date"
        type="button"
        title={isCurrent ? undefined : `Back to the current ${unit}`}
        onClick={onToday}
      >
        {label}
      </button>
      <button
        className="blms-datepicker__btn"
        id="right"
        type="button"
        aria-label={`Next ${unit}`}
        onClick={onNext}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke-width="2"
          stroke="currentColor"
          class="size-6"
          aria-hidden="true"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="m8.25 4.5 7.5 7.5-7.5 7.5"
          />
        </svg>
      </button>
    </div>
  );
}
