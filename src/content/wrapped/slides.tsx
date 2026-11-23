/*
 * The Wrapped slides, in order. Each renders straight into the card, and
 * wrapped.css places every element where the Figma design has it.
 *
 * Values that come from the stats are centered or edge-anchored the way the
 * design aligns them, so a longer or shorter number or name still sits right.
 *
 * A slide comes in line by line. Every element marked IN rises out of a blur
 * over LINE_MS, starting STAGGER_MS after the line before it; its --i says
 * which line it is. Numbers rise digit by digit instead, on their line's beat.
 * How many lines a slide has sets how long it stays up.
 */

import type { ComponentType } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import clock from "../../assets/wrapped/clock.svg?inline";
import person from "../../assets/wrapped/person.webp?inline";
import { WRAPPED_YEAR, formatCount, type WrappedStats } from "./stats";

/* The line timing. WrappedModal hands these to the CSS as custom properties,
   so this is the one place to tune them. */
export const LINE_MS = 800;
export const STAGGER_MS = 1200;
export const DIGIT_MS = 800;
export const DIGIT_STAGGER_MS = 80;
/* How long a slide stays up after its last line is in. */
const READ_MS = 3000;

export interface SlideProps {
    stats: WrappedStats;
}

/* "empty" is a year that loaded with too little in it (see hasEnoughData). */
export type IntroStatus = "loading" | "failed" | "empty" | "ready";

const METAL = "blms-wrapped__metal";
const CHROME = `${METAL} blms-wrapped__metal--chrome`;
/* Metal text whose parts come in separately. Each part paints its own slice
   of the host's gradient (see alignPieces), since a part that animates on its
   own drops out of the host's background-clip: text. */
const SPLIT = "blms-wrapped__metal--split";
const PIECE = "blms-wrapped__piece";
const MUTED = "blms-wrapped__muted";
const LABEL = `${MUTED} blms-wrapped__label`;
const IN = "blms-wrapped__in";
/* One line of a paragraph, as its own block so it can come in by itself. */
const LINE = `blms-wrapped__line ${IN}`;
const POP = "blms-wrapped__pop";

/* Stands in for a missing busiest day or course. A year without them stops
   at the title (see hasEnoughData), so this only keeps the types honest. */
const NONE = "None";

function plural(count: number, one: string, many: string): string {
    return count === 1 ? one : many;
}

/* The line an element comes in on. Its children inherit it. */
function at(line: number) {
    return { "--i": line };
}

/* The design's purple, for a busiest course Canvas has no color for. */
const DESIGN_COURSE_COLOR = "#a600ff";

/*
 * The busiest course's glow, in its own dashboard color: the color stops of
 * the design's radial gradient, which runs from white to the color at 37.5%
 * and on out to nothing. The design spells out the steps in between, each a
 * further quarter of the way to the color, so the gradient blends as Figma
 * draws it rather than through CSS's premultiplied, whiter mix.
 */
function courseGlow(color: string | undefined): string {
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color ?? "")?.[1] ?? DESIGN_COURSE_COLOR.slice(1);
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
    const rgb = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
    const stop = (amount: number, alpha: number, at: string) =>
        `rgba(${rgb.map((c) => Math.round(255 + (c - 255) * amount)).join(", ")}, ${alpha}) ${at}`;
    return [
        "#fff 0%",
        stop(0.25, 0.84375, "8.6538%"),
        stop(0.5, 0.6875, "17.308%"),
        stop(0.75, 0.53125, "25.962%"),
        stop(0.875, 0.45313, "30.288%"),
        stop(1, 0.375, "34.615%"),
        stop(1, 0, "100%"),
    ].join(", ");
}

/*
 * Shrinks a line of text until it's no wider than `max`, for a course name
 * longer than the design's. offsetWidth is measured before the stage's scale
 * transform, so `max` is in the design's own pixels.
 */
function useFitWidth<T extends HTMLElement>(max: number) {
    const ref = useRef<T>(null);
    useLayoutEffect(() => {
        const element = ref.current;
        if (!element) return;
        element.style.fontSize = "";
        const width = element.offsetWidth;
        if (width > max) {
            const size = parseFloat(getComputedStyle(element).fontSize);
            element.style.fontSize = `${(size * max) / width}px`;
        }
    });
    return ref;
}

