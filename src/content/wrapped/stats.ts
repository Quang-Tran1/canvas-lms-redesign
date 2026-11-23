/*
 * What Canvas Wrapped shows, and the stretch of the year it covers. The
 * slides only read this shape; wrappedApi.ts fills it in.
 */

import type { Range } from "./wrappedMath.ts";

export const WRAPPED_YEAR = 2026;

/* December 1 through November 21, local time. */
const YEAR_START = new Date(WRAPPED_YEAR - 1, 11, 1);
const YEAR_END = new Date(WRAPPED_YEAR, 10, 22);      // midnight after Nov 21

/** The Wrapped year up to now, or to November 21 once that's passed. */
export function wrappedRange(now = new Date()): Range {
    return { start: YEAR_START, end: now < YEAR_END ? now : YEAR_END };
}

/* When Wrapped is out: December 2 through December 13, local time. */
const SHOWING_START = new Date(WRAPPED_YEAR, 11, 2);
const SHOWING_END = new Date(WRAPPED_YEAR, 11, 14);   // midnight after Dec 13

/** Whether the launcher should be on the Dashboard today. */
export function wrappedShowing(now = new Date()): boolean {
    return now >= SHOWING_START && now < SHOWING_END;
}

export interface WrappedStats {
    /** Every time submit was pressed, resubmissions and quiz attempts included. */
    submissions: number;
    points: number;
    discussions: number;
    quizzes: number;
    peopleMet: number;
    /** 0 to 10,000; lower is better. See wrappedMath.ts. */
    procrastinationScore: number;
    /** Null with nothing due all year. */
    busiestDay: {
        /** A weekday name, e.g. "Tuesday". */
        name: string;
        /** How much was due on that weekday over the whole year. */
        total: number;
    } | null;
    busiestCourse: {
        name: string;
        /** The course card image. Optional: a course can have none. */
        image?: string;
        /** Its dashboard card color, "#rrggbb", when Canvas has one for it. */
        color?: string;
    } | null;
}

/**
 * Whether the year has a whole story to tell. A count of 0, or no busiest day
 * or course, would leave a slide with nothing to say, so Wrapped stops at the
 * title instead. A procrastination score of 0 counts too: it's what a year
 * with no work to rate scores, since a real 0 would take turning in
 * everything the moment it was posted.
 */
export function hasEnoughData(stats: WrappedStats): boolean {
    const { submissions, points, discussions, quizzes, peopleMet, procrastinationScore } = stats;
    return [submissions, points, discussions, quizzes, peopleMet, procrastinationScore].every((count) => count > 0) &&
        stats.busiestDay !== null &&
        stats.busiestCourse !== null;
}

const numberFormat = new Intl.NumberFormat("en-US");

/* 10183 -> "10,183", as the design writes it. */
export function formatCount(value: number): string {
    return numberFormat.format(value);
}
