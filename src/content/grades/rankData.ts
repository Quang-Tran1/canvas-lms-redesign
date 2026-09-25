/*
 * Loads what the class rank needs for one course, in one request: every
 * assignment group with its weight, each assignment's points, the student's
 * own score, and the class statistics Canvas shows the student.
 *
 * Only assignments with statistics are used, for both the student and the
 * class, so the two are always compared on the same work. Canvas withholds
 * statistics until at least five students are graded, or when the instructor
 * turns them off.
 */

import { fetchAllPages } from "../canvasApi";
import { type AssignmentInput, type GroupInput } from "./rankMath";

interface ApiStats {
    min?: number | null;
    max?: number | null;
    mean?: number | null;
    lower_q?: number | null;
    median?: number | null;
    upper_q?: number | null;
}

interface ApiAssignment {
    points_possible?: number | null;
    omit_from_final_grade?: boolean;
    submission?: { score?: number | null; excused?: boolean } | null;
    score_statistics?: ApiStats | null;
}

interface ApiGroup {
    group_weight?: number | null;
    assignments?: ApiAssignment[];
}

function isNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

/* Null for anything that doesn't count toward the student's current total. */
function toInput(assignment: ApiAssignment): AssignmentInput | null {
    const points = assignment.points_possible;
    const submission = assignment.submission;
    const stats = assignment.score_statistics;

    if (assignment.omit_from_final_grade) return null;
    if (!isNumber(points) || points <= 0) return null;
    // Ungraded, unposted (the score comes back null) or excused work doesn't count.
    if (!submission || submission.excused || !isNumber(submission.score)) return null;
    if (!stats || !isNumber(stats.min) || !isNumber(stats.max) || !isNumber(stats.mean)) return null;

    return {
        pointsPossible: points,
        score: submission.score,
        stats: {
            min: stats.min,
            max: stats.max,
            mean: stats.mean,
            lowerQ: isNumber(stats.lower_q) ? stats.lower_q : undefined,
            median: isNumber(stats.median) ? stats.median : undefined,
            upperQ: isNumber(stats.upper_q) ? stats.upper_q : undefined,
        },
    };
}

/**
 * @param gradingPeriodId The period the Grades page is showing, or null / "0"
 *   for all of them.
 */
export async function loadRankInputs(courseId: string, gradingPeriodId: string | null): Promise<GroupInput[]> {
    const params = new URLSearchParams({ per_page: "100" });
    // score_statistics only comes back alongside the student's own submission.
    for (const include of ["assignments", "submission", "score_statistics"]) {
        params.append("include[]", include);
    }
    if (gradingPeriodId && gradingPeriodId !== "0") params.set("grading_period_id", gradingPeriodId);

    const groups = await fetchAllPages<ApiGroup>(`/api/v1/courses/${courseId}/assignment_groups?${params}`);
    return groups.map((group) => ({
        weight: isNumber(group.group_weight) ? group.group_weight : 0,
        assignments: (group.assignments || [])
            .map(toInput)
            .filter((input): input is AssignmentInput => input !== null),
    }));
}