/* A number whose digits rise one after another. A screen reader gets the
   whole number from the hidden copy rather than one digit at a time. */
function Digits({ value, metal = false }: { value: number; metal?: boolean }) {
    const text = formatCount(value);
    const className = metal ? `blms-wrapped__digit ${PIECE}` : "blms-wrapped__digit";
    return (
        <>
            <span className="blms-wrapped__sr">{text}</span>
            {[...text].map((char, d) => (
                <span key={d} className={className} style={{ "--d": d }} aria-hidden="true">
                    {char}
                </span>
            ))}
        </>
    );
}

/* Lays out a slide's split numbers and titles. Run again whenever they
   change size, as they do when a face finishes loading. */
export function layoutPieces(root: HTMLElement): void {
    kernDigits(root);
    alignPieces(root);
}

/*
 * Digits in separate spans lose the font's kerning between them (around a
 * comma most of all), which shifts a number a pixel or two from where the
 * design sets it. This measures where each character sits in the hidden copy,
 * set whole, and moves each digit there with a margin.
 */
function kernDigits(root: HTMLElement): void {
    const range = document.createRange();
    for (const copy of root.querySelectorAll<HTMLElement>(".blms-wrapped__sr")) {
        const text = copy.firstChild;
        const parent = copy.parentElement;
        if (!(text instanceof Text) || !parent) continue;
        const digits: HTMLElement[] = [];
        for (let el = copy.nextElementSibling; el?.classList.contains("blms-wrapped__digit"); el = el.nextElementSibling) {
            digits.push(el as HTMLElement);
        }
        if (digits.length !== text.length || !parent.offsetWidth) continue;

        // Screen pixels per layout pixel: the stage's scale, and any entrance
        // scale on the way in.
        const scale = parent.getBoundingClientRect().width / parent.offsetWidth;
        const left = (i: number) => {
            range.setStart(text, i);
            range.setEnd(text, i + 1);
            return range.getBoundingClientRect().left;
        };
        let previous = left(0);
        for (let i = 1; i < digits.length; i++) {
            const next = left(i);
            const width = digits[i - 1].getBoundingClientRect().width;
            digits[i].style.marginInlineStart = `${(next - previous - width) / scale}px`;
            previous = next;
        }
    }
}

/*
 * Lines up each piece's gradient with its host's, so a split number or title
 * looks exactly as it would painted whole. The pieces' CSS shifts the host's
 * gradient (and its sheen) back by the piece's offset within the host.
 * Offsets are layout positions, so the pieces' own animations don't skew them.
 */
function alignPieces(root: HTMLElement): void {
    for (const host of root.querySelectorAll<HTMLElement>(`.${SPLIT}`)) {
        const height = host.offsetHeight;
        const cy = getComputedStyle(host).getPropertyValue("--cy").trim();
        host.style.setProperty("--hw", `${host.offsetWidth}px`);
        host.style.setProperty("--hh", `${height}px`);
        host.style.setProperty("--hcy", cy.endsWith("px") ? cy : `${height / 2}px`);

        for (const piece of host.querySelectorAll<HTMLElement>(`.${PIECE}`)) {
            let x = 0;
            let y = 0;
            // Every host is positioned, so the chain ends there.
            for (let el: HTMLElement | null = piece; el && el !== host; el = el.offsetParent as HTMLElement | null) {
                x += el.offsetLeft;
                y += el.offsetTop;
            }
            piece.style.setProperty("--dx", `${x}px`);
            piece.style.setProperty("--dy", `${y}px`);
        }
    }
}

const LOADING_TEXT = "Wrapping up your year…";
const STATUS_TEXT: Record<IntroStatus, string> = {
    loading: LOADING_TEXT,
    // Still up for a moment as it fades.
    ready: LOADING_TEXT,
    failed: "Canvas didn’t send your year back. (Esc to exit)",
    empty: "We don’t have enough data from you. (Esc to exit)",
};

/* The title card. While the year is still loading it says so in the corner,
   and the modal keeps the story here until it's ready, or for good if it
   couldn't load or there's too little to tell. */
