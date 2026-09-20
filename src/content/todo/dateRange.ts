/*
 * The date window the To-Do list covers: which scope (day / week / month /
 * semester) and how many of those the user has stepped away from today.
 *
 * Pure date math, no hooks -- useDateRange wraps this for the components, and
 * the planner fetch will later read `start` and `end` straight off a range.
 */

export const SCOPES = ["day", "week", "month", "semester"] as const;
export type Scope = (typeof SCOPES)[number];

export const SCOPE_LABELS: Record<Scope, string> = {
    day: "Day",
    week: "Week",
    month: "Month",
    semester: "Semester",
};

export interface DateRange {
    /** Midnight at the start of the window. */
    start: Date;
    /** Midnight after the last day in the window -- exclusive, like the planner API wants. */
    end: Date;
    /** What the date picker shows, e.g. "Today", "Sep 7 - 13", "Fall 2026". */
    label: string;
}

/* Semesters are approximated: Spring (Jan-May), Summer (Jun-Jul), Fall (Aug-Dec).
   Canvas knows the real term dates per course; this is a calendar guess. */
const SEMESTER_NAMES = ["Spring", "Summer", "Fall"] as const;
const SEMESTER_START_MONTHS = [0, 5, 7];

export function startOfDay(date: Date): Date {
    const out = new Date(date);
    out.setHours(0, 0, 0, 0);
    return out;
}

export function addDays(date: Date, days: number): Date {
    const out = new Date(date);
    out.setDate(out.getDate() + days);
    return out;
}

function semesterOf(date: Date): number {
    const month = date.getMonth();
    return month < 5 ? 0 : month < 7 ? 1 : 2;
}

function semesterStart(year: number, index: number): Date {
    return new Date(year, SEMESTER_START_MONTHS[index], 1);
}

/* Steps `by` semesters from one, rolling the year over at both ends. */
function shiftSemester(year: number, index: number, by: number): { year: number; index: number } {
    const moved = index + by;
    return {
        year: year + Math.floor(moved / 3),
        index: ((moved % 3) + 3) % 3,
    };
}

function monthDay(date: Date): string {
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/*
 * What a task's due chip says: "Today" and "Tomorrow" near the present,
 * a weekday and date further out. Compared by calendar day, so 11:59pm
 * tonight reads "Today" rather than rounding to tomorrow.
 */
export function dueLabel(due: Date, today: Date = new Date()): string {
    const days = Math.round((startOfDay(due).getTime() - startOfDay(today).getTime()) / 86_400_000);
    if (days === 0) return "Today";
    if (days === 1) return "Tomorrow";
    if (days === -1) return "Yesterday";
    return due.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/*
 * The window `offset` scopes away from the one containing `today`: 0 is the
 * current day/week/month/semester, -1 the previous, 1 the next.
 *
 * `today` is a parameter rather than read from the clock so the caller decides
 * when "now" is re-read, and so this stays testable.
 */
export function rangeFor(scope: Scope, offset: number, today: Date = new Date()): DateRange {
    const base = startOfDay(today);

    if (scope === "day") {
        const start = addDays(base, offset);
        let label: string;
        if (offset === 0) label = "Today";
        else if (offset === 1) label = "Tomorrow";
        else if (offset === -1) label = "Yesterday";
        else label = start.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
        return { start, end: addDays(start, 1), label };
    }

    if (scope === "week") {
        // Monday-based: getDay() is 0 on Sunday, so shift it to the week's end.
        const weekday = (base.getDay() + 6) % 7;
        const start = addDays(base, -weekday + offset * 7);
        const end = addDays(start, 7);
        const last = addDays(end, -1);
        // "Sep 7 - 13" inside one month, "Sep 28 - Oct 4" across two.
        const tail = start.getMonth() === last.getMonth() ? String(last.getDate()) : monthDay(last);
        return { start, end, label: `${monthDay(start)} - ${tail}` };
    }

    if (scope === "month") {
        // Day 1 of a shifted month: Date normalises month 12 to January of the next year.
        const start = new Date(base.getFullYear(), base.getMonth() + offset, 1);
        const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
        return { start, end, label: start.toLocaleDateString(undefined, { month: "long", year: "numeric" }) };
    }

    const current = shiftSemester(base.getFullYear(), semesterOf(base), offset);
    const following = shiftSemester(current.year, current.index, 1);
    return {
        start: semesterStart(current.year, current.index),
        end: semesterStart(following.year, following.index),
        label: `${SEMESTER_NAMES[current.index]} ${current.year}`,
    };
}
