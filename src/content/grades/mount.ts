/*
 * Adds a grade pill to each course card on the Canvas dashboard.
 *
 * Canvas renders the cards with React after the page loads, and re-renders
 * them when they're dragged or the dashboard view changes, so the page is
 * watched rather than queried once. The pill is added next to Canvas's own
 * nodes, never in place of them, which React tolerates.
 *
 * Grades are only fetched once a card actually appears, so every other Canvas
 * page costs one cheap DOM query per change and nothing more.
 */

import { type CourseGrade, formatGrade, loadCourseGrades } from "./gradesApi";
import { injectGradesCss } from "./styles";

const CARD = ".ic-DashboardCard";
const CARD_LINK = "a.ic-DashboardCard__link";
const ANCHOR = ".ic-DashboardCard__header-button-bg";
const PILL_CLASS = "blms-grade-pill";

/* null until the grades request has finished. */
let grades: Map<string, CourseGrade> | null = null;
let requested = false;

export function startDashboardGrades(): void {
    new MutationObserver(decorate).observe(document.documentElement, { childList: true, subtree: true });
    decorate();
}

function decorate(): void {
    const cards = document.querySelectorAll(CARD);
    if (!cards.length) return;

    if (!grades) {
        if (!requested) {
            requested = true;
            injectGradesCss();
            loadCourseGrades().then((loaded) => {
                grades = loaded;
                decorate();   // cards that appeared while the request was out
            });
        }
        return;
    }

    for (const card of cards) addPill(card, grades);
}

/* The card's own link is the one reliable place its course id appears. */
function courseIdOf(card: Element): string | null {
    const href = card.querySelector(CARD_LINK)?.getAttribute("href");
    return href?.match(/\/courses\/(\d+)/)?.[1] ?? null;
}

function addPill(card: Element, loaded: Map<string, CourseGrade>): void {
    if (card.querySelector(`.${PILL_CLASS}`)) return;   // already has one

    const anchor = card.querySelector(ANCHOR);
    const id = courseIdOf(card);
    if (!anchor || !id) return;

    const grade = loaded.get(id);
    if (!grade) return;   // hidden grades, nothing graded yet, or not a student here

    const pill = document.createElement("span");
    pill.className = PILL_CLASS;

    // Canvas's own screen-reader utility class, so the pill is announced with
    // context instead of as a bare "93.25%".
    const spoken = document.createElement("span");
    spoken.className = "screenreader-only";
    spoken.textContent = grade.period ? `Current grade for ${grade.period}: ` : "Current grade: ";

    pill.append(spoken, formatGrade(grade));
    anchor.after(pill);
}