export function IntroSlide({ status }: { status: IntroStatus }) {
    // Only an intro that opened while the year was loading shows the status;
    // once it's ready the status fades out rather than vanishing.
    const [waited] = useState(status !== "ready");
    // New text comes in afresh. The line itself keeps its place in the
    // intro's timing, so text that changes before the line is up just
    // arrives with it.
    const text = STATUS_TEXT[status];
    const [firstText] = useState(text);
    return (
        <>
            <h2 className={`${CHROME} ${SPLIT} blms-wrapped__intro-title`}>
                {["Canvas", "Wrapped", String(WRAPPED_YEAR)].map((word, i) => (
                    <span key={word} className={`${PIECE} ${LINE}`} style={at(i)}>
                        {word}{" "}
                    </span>
                ))}
            </h2>
            <p className={`blms-wrapped__byline blms-wrapped__intro-by ${IN}`} style={at(3)}>by</p>
            <p className={`blms-wrapped__brand blms-wrapped__intro-brand blms-wrapped__mid-y ${IN}`} style={at(3)}>
                BetterLMS
            </p>
            {waited && (
                <p
                    className={`${MUTED} blms-wrapped__status blms-wrapped__status--${status} blms-wrapped__mid-y ${IN}`}
                    style={at(3)}
                    role="status"
                >
                    <span key={text} className={text === firstText ? undefined : "blms-wrapped__status-text--changed"}>
                        {text}
                    </span>
                </p>
            )}
        </>
    );
}

function StatsItem({ kind, line, value, one, many }: { kind: string; line: number; value: number; one: string; many: string }) {
    return (
        <p className={`${METAL} ${SPLIT} blms-wrapped__stats-item blms-wrapped__stats-item--${kind} blms-wrapped__mid-y`} style={at(line)}>
            <span className="blms-wrapped__stats-number">
                <Digits value={value} metal />
            </span>
            <span className={`blms-wrapped__stats-unit ${PIECE} ${IN}`} style={at(line + 1)}>
                {plural(value, one, many)}
            </span>
        </p>
    );
}

function StatsSlide({ stats }: SlideProps) {
    return (
        <>
            <p className={`${METAL} ${SPLIT} blms-wrapped__stats-hero blms-wrapped__mid-y`} style={at(0)}>
                <Digits value={stats.submissions} metal />
            </p>
            <p className={`${MUTED} blms-wrapped__stats-caption`}>
                <span className={LINE} style={at(1)}>
                    You pressed submit <b><Digits value={stats.submissions} /></b> {plural(stats.submissions, "time", "times")}.
                </span>
                <span className={LINE} style={at(2)}>Great job!</span>
            </p>
            <StatsItem kind="points" line={3} value={stats.points} one="point" many="points" />
            <StatsItem kind="discussions" line={5} value={stats.discussions} one="discussion" many="discussions" />
            <StatsItem kind="quizzes" line={7} value={stats.quizzes} one="quiz" many="quizzes" />
        </>
    );
}

function PeopleSlide({ stats }: SlideProps) {
    return (
        <p className={`${MUTED} blms-wrapped__people-text`}>
            <span className={LINE} style={at(0)}>
                You met
                <span className={`${METAL} ${SPLIT} blms-wrapped__people-number`}>
                    <Digits value={stats.peopleMet} metal />
                </span>
                new {plural(stats.peopleMet, "person", "people")}!
            </span>
            <span className={LINE} style={at(1)}>You’re pretty popular if I do say so.</span>
        </p>
    );
}

/* The design's line is for a score like its 8,999; gentler ones get their own. */
function procrastinationQuip(score: number): string {
    if (score >= 7500) return "Wow. You love the rush of adrenaline.";
    if (score >= 5000) return "Cutting it close, but it all gets done.";
    if (score >= 2500) return "You're good at getting it done early.";
    return "Early bird. Deadlines never stood a chance.";
}

function ProcrastinationSlide({ stats }: SlideProps) {
    return (
        <>
            <p className={`${MUTED} blms-wrapped__score-title blms-wrapped__mid ${IN}`} style={at(0)}>PROCRASTINATION SCORE</p>
            <p className={`${METAL} ${SPLIT} blms-wrapped__score blms-wrapped__mid`} style={at(1)}>
                <Digits value={stats.procrastinationScore} metal />
            </p>
            <p className={`${MUTED} blms-wrapped__score-hint blms-wrapped__mid-y ${IN}`} style={at(2)}>(Lower is better)</p>
            <p className={`${MUTED} blms-wrapped__score-quip ${IN}`} style={at(3)}>
                {procrastinationQuip(stats.procrastinationScore)}
            </p>
        </>
    );
}

