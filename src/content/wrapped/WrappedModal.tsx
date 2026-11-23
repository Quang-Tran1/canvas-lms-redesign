/*
 * The full-screen Wrapped story: the wallpaper, the slide card, and the
 * arrow cursor that pages through it.
 *
 * A native <dialog> opened with showModal(), so it sits in the top layer over
 * every Canvas z-index, makes the page behind it inert, and hands focus back
 * to the launcher when it closes.
 *
 * It opens as an iris from the launcher: a soft-edged circle with a ring of
 * light at its rim grows from the button to cover the screen, while the
 * wallpaper settles out of a zoom and the card rises into focus. Closing runs
 * the iris back into the launcher.
 *
 * Each slide's segment of the progress bar fills over the slide's duration
 * and then moves the story on. Holding the mouse down pauses it, the way
 * stories do; only a quick click turns the page.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import wallpaper from "../../assets/wrapped/wallpaper.webp?inline";
import { NavCursor, pointsBack, type Point } from "./NavCursor";
import {
    DIGIT_MS,
    DIGIT_STAGGER_MS,
    IntroSlide,
    LINE_MS,
    PROGRESS_SEGMENTS,
    SLIDES,
    STAGGER_MS,
    layoutPieces,
    progressSegment,
    slideDuration,
    type IntroStatus,
} from "./slides";
import { WRAPPED_YEAR, hasEnoughData, type WrappedStats } from "./stats";
import { loadWrappedStats, loadedWrappedStats } from "./wrappedApi";

/* The Figma frame every slide is drawn on, and the card inside it. */
const STAGE_WIDTH = 1280;
const STAGE_HEIGHT = 832;
const CARD_INSET = 48;

/* When the intro's first line starts: once the iris is most of the way open. */
const OPENING_START_MS = 650;
/* How long a slide takes to fade out, and so when the next one's lines start. */
const EXIT_MS = 350;
/* The iris: how long it takes to open and close, and its soft edge. */
const IRIS_OPEN_MS = 1300;
const IRIS_CLOSE_MS = 800;
const IRIS_FEATHER = 48;
/* A press longer than this pauses the story instead of turning the page. */
const HOLD_MS = 350;
/* With reduced motion, lines just fade in, closer together. */
const REDUCED_STAGGER_MS = 150;

function stageScale(): number {
    return Math.min(window.innerWidth / STAGE_WIDTH, window.innerHeight / STAGE_HEIGHT);
}

function useStageScale(): number {
    const [scale, setScale] = useState(stageScale);
    useEffect(() => {
        const update = () => setScale(stageScale());
        window.addEventListener("resize", update);
        return () => window.removeEventListener("resize", update);
    }, []);
    return scale;
}

function prefersReducedMotion(): boolean {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function usePageHidden(): boolean {
    const [hidden, setHidden] = useState(document.hidden);
    useEffect(() => {
        const update = () => setHidden(document.hidden);
        document.addEventListener("visibilitychange", update);
        return () => document.removeEventListener("visibilitychange", update);
    }, []);
    return hidden;
}

/* The year's numbers, once Canvas has sent them. Usually already on their
   way: the launcher starts loading when the pointer reaches it. */
function useWrappedStats(): { stats?: WrappedStats; failed?: boolean } {
    const [state, setState] = useState<{ stats?: WrappedStats; failed?: boolean }>(() => ({ stats: loadedWrappedStats() }));
    useEffect(() => {
        if (state.stats) return;
        let live = true;
        loadWrappedStats().then(
            (stats) => live && setState({ stats }),
            (cause) => {
                console.warn("[BetterLMS] Wrapped could not load:", cause);
                if (live) setState({ failed: true });
            },
        );
        return () => {
            live = false;
        };
    }, []);
    return state;
}

interface Iris {
    origin: Point;
    /** Far enough to clear the farthest corner, soft edge and all. */
    radius: number;
}

function irisFrom(origin: Point): Iris {
    const dx = Math.max(origin.x, window.innerWidth - origin.x);
    const dy = Math.max(origin.y, window.innerHeight - origin.y);
    return { origin, radius: Math.hypot(dx, dy) + IRIS_FEATHER };
}

/* The iris origin in the card's own coordinates, so the card grows out of
   the launcher's side of the screen. */
function cardOrigin({ x, y }: Point, scale: number): string {
    const left = window.innerWidth / 2 - (STAGE_WIDTH / 2 - CARD_INSET) * scale;
    const top = window.innerHeight / 2 - (STAGE_HEIGHT / 2 - CARD_INSET) * scale;
    return `${(x - left) / scale}px ${(y - top) / scale}px`;
}

/* One slide on the card. The outgoing one stays a moment to fade out. */
interface Frame {
    index: number;
    key: number;
    /** When its first line starts, in ms after it appears. */
    start: number;
    leaving?: boolean;
}

function SlideFrame({ frame, stats, status, onGone }: {
    frame: Frame;
    stats?: WrappedStats;
    status: IntroStatus;
    onGone: (key: number) => void;
}) {
    const ref = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        const root = ref.current!;
        layoutPieces(root);
        // Again whenever split text changes size, as it does when a face
        // finishes loading after the slide first rendered.
        const observer = new ResizeObserver(() => layoutPieces(root));
        for (const copy of root.querySelectorAll(".blms-wrapped__sr")) observer.observe(copy.parentElement!);
        for (const host of root.querySelectorAll(".blms-wrapped__metal--split")) observer.observe(host);
        return () => observer.disconnect();
    }, []);

    const { Slide } = SLIDES[frame.index];
    return (
        <div
            ref={ref}
            className={frame.leaving ? "blms-wrapped__slide blms-wrapped__slide--leaving" : "blms-wrapped__slide"}
            style={{ "--start": `${frame.start}ms` }}
            aria-hidden={frame.leaving ? "true" : undefined}
            onAnimationEnd={(event) => {
                if (event.target === event.currentTarget && frame.leaving) onGone(frame.key);
            }}
        >
            {Slide && stats ? <Slide stats={stats} /> : <IntroSlide status={status} />}
        </div>
    );
}

