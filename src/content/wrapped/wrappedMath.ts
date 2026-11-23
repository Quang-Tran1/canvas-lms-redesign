/*
 * Works out the Wrapped numbers from the year's coursework, as wrappedApi.ts
 * fetches it.
 *
 * Pure, so it can run in Node against saved data, like the streak.
 */

import type { WrappedStats } from "./stats.ts";

/** Local time. `end` is exclusive. */
export interface Range {
    start: Date;
    end: Date;
}

export type WorkKind = "assignment" | "quiz" | "discussion";

/** One assignment (a quiz and a graded discussion are assignments too) and
    the student's submission for it. */
export interface Work {
    courseId: string;
    kind: WorkKind;
    /** The student's own deadline, section and student overrides included. */
    due?: Date;
    /** When the student could first see it: when it was created, or when it
        unlocked if that was later. */
    posted?: Date;
    /** Each time the student pressed submit, oldest first. */
    attempts: Date[];
    /** When the student checked it off in the planner, if they did. */
    checkedAt?: Date;
    /** The score as the student sees it. Missing until it's graded and posted. */
    score?: number;
    gradedAt?: Date;
    excused: boolean;
    /** Canvas's own flag: past due and nothing submitted. Canvas only sets it on
        work that takes online submissions. */
    missing: boolean;
}

export interface Course {
    id: string;
    /** The user's nickname for it, else its name. */
    name: string;
    image?: string;
    /** Its dashboard card color. */
    color?: string;
    /** When the course ran. Either end can be unknown. */
    start?: Date;
    end?: Date;
}

export interface WrappedInput {
    courses: Course[];
    work: Work[];
    /** When each ungraded discussion was checked off in the planner. Those have
        no submission, so this is the only record of taking part. */
    discussionCheckoffs: Date[];
    peopleMet: number;
}

const DAY = 86_400_000;
const WEEK = 7 * DAY;

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function computeStats(input: WrappedInput, range: Range): WrappedStats {
    const { courses, work } = input;
    const attemptsInRange = work.flatMap((item) => item.attempts.filter((at) => within(range, at)));
    const submittedInRange = (item: Work) => item.attempts.some((at) => within(range, at));

    return {
        submissions: attemptsInRange.length,
        points: Math.round(sumPoints(work, range)),
        discussions:
            work.filter((item) => item.kind === "discussion" && submittedInRange(item)).length +
            input.discussionCheckoffs.filter((at) => within(range, at)).length,
        quizzes: work.filter((item) => item.kind === "quiz" && submittedInRange(item)).length,
        peopleMet: input.peopleMet,
        procrastinationScore: procrastinationScore(work, courses, range),
        busiestDay: busiestDay(work, range),
        busiestCourse: busiestCourse(work, courses, range),
    };
}

/* Everything graded this year. Work is placed in the year by its deadline,
   or when it was turned in or graded if it had none. */
function sumPoints(work: Work[], range: Range): number {
    let points = 0;
    for (const item of work) {
        if (item.excused || item.score === undefined) continue;
        const when = item.due ?? item.attempts[0] ?? item.gradedAt;
        if (when && within(range, when)) points += item.score;
    }
    return points;
}

/* ---- Procrastination ----
 *
 * Each piece of work gets a rating from 0 (done the moment it was posted) to 1
 * (done at the deadline, late, or never), from where in its window it was
 * turned in: the time between posting and the deadline. The score is the
 * average rating, out of 10,000.
 *
 * The rating follows an exponential curve over the share of the window still
 * left, so it climbs fastest in the final stretch. With a week to do it:
 *
 *     a minute left 1.00    six hours 0.86    two days 0.31
 *     an hour left  0.98    one day   0.56    half the week 0.12
 */

/** A window shorter than this (an in-class quiz) leaves nothing to put off. */
const MIN_WINDOW = DAY;
/** Getting to it two weeks out counts as early, however long it was posted. */
const MAX_WINDOW = 14 * DAY;
/** How sharply the rating climbs toward the deadline. */
const STEEPNESS = 4;

export const MAX_SCORE = 10_000;

function procrastinationScore(work: Work[], courses: Course[], range: Range): number {
    const courseStart = new Map(courses.map((course) => [course.id, course.start]));
    const ratings: number[] = [];
    for (const item of work) {
        const rating = procrastination(item, courseStart.get(item.courseId), range);
        if (rating !== null) ratings.push(rating);
    }
    if (!ratings.length) return 0;
    const average = ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length;
    return Math.round(average * MAX_SCORE);
}

