/*
 * Puts the "Canvas Wrapped 2026" button just under the Dashboard panel's
 * lower-right corner, and opens the Wrapped story from it. The button is only
 * there December 2 through 13 (wrappedShowing in stats.ts).
 *
 * Everything renders into a shadow root on its own <blms-wrapped> element.
 * The story is a pixel-matched full-screen design, and Canvas's global rules
 * (p and img margins, button chrome, its fonts) and styles.css's would all
 * bleed into it otherwise. A custom element name keeps Canvas's own div and
 * section selectors off the host too.
 */

import { render } from "preact";
import { useRef, useState } from "preact/hooks";
import { injectCss } from "../inject-css";
import { injectWrappedFonts } from "./fonts";
import { WrappedModal } from "./WrappedModal";
import { type Point } from "./NavCursor";
import { WRAPPED_YEAR, wrappedShowing } from "./stats";
import { loadWrappedStats } from "./wrappedApi";
import launcherArrow from "../../assets/wrapped/launcher-arrow.svg?inline";
import css from "./wrapped.css?inline";

const HOST_TAG = "blms-wrapped";

/*
 * The custom properties wrapped.css animates. Registering them is what lets
 * them change smoothly instead of jumping between keyframes, and like
 * @font-face, @property only counts in a document stylesheet, not inside the
 * shadow root. --blms-sheen sweeps the light across metal text; --blms-iris
 * is the radius of the opening iris.
 */
const PROPERTIES = `
@property --blms-sheen { syntax: "<number>"; inherits: true; initial-value: 0; }
@property --blms-iris { syntax: "<length>"; inherits: true; initial-value: 0px; }
`;

/*
 * Where the launcher sits: under the Dashboard panel (#content, which
 * styles.css turns into the glass panel), lined up with its right edge.
 * Anchor positioning keeps it there as the cards load, the panel grows, or
 * the window resizes, with nothing to measure. Anchor names only match within
 * the tree that declares them, so both ends are set here in the document
 * rather than one of them in the shadow root. Without anchor positioning, or
 * without the panel, the launcher keeps wrapped.css's top-left corner.
 */
const PLACEMENT = `
@supports (anchor-name: --blms-wrapped-dashboard) {
  #content { anchor-name: --blms-wrapped-dashboard; }
  ${HOST_TAG} {
    position-anchor: --blms-wrapped-dashboard;
    top: calc(anchor(bottom) + 16px);
    right: anchor(right);
    left: auto;
  }
}
`;

/* Canvas serves the Dashboard at the root, whichever view the user picked. */
function onDashboard(): boolean {
    return location.pathname === "/";
}

export function initWrapped(): void {
    if (!onDashboard() || !wrappedShowing()) return;
    // At document_start there's no <body> to attach to yet.
    if (document.body) mount();
    else document.addEventListener("DOMContentLoaded", mount, { once: true });
}

function mount(): void {
    if (document.querySelector(HOST_TAG)) return;      // already mounted

    injectWrappedFonts();
    injectCss("blms-wrapped-properties", PROPERTIES);
    // An anchor that isn't there would leave the launcher wherever it fell in
    // the page, so it only moves under the panel when there's a panel.
    if (document.getElementById("content")) injectCss("blms-wrapped-placement", PLACEMENT);

    const host = document.createElement(HOST_TAG);
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = css;
    // Preact gets a container of its own: rendering straight into the shadow
    // root would treat the <style> beside it as a stale node to remove.
    const root = document.createElement("div");
    root.className = "blms-wrapped";
    shadow.append(style, root);
    document.body.append(host);

    render(<WrappedApp />, root);
}

/* Starts loading the year as soon as the user heads for the button. The modal
   picks the same request up, and reports it if it fails. */
function prefetch(): void {
    loadWrappedStats().catch(() => {});
}

function WrappedApp() {
    const launcher = useRef<HTMLButtonElement>(null);
    // Undefined while closed; otherwise where the pointer was when it opened
    // (null when opened from the keyboard), so the arrow cursor starts there.
    const [openedAt, setOpenedAt] = useState<Point | null | undefined>(undefined);

    const origin = (): Point => {
        const rect = launcher.current?.getBoundingClientRect();
        return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : { x: 0, y: 0 };
    };

    return (
        <>
            <button
                ref={launcher}
                type="button"
                className="blms-wrapped__launcher"
                onPointerEnter={prefetch}
                onFocus={prefetch}
                // detail is 0 for a click synthesized by Enter or Space.
                onClick={(event) => setOpenedAt(event.detail > 0 ? { x: event.clientX, y: event.clientY } : null)}
            >
                <span className="blms-wrapped__launcher-label">Canvas Wrapped {WRAPPED_YEAR}</span>
                <img src={launcherArrow} alt="" width={16} height={16} />
            </button>
            {openedAt !== undefined && (
                <WrappedModal openedAt={openedAt} origin={origin} onClose={() => setOpenedAt(undefined)} />
            )}
        </>
    );
}