function BusiestDaySlide({ stats }: SlideProps) {
    const day = stats.busiestDay;
    return (
        <>
            <p className={`${MUTED} blms-wrapped__lead ${IN}`} style={at(0)}>Your busiest day of the week was...</p>
            <p className={`${METAL} blms-wrapped__headline blms-wrapped__headline--day blms-wrapped__mid ${IN}`} style={at(1)}>
                {day?.name ?? NONE}
            </p>
            {day && (
                <p className={`${MUTED} blms-wrapped__day-total ${IN}`} style={at(2)}>
                    with <Digits value={day.total} /> {plural(day.total, "assignment", "assignments")} total
                </p>
            )}
        </>
    );
}

function BusiestCourseSlide({ stats }: SlideProps) {
    const { name, image, color } = stats.busiestCourse ?? { name: NONE };
    // The card less the margins the progress bar keeps.
    const nameRef = useFitWidth<HTMLParagraphElement>(1072);
    return (
        <>
            {/* The summary tile's glow, filling the card's corner, so the slide
                has some color even when the course has no image. */}
            <div className={`blms-wrapped__course-glow ${IN}`} style={{ ...at(2), "--course-glow": courseGlow(color) }} />
            <p className={`${MUTED} blms-wrapped__lead ${IN}`} style={at(0)}>Your busiest course was...</p>
            <p
                ref={nameRef}
                className={`${METAL} blms-wrapped__headline blms-wrapped__headline--course blms-wrapped__mid ${IN}`}
                style={at(1)}
            >
                {name}
            </p>
            {image && <img className={`blms-wrapped__course-photo ${IN} blms-wrapped__in--photo`} style={at(2)} src={image} alt="" />}
        </>
    );
}

/* The tiles come in as a wave from the top left, and their contents follow
   a beat behind each one. */
function SummarySlide({ stats }: SlideProps) {
    const { name: courseName, image: courseImage, color: courseColor } = stats.busiestCourse ?? { name: NONE };
    // The tile less 16px a side, centered where the design centers the name.
    const courseRef = useFitWidth<HTMLParagraphElement>(324);
    const tile = (kind: string) => `blms-wrapped__tile blms-wrapped__tile--${kind} ${IN}`;
    return (
        <>
            <div className={tile("submissions")} style={at(0)}>
                <p className={`${METAL} ${SPLIT} blms-wrapped__summary-submissions`}>
                    <Digits value={stats.submissions} metal />
                </p>
                <p className={`${LABEL} blms-wrapped__tile-center blms-wrapped__summary-submissions-label`}>
                    {plural(stats.submissions, "submission", "submissions")}
                </p>
                {/* The extension's own submit button, as an illustration. Pressing
                    it only presses it, rather than turning the page. */}
                <button
                    type="button"
                    className={`btn-primary blms-wrapped__submit ${POP}`}
                    tabIndex={-1}
                    aria-hidden="true"
                    onClick={(event) => event.stopPropagation()}
                >
                    Submit
                </button>
            </div>

            <div className={tile("people")} style={at(2)}>
                <p className={`${METAL} ${SPLIT} blms-wrapped__summary-people blms-wrapped__mid-y`}>
                    <Digits value={stats.peopleMet} metal />
                </p>
                <p className={`${LABEL} blms-wrapped__summary-people-label`}>
                    new {plural(stats.peopleMet, "person", "people")} met
                </p>
                <img className={`blms-wrapped__person ${POP}`} src={person} alt="" />
            </div>

            <div className={tile("numbers")} style={at(1)}>
                <p className={`${METAL} ${SPLIT} blms-wrapped__summary-points blms-wrapped__mid-y`}>
                    <Digits value={stats.points} metal />
                </p>
                <p className={`${LABEL} blms-wrapped__summary-points-label`}>{plural(stats.points, "point", "points")}</p>
                <p className={`${METAL} ${SPLIT} blms-wrapped__summary-discussions blms-wrapped__mid-y`}>
                    <Digits value={stats.discussions} metal />
                </p>
                <p className={`${LABEL} blms-wrapped__summary-discussions-label`}>
                    {plural(stats.discussions, "discussion", "discussions")}
                </p>
                <p className={`${METAL} ${SPLIT} blms-wrapped__summary-quizzes blms-wrapped__mid-y`}>
                    <Digits value={stats.quizzes} metal />
                </p>
                <p className={`${LABEL} blms-wrapped__summary-quizzes-label`}>{plural(stats.quizzes, "quiz", "quizzes")}</p>
                <p className={`${LABEL} blms-wrapped__tile-center blms-wrapped__summary-numbers-label`}>By the numbers</p>
            </div>

            <div className={tile("score")} style={at(5)}>
                <p className={`${METAL} ${SPLIT} blms-wrapped__summary-score`}>
                    <Digits value={stats.procrastinationScore} metal />
                </p>
                <p className={`${LABEL} blms-wrapped__tile-center blms-wrapped__summary-score-label`}>Procrastination score</p>
            </div>

            <div className={tile("day")} style={at(4)}>
                <p className={`${LABEL} blms-wrapped__summary-day-label`}>Busiest day</p>
                <img className={`blms-wrapped__clock ${POP}`} src={clock} alt="" />
                <p className={`${METAL} blms-wrapped__summary-day blms-wrapped__mid-y`}>{stats.busiestDay?.name ?? NONE}</p>
            </div>

            <div className={tile("course")} style={{ ...at(6), "--course-glow": courseGlow(courseColor) }}>
                {courseImage && (
                    <img className={`blms-wrapped__summary-course-photo ${IN} blms-wrapped__in--photo`} src={courseImage} alt="" />
                )}
                <p ref={courseRef} className={`${METAL} blms-wrapped__summary-course`}>{courseName}</p>
                <p className={`${LABEL} blms-wrapped__summary-course-label`}>Busiest course</p>
            </div>

            <h2 className={`${CHROME} blms-wrapped__summary-title ${IN}`} style={at(3)}>Canvas Wrapped {WRAPPED_YEAR}</h2>
            <p className={`blms-wrapped__byline blms-wrapped__summary-by blms-wrapped__mid-y ${IN}`} style={at(3)}>by</p>
            <p className={`blms-wrapped__brand blms-wrapped__summary-brand blms-wrapped__mid-y ${IN}`} style={at(3)}>BetterLMS</p>
        </>
    );
}

