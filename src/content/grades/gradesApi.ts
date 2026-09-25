/*
 * The signed-in student's current grade in each of their courses.
 *
 * One request covers every course: the course list with total_scores gives
 * the same score the student sees on the course's Grades page. Courses set to
 * hide final grades omit the score fields entirely, so they simply get no pill.
 */

import { fetchAllPages } from "../canvasApi";

/** A student enrollment as returned inside GET /api/v1/courses, trimmed. */
interface Enrollment {
    type?: string;
    computed_current_score?: number | null;
    computed_current_grade?: string | null;
    has_grading_periods?: boolean;
    current_grading_period_id?: number | string | null;
    current_grading_period_title?: string | null;
    current_period_computed_current_score?: number | null;
    current_period_computed_current_grade?: string | null;
}

interface Course {
    id: number | string;
    enrollments?: Enrollment[];
}

export interface CourseGrade {
    /** Percentage, e.g. 93.25. */
    score: number;
    /** "A-" when the course uses a grading scheme, otherwise null. */
    letter: string | null;
    /** "Fall Quarter 1" when the score covers one grading period, otherwise null. */
    period: string | null;
}

/*
 * Courses with grading periods open the Grades page on the current period, so
 * that's the score a student expects to see. Outside any period, or in a
 * course without them, it's the whole-course total. "Current" scores count
 * only graded work, which is Canvas's default view too.
 */
function pickGrade(enrollment: Enrollment): CourseGrade | null {
    const usePeriod = !!enrollment.has_grading_periods && enrollment.current_grading_period_id != null;
    const score = usePeriod
        ? enrollment.current_period_computed_current_score
        : enrollment.computed_current_score;
    const letter = usePeriod
        ? enrollment.current_period_computed_current_grade
        : enrollment.computed_current_grade;

    if (typeof score !== "number") return null;   // hidden, or nothing graded yet
    return {
        score,
        // Guard against a grade string that's just the percentage again.
        letter: letter && !/^[\d.]+%?$/.test(letter) ? letter : null,
        period: usePeriod ? enrollment.current_grading_period_title ?? null : null,
    };
}

async function fetchGrades(): Promise<Map<string, CourseGrade>> {
    const params = new URLSearchParams({ enrollment_type: "student", per_page: "100" });
    params.append("include[]", "total_scores");
    params.append("include[]", "current_grading_period_scores");

    const grades = new Map<string, CourseGrade>();
    try {
        const courses = await fetchAllPages<Course>(`/api/v1/courses?${params}`);
        for (const course of courses) {
            // A course can hold more than one of the user's enrollments; the
            // first student one with a visible score wins.
            for (const enrollment of course.enrollments || []) {
                if (enrollment.type !== "student") continue;
                const grade = pickGrade(enrollment);
                if (grade) {
                    grades.set(String(course.id), grade);
                    break;
                }
            }
        }
    } catch (cause) {
        // No pills rather than a broken dashboard. Not retried: a failure here
        // is usually permanent for the page (signed out, API disabled), and
        // retrying on every DOM change would hammer the server.
        console.warn("[BetterLMS] could not load course grades:", cause);
    }
    return grades;
}

/* Grades don't change while the dashboard is open, so this is fetched once
   and the promise itself is cached. */
let cached: Promise<Map<string, CourseGrade>> | null = null;

export function loadCourseGrades(): Promise<Map<string, CourseGrade>> {
    cached ??= fetchGrades();
    return cached;
}

/** "A- · 91.5%" with a grading scheme, "91.5%" without. Canvas shows up to two decimals. */
export function formatGrade(grade: CourseGrade): string {
    const percent = `${Number(grade.score.toFixed(2))}%`;
    return grade.letter ? `${grade.letter} · ${percent}` : percent;
}