/** Null for work that says nothing either way. */
export function procrastination(item: Work, courseStart: Date | undefined, range: Range): number | null {
    const { due } = item;
    if (!due || item.excused) return null;

    // Courses are often copied from last term weeks before they open, which
    // dates everything in them before the student could see any of it.
    const posted = latest(item.posted, courseStart);
    if (!posted || due.getTime() - posted.getTime() < MIN_WINDOW) return null;

    // Turned in, or checked off before the deadline: work done on paper or in
    // another tool. A checkoff after the deadline is someone catching up on
    // their list, which says nothing about when the work was done.
    const done = item.attempts[0] ?? (item.checkedAt && item.checkedAt <= due ? item.checkedAt : undefined);
    if (!within(range, done ?? due)) return null;
    if (!done) return item.missing ? 1 : null;
    if (done > due) return 1;

    const opened = Math.max(posted.getTime(), due.getTime() - MAX_WINDOW);
    const left = clamp((due.getTime() - done.getTime()) / (due.getTime() - opened), 0, 1);
    return (Math.exp(-STEEPNESS * left) - Math.exp(-STEEPNESS)) / (1 - Math.exp(-STEEPNESS));
}

/* ---- Busiest day and course ---- */

/* Every dated piece of work due this year. */
function dueInRange(work: Work[], range: Range): (Work & { due: Date })[] {
    return work.filter((item): item is Work & { due: Date } => !!item.due && within(range, item.due));
}

/* A deadline at midnight is the end of the day before, not the start of the
   day it names. */
function deadlineWeekday(due: Date): number {
    const day = due.getDay();
    return due.getHours() === 0 && due.getMinutes() === 0 ? (day + 6) % 7 : day;
}

/* The weekday with the most work due on it, on average over every time that
   weekday came round this year (so a year with one more Tuesday than
   Wednesdays doesn't tip it), and how much was due on it in all. */
function busiestDay(work: Work[], range: Range): WrappedStats["busiestDay"] {
    const due = new Array<number>(7).fill(0);
    for (const item of dueInRange(work, range)) due[deadlineWeekday(item.due)]++;

    const occurrences = new Array<number>(7).fill(0);
    for (let day = startOfDay(range.start); day < range.end; day = addDays(day, 1)) {
        occurrences[day.getDay()]++;
    }

    let best = -1;
    let bestAverage = 0;
    for (let weekday = 0; weekday < 7; weekday++) {
        if (!occurrences[weekday]) continue;
        const average = due[weekday] / occurrences[weekday];
        if (average > bestAverage) {
            best = weekday;
            bestAverage = average;
        }
    }
    return best < 0 ? null : { name: WEEKDAYS[best], total: due[best] };
}

/* The course with the most work due per week, over the part of the year it
   ran. A course with no dates (a homeroom) is taken to run all year. */
function busiestCourse(work: Work[], courses: Course[], range: Range): WrappedStats["busiestCourse"] {
    const dueByCourse = new Map<string, Date[]>();
    for (const item of dueInRange(work, range)) {
        const list = dueByCourse.get(item.courseId) ?? [];
        list.push(item.due);
        dueByCourse.set(item.courseId, list);
    }

    let best: Course | null = null;
    let bestRate = 0;
    let bestCount = 0;
    for (const course of courses) {
        const dues = dueByCourse.get(course.id);
        if (!dues?.length) continue;

        const times = dues.map((due) => due.getTime());
        // Stretched to cover every deadline, in case the course's dates are off.
        const start = Math.min(Math.max(range.start.getTime(), course.start?.getTime() ?? -Infinity), ...times);
        const end = Math.max(Math.min(range.end.getTime(), course.end?.getTime() ?? Infinity), ...times);
        const rate = dues.length / Math.max(1, (end - start) / WEEK);

        if (rate > bestRate || (rate === bestRate && dues.length > bestCount)) {
            best = course;
            bestRate = rate;
            bestCount = dues.length;
        }
    }
    return best && { name: best.name, image: best.image, color: best.color };
}

/* ---- Dates ---- */

function within(range: Range, date: Date): boolean {
    return date >= range.start && date < range.end;
}

function latest(...dates: (Date | undefined)[]): Date | undefined {
    let out: Date | undefined;
    for (const date of dates) if (date && (!out || date > out)) out = date;
    return out;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function startOfDay(date: Date): Date {
    const out = new Date(date);
    out.setHours(0, 0, 0, 0);
    return out;
}

function addDays(date: Date, days: number): Date {
    const out = new Date(date);
    out.setDate(out.getDate() + days);
    return out;
}