/* A segment whose slide was clicked past before it filled, and how much of it
   was still empty. */
interface CutShort {
    segment: number;
    empty: number;
}

/* The current slide's segment fills over the slide's duration, and the ones
   before it stay full. A segment cut short by a click quickly fills the rest
   of the way rather than jumping, so each segment keeps one fill element
   throughout and the new frame reads how far the old one had got before it
   replaces the animation. */
function SlideProgress({ frame, paused, onDone }: { frame: Frame; paused: boolean; onDone: () => void }) {
    const active = progressSegment(frame.index);
    const { timed } = SLIDES[frame.index];
    const fills = useRef<(HTMLSpanElement | null)[]>([]);
    const shown = useRef({ key: frame.key, segment: active });
    const cutShort = useRef<CutShort | null>(null);

    // Read during render, while the old frame's fill is still animating.
    if (frame.key !== shown.current.key) {
        const { segment } = shown.current;
        const progress = fills.current[segment]?.getAnimations()[0]?.effect?.getComputedTiming().progress;
        const nowFull = segment < active || (segment === active && !timed);
        cutShort.current = nowFull && typeof progress === "number" && progress < 1 ? { segment, empty: 1 - progress } : null;
        shown.current = { key: frame.key, segment: active };
    }

    const fillClass = (i: number) => {
        if (i === active && timed) return "blms-wrapped__fill blms-wrapped__fill--timed";
        if (i === cutShort.current?.segment) return "blms-wrapped__fill blms-wrapped__fill--finish";
        return "blms-wrapped__fill";
    };

    return (
        <div className="blms-wrapped__progress" aria-hidden="true">
            {Array.from({ length: PROGRESS_SEGMENTS }, (_, i) => (
                <span key={i} className="blms-wrapped__segment">
                    {i <= active && (
                        <span
                            ref={(element) => {
                                fills.current[i] = element;
                            }}
                            className={fillClass(i)}
                            style={i === active && timed ? {
                                animationDuration: `${slideDuration(frame.index, frame.start)}ms`,
                                animationPlayState: paused ? "paused" : "running",
                            } : i === cutShort.current?.segment ? {
                                "--empty": `${cutShort.current.empty * 100}%`,
                            } : undefined}
                            onAnimationEnd={i === active && timed ? onDone : undefined}
                        />
                    )}
                </span>
            ))}
        </div>
    );
}

interface Props {
    /** Where the pointer was when the launcher was clicked, for the cursor. */
    openedAt: Point | null;
    /** The launcher's center, where the iris opens from and closes into. */
    origin: () => Point;
    onClose: () => void;
}

