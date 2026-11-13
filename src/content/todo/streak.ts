/*
 * The streak: consecutive days, up to today, without a missed deadline.
 *
 * Two steps. Each planner item gets a status from the first rule that matches
 * (see classify). Then every calendar day from the first tracked one to today
 * adds 1, and a day with a missed item resets the count to 0. Days with
 * nothing due still count -- nothing was missed.
 *
 * Counting picks up from a checkpoint: the streak as it stood at the end of
 * yesterday. Only items due after it are fetched and classified, so a page
 * load usually reads just today's planner. Today itself is never saved -- work
 * can still be added or come due later in the day. The checkpoint also keeps
 * terms Canvas has since dropped from the planner (concluded courses), since
 * those days are never refetched.
 *
 * Pure, so scripts/check-streak.mjs can run it in Node against a planner export.
 */

import { addDays, startOfDay } from "./dateRange.ts";

/** The parts of a planner item the streak looks at. */
export interface StreakItem {
    /** When the work was due. Items without one don't count. */
    dueAt?: string | null;
    /** null/false when Canvas has no submission for it (ungraded discussions). */
    submission?: {
        submitted?: boolean;
        late?: boolean;
        missing?: boolean;
        excused?: boolean;
    } | null | false;
    override?: {
        marked_complete?: boolean;
        dismissed?: boolean;
        created_at?: string;
    } | null;
}

export type ItemStatus = "ignored" | "on_time" | "in_class" | "pending" | "missed";

export interface Streak {
    /** Days in a row up to and including today. */
    current: number;
    longest: number;
}

/** The streak at the end of `through`, saved so the next load can start there. */
export interface StreakCheckpoint extends Streak {
    /** Local day, "2026-11-12". Always before today. */
    through: string;
    /** False until the first tracked day: no counting before anything was due. */
    started: boolean;
}

export function classify(item: StreakItem, now: Date): ItemStatus {
    const due = toDate(item.dueAt);
    const submission = item.submission || null;
    const override = item.override;
    const checked = !!override?.marked_complete && !override.dismissed;

    // 1. Nothing to be on time for.
    if (!due || submission?.excused) return "ignored";
    // 2. Turned in before the deadline. Wins over a late checkoff.
    if (submission?.submitted && !submission.late) return "on_time";
    // 3. Checked off before the deadline. Covers Canvas syncing a submission
    //    a minute late, ungraded discussions, and work turned in elsewhere.
    //    created_at, not updated_at: re-saving an override bumps updated_at.
    const checkedAt = toDate(override?.created_at);
    if (checked && checkedAt && checkedAt <= due) return "on_time";
    // 4. Done in class: checked off (whenever), nothing submitted online, and
    //    Canvas hasn't flagged it missing -- it only does that for assignments
    //    that take online submissions.
    if (checked && submission && !submission.submitted && !submission.missing) return "in_class";
    // 5. Still open.
    if (now <= due) return "pending";
    // 6.
    return "missed";
}

/* The streak from scratch: every item, no checkpoint. */
export function computeStreak(items: StreakItem[], now: Date): Streak {
    return continueStreak(items, now).streak;
}

/*
 * Counts on from `from` (or from the first tracked day, without one) through
 * today. `items` should be everything due after from.through; anything on or
 * before it is already in the checkpoint and skipped. Returns today's streak
 * and the checkpoint to save: the count at the end of yesterday.
 */
export function continueStreak(
    items: StreakItem[],
    now: Date,
    from?: StreakCheckpoint,
): { streak: Streak; checkpoint: StreakCheckpoint } {
    const today = startOfDay(now);
    const yesterday = dayKey(addDays(today, -1));
    const resumeAfter = from && parseDay(from.through);
    const missedDays = new Set<string>();
    let first: Date | undefined;

    for (const item of items) {
        const status = classify(item, now);
        if (status === "ignored" || status === "pending") continue;
        // On the local calendar day: an 11:59 PM deadline is the next morning in UTC.
        const day = startOfDay(toDate(item.dueAt)!);
        if (resumeAfter && day <= resumeAfter) continue;
        if (!first || day < first) first = day;
        if (status === "missed") missedDays.add(dayKey(day));
    }

    let { current, longest, started } = from ?? { current: 0, longest: 0, started: false };
    let checkpoint: StreakCheckpoint = { through: yesterday, current, longest, started };

    const start = resumeAfter ? addDays(resumeAfter, 1) : first;
    for (let day = start; day && day <= today; day = addDays(day, 1)) {
        // Taken before today is counted, so the saved streak never depends on today.
        if (day.getTime() === today.getTime()) checkpoint = { through: yesterday, current, longest, started };
        if (!started && (!first || day < first)) continue;
        started = true;
        current = missedDays.has(dayKey(day)) ? 0 : current + 1;
        longest = Math.max(longest, current);
    }
    return { streak: { current, longest }, checkpoint };
}

/** Which flame and colors: 1 grey (0-6 days), 2 orange, 3 blue, 4 purple, 5 red (365+). */
export function streakTier(days: number): 1 | 2 | 3 | 4 | 5 {
    if (days >= 365) return 5;
    if (days >= 100) return 4;
    if (days >= 30) return 3;
    if (days >= 7) return 2;
    return 1;
}

/** Local midnight of a "2026-11-12" key. undefined for anything malformed. */
export function parseDay(key: unknown): Date | undefined {
    const match = typeof key === "string" && /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
    return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : undefined;
}

function toDate(value: string | null | undefined): Date | undefined {
    if (!value) return undefined;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
}

function dayKey(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