function OutroSlide() {
    return (
        <>
            <p className={`${METAL} blms-wrapped__outro-title blms-wrapped__mid-y ${IN}`} style={at(0)}>That’s all.</p>
            <p className={`${MUTED} blms-wrapped__outro-text ${IN}`} style={at(1)}>Thanks for kickin’ in.</p>
        </>
    );
}

export interface SlideDef {
    /** Absent for the intro, which WrappedModal renders with its status. */
    Slide?: ComponentType<SlideProps>;
    /** How many lines it comes in on. */
    lines: number;
    /** Its progress segment fills over the slide's duration. */
    timed: boolean;
    /** Moves on by itself once the segment is full. */
    advance: boolean;
}

export const SLIDES: SlideDef[] = [
    { lines: 4, timed: false, advance: false },
    { Slide: StatsSlide, lines: 9, timed: true, advance: true },
    { Slide: PeopleSlide, lines: 2, timed: true, advance: true },
    { Slide: ProcrastinationSlide, lines: 4, timed: true, advance: true },
    { Slide: BusiestDaySlide, lines: 3, timed: true, advance: true },
    { Slide: BusiestCourseSlide, lines: 3, timed: true, advance: true },
    // The one worth a screenshot waits for the user.
    { Slide: SummarySlide, lines: 7, timed: true, advance: false },
    // Shares the summary's segment, which is full by then.
    { Slide: OutroSlide, lines: 2, timed: false, advance: false },
];

/* From the slide appearing to moving on: its lines coming in, then time to
   read them. `start` is when its first line starts. */
export function slideDuration(index: number, start: number): number {
    return start + (SLIDES[index].lines - 1) * STAGGER_MS + LINE_MS + READ_MS;
}

/* The design's progress bar has six segments for the seven slides after the
   intro: the summary and the outro share the last one. */
export const PROGRESS_SEGMENTS = 6;

export function progressSegment(slide: number): number {
    return Math.min(slide - 1, PROGRESS_SEGMENTS - 1);
}
