/*
 * Shows an estimated class rank ("Top 5-12%") after the total on a course's
 * Grades page.
 *
 * Only runs on /courses/:id/grades, and only when the page is the signed-in
 * student looking at their own grades. It stays out of the way when:
 *   - the school restricts students to letter grades (quantitative data is
 *     hidden on purpose, so a percentile would undo that),
 *   - the course hides the total,
 *   - a teacher or observer is viewing someone else's grades,
 *   - "All Grading Periods" is selected in a course that weights its periods,
 *     where the total is built in a way this model doesn't cover,
 *   - no assignment has class statistics yet.
 */

import { readPageEnv } from "../pageEnv";
import { loadRankInputs } from "./rankData";
import { estimatePercentile, formatRank } from "./rankMath";
import { injectGradesCss } from "./styles";

const GRADES_PATH = /^\/courses\/(\d+)\/grades(?:\/(\d+))?\/?$/;
/* The "Total: 93.25%" line in the right sidebar. div, so the rank can sit
   inside it; the assignments table has rows with similar classes. */
const TOTAL = "div.student_assignment.final_grade";
const RANK_CLASS = "blms-class-rank";

interface RankLabel {
    text: string;
    assignmentCount: number;
}

function asId(value: unknown): string | null {
    return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

async function computeRank(courseId: string, studentInPath: string | null): Promise<RankLabel | null> {
    const env = readPageEnv() || {};

    if (env.restrict_quantitative_data === true) return null;
    if (env.hide_final_grades === true || env.exclude_total === true) return null;

    const viewer = asId(env.current_user_id);
    const student = asId(env.student_id) ?? studentInPath;
    if (viewer && student && viewer !== student) return null;

    const period = asId(env.current_grading_period_id);
    const periodSet = env.grading_period_set as { weighted?: boolean } | null | undefined;
    if ((period === null || period === "0") && periodSet?.weighted) return null;

    const weighted = env.group_weighting_scheme === "percent";

    try {
        const groups = await loadRankInputs(courseId, period);
        const range = estimatePercentile(groups, weighted);
        if (!range) return null;
        return { text: formatRank(range), assignmentCount: range.assignmentCount };
    } catch (cause) {
        console.warn("[BetterLMS] could not estimate class rank:", cause);
        return null;
    }
}

function render(total: Element, rank: RankLabel): void {
    const element = document.createElement("i");
    element.className = RANK_CLASS;
    element.title =
        `Estimated from the class statistics of ${rank.assignmentCount} ` +
        `assignment${rank.assignmentCount === 1 ? "" : "s"}. Not an official ranking.`;

    // Canvas's own screen-reader utility, so it isn't read as a bare "Top 5-12%".
    const spoken = document.createElement("span");
    spoken.className = "screenreader-only";
    spoken.textContent = "Estimated class rank: ";

    element.append(spoken, rank.text);
    total.append(element);
}

/* The computed rank is kept when the feature is switched off, so switching it
   back on doesn't fetch again. */
let requested = false;
let rank: RankLabel | null = null;

/* Non-null exactly while the feature is on, so it doubles as the "running"
   flag and makes both calls below safe to repeat. */
let observer: MutationObserver | null = null;

export function setClassRankEnabled(enabled: boolean): void {
    if (!GRADES_PATH.test(location.pathname)) return;

    if (enabled) {
        if (observer) return;
        // Puts the rank back if Canvas redraws the total.
        observer = new MutationObserver(place);
        observer.observe(document.documentElement, { childList: true, subtree: true });
        place();
    } else {
        if (!observer) return;
        observer.disconnect();
        observer = null;
        for (const element of document.querySelectorAll(`.${RANK_CLASS}`)) element.remove();
    }
}

function place(): void {
    // Also guards the request callback below, which can land after a switch-off.
    if (!observer) return;

    const total = document.querySelector(TOTAL);
    if (!total) return;

    // The sidebar is in the server-rendered page, after the ENV script, so
    // ENV is readable by the time it exists.
    if (!requested) {
        requested = true;
        injectGradesCss();
        const [, courseId, studentInPath = null] = location.pathname.match(GRADES_PATH)!;
        computeRank(courseId, studentInPath).then((result) => {
            rank = result;
            place();
        });
        return;
    }

    if (rank && !total.querySelector(`.${RANK_CLASS}`)) render(total, rank);
}
