/*
 * The pointer while Wrapped is open: the design's round arrow button, pointing
 * forward on the right half of the screen and back on the left. It replaces
 * the slide's own next button; a click anywhere goes the way it points.
 *
 * A DOM element rather than a CSS cursor image: the button blurs what's behind
 * it, which a cursor image can't, and Chrome drops cursor images this large
 * whenever they'd overlap the browser's own UI near the window edge. It's
 * drawn in CSS (a glass circle, and an arrow of three rounded bars) rather
 * than from the design's SVG: an <img> is rasterized at its own size before
 * the stage's scale shrinks it, which left the circle's edge jagged.
 *
 * It trails the real pointer a little, eased toward it every frame, bubbles
 * in when the pointer arrives and out when it leaves, and presses in (smaller
 * and blurred, like the extension's other buttons) while the mouse is down or
 * while the modal is busy.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

export interface Point {
    x: number;
    y: number;
}

/* Shared with the modal's click handler so the arrow and the click agree.
   With nothing to go back to, the whole screen goes forward. */
export function pointsBack(x: number, canGoBack: boolean): boolean {
    return canGoBack && x < window.innerWidth / 2;
}

/* How far behind the pointer it trails: the time it takes to close about
   two thirds of the gap. */
const TRAIL_MS = 70;

type Shown = "hidden" | "in" | "out";

interface Props {
    /** Where the pointer was when Wrapped opened, or null if unknown. */
    initial: Point | null;
    canGoBack: boolean;
    /** Held pressed in, for while the year is loading. */
    busy: boolean;
    /** Bubbles out for good, as the modal closes. */
    gone: boolean;
    /** The stage's scale, so the button keeps its size relative to the slide. */
    scale: number;
    /** Follow the pointer exactly, with no trailing. */
    still: boolean;
}

export function NavCursor({ initial, canGoBack, busy, gone, scale, still }: Props) {
    const ref = useRef<HTMLDivElement>(null);
    // Where the pointer is, and where the button is on its way there.
    const target = useRef<Point | null>(initial);
    const position = useRef<Point | null>(initial && { ...initial });
    const live = useRef({ scale, canGoBack, still, shown: (initial ? "in" : "hidden") as Shown });
    const [shown, setShown] = useState<Shown>(live.current.shown);
    const [back, setBack] = useState(() => !!initial && pointsBack(initial.x, canGoBack));
    const [pressed, setPressed] = useState(false);

    live.current.scale = scale;
    live.current.canGoBack = canGoBack;
    live.current.still = still;
    live.current.shown = shown;

    const place = () => {
        const element = ref.current;
        const p = position.current;
        if (element && p) {
            element.style.transform = `translate3d(${p.x}px, ${p.y}px, 0) scale(${live.current.scale})`;
        }
    };

    useLayoutEffect(place, [scale]);

    useEffect(() => {
        if (target.current) setBack(pointsBack(target.current.x, canGoBack));
    }, [canGoBack]);

    useEffect(() => {
        let frame = 0;
        let last = 0;

        // Eases the button toward the pointer, and stops once it's there.
        const step = (now: number) => {
            const t = target.current;
            const p = position.current;
            if (!t || !p) {
                frame = 0;
                return;
            }
            const dt = last ? Math.min(now - last, 64) : 16;
            last = now;
            const k = live.current.still ? 1 : 1 - Math.exp(-dt / TRAIL_MS);
            p.x += (t.x - p.x) * k;
            p.y += (t.y - p.y) * k;
            place();
            if (Math.abs(t.x - p.x) + Math.abs(t.y - p.y) > 0.1) {
                frame = requestAnimationFrame(step);
            } else {
                frame = 0;
                last = 0;
            }
        };

        const hide = () => {
            if (live.current.shown === "in") setShown("out");
        };

        const track = (event: PointerEvent) => {
            // Touch and pen have no pointer to replace.
            if (event.pointerType !== "mouse") {
                hide();
                return;
            }
            const point = { x: event.clientX, y: event.clientY };
            target.current = point;
            // Coming back, it appears where the pointer is rather than gliding
            // over from where it left.
            if (live.current.shown !== "in" || !position.current) {
                position.current = { ...point };
                place();
                setShown("in");
            }
            setBack(pointsBack(point.x, live.current.canGoBack));
            if (!frame) frame = requestAnimationFrame(step);
        };

        const press = (event: PointerEvent) => {
            track(event);
            if (event.pointerType === "mouse" && event.button === 0) setPressed(true);
        };
        const release = () => setPressed(false);
        const leave = (event: MouseEvent) => {
            if (!event.relatedTarget) hide();
        };

        window.addEventListener("pointermove", track);
        window.addEventListener("pointerdown", press);
        window.addEventListener("pointerup", release);
        window.addEventListener("pointercancel", release);
        window.addEventListener("blur", release);
        document.addEventListener("mouseout", leave);
        return () => {
            cancelAnimationFrame(frame);
            window.removeEventListener("pointermove", track);
            window.removeEventListener("pointerdown", press);
            window.removeEventListener("pointerup", release);
            window.removeEventListener("pointercancel", release);
            window.removeEventListener("blur", release);
            document.removeEventListener("mouseout", leave);
        };
    }, []);

    const state: Shown = gone ? (shown === "hidden" ? "hidden" : "out") : shown;
    const bubble = `blms-wrapped__cursor-bubble blms-wrapped__cursor-bubble--${state}`;
    return (
        <div ref={ref} className={back ? "blms-wrapped__cursor blms-wrapped__cursor--back" : "blms-wrapped__cursor"} aria-hidden="true">
            <div className={busy || pressed ? `${bubble} blms-wrapped__cursor-bubble--pressed` : bubble}>
                <span className="blms-wrapped__cursor-arrow" />
            </div>
        </div>
    );
}