export function WrappedModal({ openedAt, origin, onClose }: Props) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const [reduced] = useState(prefersReducedMotion);
    const [phase, setPhase] = useState<"opening" | "open" | "closing">(reduced ? "open" : "opening");
    const [iris, setIris] = useState(() => irisFrom(origin()));
    const [frames, setFrames] = useState<Frame[]>([{ index: 0, key: 0, start: reduced ? 0 : OPENING_START_MS }]);
    const nextKey = useRef(1);
    const [held, setHeld] = useState(false);
    // When the current press began, if one is in progress.
    const pressedAt = useRef<number | null>(null);
    const hidden = usePageHidden();
    const { stats, failed } = useWrappedStats();
    const scale = useStageScale();

    const current = frames[frames.length - 1];
    const slide = current.index;
    const last = SLIDES.length - 1;
    const status: IntroStatus = stats ? (hasEnoughData(stats) ? "ready" : "empty") : failed ? "failed" : "loading";

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        dialog.showModal();

        // The dialog covers the page, but the wheel would still scroll it.
        const root = document.documentElement;
        const overflow = root.style.overflow;
        root.style.overflow = "hidden";

        return () => {
            root.style.overflow = overflow;
            if (dialog.open) dialog.close();
        };
    }, []);

    const close = () => {
        if (phase === "closing") return;
        if (reduced) {
            onClose();
            return;
        }
        setIris(irisFrom(origin()));
        setPhase("closing");
    };

    const show = (index: number) => {
        setFrames([
            { ...current, leaving: true },
            { index, key: nextKey.current++, start: reduced ? 0 : EXIT_MS },
        ]);
    };

    // Going forward from the last slide is how the story ends. The intro
    // holds until the year has loaded, or closes if it couldn't. A year with
    // too little in it holds there for good; the intro says Escape leaves.
    const go = (step: 1 | -1) => {
        if (phase === "closing") return;
        if (step === -1) {
            if (slide > 0) show(slide - 1);
        } else if (status !== "ready") {
            if (status === "failed") close();
        } else if (slide === last) {
            close();
        } else {
            show(slide + 1);
        }
    };

    const onPointerDown = (event: PointerEvent) => {
        if (event.button !== 0) return;
        pressedAt.current = event.timeStamp;
        setHeld(true);
    };

    const onClick = (event: MouseEvent) => {
        const start = pressedAt.current;
        pressedAt.current = null;
        if (start !== null && event.timeStamp - start > HOLD_MS) return;
        go(pointsBack(event.clientX, slide > 0) ? -1 : 1);
    };

    const onKeyDown = (event: KeyboardEvent) => {
        const forward = event.key === "ArrowRight" || event.key === " " || event.key === "Enter";
        if (!forward && event.key !== "ArrowLeft") return;
        event.preventDefault();
        event.stopPropagation();
        // A held key would race through the slides and out the end.
        if (!event.repeat) go(forward ? 1 : -1);
    };

    // Escape closes through the same iris.
    const onCancel = (event: Event) => {
        event.preventDefault();
        close();
    };

    // The iris normally ends on its animationend. In a tab that isn't
    // drawing frames the animation never advances, so a timer finishes the
    // phase instead of leaving the page behind a half-open iris.
    useEffect(() => {
        if (phase === "open") return;
        const timer = phase === "opening"
            ? setTimeout(() => setPhase((now) => (now === "opening" ? "open" : now)), IRIS_OPEN_MS + 250)
            : setTimeout(onClose, IRIS_CLOSE_MS + 250);
        return () => clearTimeout(timer);
    }, [phase]);

    const onAnimationEnd = (event: AnimationEvent) => {
        if (event.target !== event.currentTarget) return;
        if (event.animationName === "blms-iris-open") setPhase("open");
        else if (event.animationName === "blms-iris-close") onClose();
    };

    const onSlideDone = () => {
        if (SLIDES[slide].advance) go(1);
    };

    const classes = ["blms-wrapped__dialog", `blms-wrapped__dialog--${phase}`];
    if (reduced) classes.push("blms-wrapped__dialog--reduced");

    return (
        <dialog
            ref={dialogRef}
            className={classes.join(" ")}
            aria-label={`Canvas Wrapped ${WRAPPED_YEAR}`}
            style={{
                "--blms-wrapped-scale": scale,
                "--blms-line": `${LINE_MS}ms`,
                "--blms-stagger": `${reduced ? REDUCED_STAGGER_MS : STAGGER_MS}ms`,
                "--blms-digit": `${DIGIT_MS}ms`,
                "--blms-digit-stagger": `${DIGIT_STAGGER_MS}ms`,
                "--iris-x": `${iris.origin.x}px`,
                "--iris-y": `${iris.origin.y}px`,
                "--iris-max": `${iris.radius}px`,
                "--iris-feather": `${IRIS_FEATHER}px`,
                "--iris-open": `${IRIS_OPEN_MS}ms`,
                "--iris-close": `${IRIS_CLOSE_MS}ms`,
            }}
            onClick={onClick}
            onPointerDown={onPointerDown}
            onPointerUp={() => setHeld(false)}
            onPointerCancel={() => setHeld(false)}
            onKeyDown={onKeyDown}
            onCancel={onCancel}
            onAnimationEnd={onAnimationEnd}
        >
            <div className="blms-wrapped__scene">
                <div className="blms-wrapped__wallpaper" style={{ backgroundImage: `url("${wallpaper}")` }} />
                <div className="blms-wrapped__stage">
                    <div className="blms-wrapped__card" style={{ transformOrigin: cardOrigin(iris.origin, scale) }} aria-live="polite">
                        {frames.map((frame) => (
                            <SlideFrame
                                key={frame.key}
                                frame={frame}
                                stats={stats}
                                status={status}
                                onGone={(key) => setFrames((all) => all.filter((f) => f.key !== key))}
                            />
                        ))}
                        {slide > 0 && <SlideProgress frame={current} paused={held || hidden} onDone={onSlideDone} />}
                    </div>
                </div>
            </div>
            <div className="blms-wrapped__iris-ring" aria-hidden="true" />
            <NavCursor
                initial={openedAt}
                canGoBack={slide > 0}
                busy={status === "loading"}
                gone={phase === "closing"}
                scale={scale}
                still={reduced}
            />
        </dialog>
    );
}
