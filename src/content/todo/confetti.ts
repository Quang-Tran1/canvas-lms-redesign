/*
 * Shoots confetti inside Canvas's right sidebar when a task is completed.
 *
 * canvas-confetti is bundled rather than loaded from its CDN: Manifest V3
 * forbids remotely hosted code, and the Web Store rejects extensions that
 * load it.
 *
 * The confetti draws on a canvas of our own laid over #right-side-wrapper, so
 * it stays inside the sidebar's rounded box instead of covering the page.
 */

import confetti from "canvas-confetti";

const WRAPPER = "#right-side-wrapper";
const CANVAS_CLASS = "blms-confetti";

let canvas: HTMLCanvasElement | null = null;
let fire: confetti.CreateTypes | null = null;

export function shootConfetti(): void {
    const wrapper = document.querySelector<HTMLElement>(WRAPPER);
    if (!wrapper) return;

    // Canvas can re-render the sidebar, so a canvas from earlier may be gone.
    if (!canvas || canvas.parentElement !== wrapper) {
        removeConfetti();
        canvas = document.createElement("canvas");
        canvas.className = CANVAS_CLASS;
        canvas.setAttribute("aria-hidden", "true");
        // The canvas is positioned against the wrapper. Only touched when
        // Canvas hasn't positioned it already, so its own layout is kept.
        if (getComputedStyle(wrapper).position === "static") wrapper.style.position = "relative";
        wrapper.append(canvas);
        // No worker: Canvas's content security policy can block the blob:
        // URL the library starts it from.
        fire = confetti.create(canvas, { useWorker: false, disableForReducedMotion: true });
    }

    // The library only sizes a canvas to its box once, but the sidebar
    // shrinks as completed cards leave it, so the size is checked every shot.
    const { width, height } = canvas.getBoundingClientRect();
    if (canvas.width !== Math.round(width)) canvas.width = Math.round(width);
    if (canvas.height !== Math.round(height)) canvas.height = Math.round(height);

    // The library's "basic cannon".
    fire!({ particleCount: 100, spread: 70, origin: { y: 0.3 } });
}

/* For when the To-Do widget is switched off. */
export function removeConfetti(): void {
    fire?.reset();
    canvas?.remove();
    fire = null;
    canvas = null;
}
