/*
 * Lets the user replace a dashboard course card's image with their own.
 *
 * The controls live in Canvas's own card popover (the one with the Color and
 * Move tabs), under the color picker. Canvas renders that popover in a portal
 * at the end of <body>, not inside the card, so the card it belongs to is
 * remembered from the click on the card's header button that opened it.
 *
 * Images are applied through one injected stylesheet rather than on the
 * elements themselves: Canvas sets the card image as an inline style and
 * rewrites it whenever React re-renders the card, while a stylesheet rule with
 * !important outlives every re-render and beats the inline value. Removing a
 * course's rule hands the card straight back to Canvas's own image.
 *
 * A card whose course has no Canvas image has no image element to style, only
 * a solid color overlay. Those cards get an injected
 * .ic-DashboardCard__header_image wrapped around the overlay, so they pick up
 * Canvas's own image styles and show the color as a tint like any other card.
 */

import { injectCss } from "../inject-css";
import { courseIdOf } from "../grades/mount";
import { COURSE_IMAGES_KEY } from "../../shared/settings";
import css from "./courseImages.css?inline";

type CourseImages = Record<string, string>;

const CARD = ".ic-DashboardCard";
const HEADER_BUTTON = ".ic-DashboardCard__header-button";
const PICKER = ".ColorPicker__Container";
const SECTION_CLASS = "blms-course-image";
const STYLE_ID = "blms-course-images";

/* Cards are about 260px wide, so anything past this is bytes in storage that
   never reach the screen. Downscaling keeps an image to roughly 100 KB, where
   the original photo could easily take a sizeable bite of the 10 MB quota. */
const MAX_WIDTH = 800;

/* Redrawing a GIF on a canvas keeps only its first frame, so GIFs are stored
   as uploaded to stay animated, and capped instead of shrunk. Stored as base64
   that is about 2.7 MB, leaving room for a few next to the wallpaper. */
const MAX_GIF_BYTES = 2 * 1024 * 1024;

const HERO = ".ic-DashboardCard__header_hero";
const IMAGE_CLASS = "ic-DashboardCard__header_image";
const WRAPPER_CLASS = "blms-course-image-wrapper";

let images: CourseImages = {};

/* Course of the card whose popover was opened last. */
let openedCourseId: string | null = null;

/* Started by the first header-button click, or once there's a custom image
   for this Canvas, so other pages never pay for watching the DOM. */
let observer: MutationObserver | null = null;

export async function initCourseImages(): Promise<void> {
    document.addEventListener("click", onDocumentClick, true);
    const stored = await chrome.storage.local.get(COURSE_IMAGES_KEY);
    applyCourseImages(stored[COURSE_IMAGES_KEY]);
}

/* Called on load and again whenever any tab changes the stored images. */
export function applyCourseImages(value: unknown): void {
    images = isCourseImages(value) ? value : {};

    const prefix = `${location.host}/`;
    const rules: string[] = [];
    for (const [key, url] of Object.entries(images)) {
        if (!key.startsWith(prefix)) continue;
        const id = key.slice(prefix.length);
        if (!/^\d+$/.test(id)) continue;
        rules.push(courseRule(id, url));
    }

    let style = document.getElementById(STYLE_ID);
    if (!rules.length) {
        style?.remove();
    } else {
        if (!style) {
            style = document.createElement("style");
            style.id = STYLE_ID;
            (document.head || document.documentElement).append(style);
        }
        style.textContent = rules.join("\n");
    }

    for (const section of document.querySelectorAll<HTMLElement>(`.${SECTION_CLASS}`)) {
        updateResetButton(section);
    }

    // Also unwraps the cards whose image was just reset.
    if (rules.length || observer) {
        startObserving();
        decorate();
    }
}

function startObserving(): void {
    if (observer) return;
    injectCss("blms-course-images-css", css);
    observer = new MutationObserver(decorate);
    observer.observe(document.documentElement, { childList: true, subtree: true });
}

/* Idempotent, so the mutations it makes itself only re-run it once more. */
function decorate(): void {
    wrapHeroes();
    decoratePickers();
}

function courseRule(id: string, url: string): string {
    const card = `html ${CARD}:has(a.ic-DashboardCard__link[href$="/courses/${id}"])`;
    // Escape quotes/backslashes so the URL can't break out of url("...").
    const safeUrl = url.replace(/["\\]/g, "\\$&");
    return `${card} .${IMAGE_CLASS} {
  background-image: url("${safeUrl}") !important;
  background-size: cover !important;
  background-position: center !important;
}`;
}

function isCourseImages(value: unknown): value is CourseImages {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function storageKey(courseId: string): string {
    return `${location.host}/${courseId}`;
}

function onDocumentClick(event: MouseEvent): void {
    const button = (event.target as Element | null)?.closest?.(HEADER_BUTTON);
    const card = button?.closest(CARD);
    if (!card) return;

    openedCourseId = courseIdOf(card);
    startObserving();
    decorate();
}

/* Wraps the overlay of an image-less card that has a custom image, and puts
   it back once the image is reset. The overlay node itself is moved, never
   recreated, so React keeps updating the one it rendered. */
function wrapHeroes(): void {
    for (const card of document.querySelectorAll(CARD)) {
        const id = courseIdOf(card);
        const custom = id !== null && storageKey(id) in images;
        const wrapper = card.querySelector(`.${WRAPPER_CLASS}`);

        if (custom && !wrapper) {
            const hero = card.querySelector(HERO);
            if (!hero || hero.parentElement?.classList.contains(IMAGE_CLASS)) continue;
            const injected = document.createElement("div");
            injected.className = `${IMAGE_CLASS} ${WRAPPER_CLASS}`;
            hero.replaceWith(injected);
            injected.append(hero);
        } else if (!custom && wrapper) {
            const hero = wrapper.querySelector(HERO);
            if (hero) wrapper.replaceWith(hero);
            else wrapper.remove();
        }
    }
}

/* The popover's content mounts after the click, and remounts whenever the
   user switches back to its Color tab, so every new picker gets a section. */
function decoratePickers(): void {
    if (!openedCourseId) return;
    for (const picker of document.querySelectorAll(PICKER)) {
        if (picker.querySelector(`.${SECTION_CLASS}`)) continue;
        picker.append(buildSection(openedCourseId));
    }
}

function buildSection(courseId: string): HTMLElement {
    const section = document.createElement("div");
    section.className = SECTION_CLASS;
    section.dataset.courseId = courseId;

    const title = document.createElement("div");
    title.className = `${SECTION_CLASS}__title`;
    title.textContent = "Course Image";

    const upload = button("Upload", () => pickImage(section));
    const reset = button("Reset", () => resetImage(section));
    reset.dataset.role = "reset";

    const actions = document.createElement("div");
    actions.className = `${SECTION_CLASS}__actions`;
    actions.append(upload, reset);

    const status = document.createElement("div");
    status.className = `${SECTION_CLASS}__status`;
    status.setAttribute("role", "status");

    section.append(title, actions, status);
    updateResetButton(section);
    return section;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
    const element = document.createElement("button");
    element.type = "button";
    element.className = `${SECTION_CLASS}__button`;
    element.textContent = label;
    element.addEventListener("click", onClick);
    return element;
}

function updateResetButton(section: HTMLElement): void {
    const reset = section.querySelector<HTMLButtonElement>('[data-role="reset"]');
    const id = section.dataset.courseId;
    if (reset && id) reset.disabled = !(storageKey(id) in images);
}

function setStatus(section: HTMLElement, text: string): void {
    const status = section.querySelector(`.${SECTION_CLASS}__status`);
    if (status) status.textContent = text;
}

/* The input is never attached to the page. Opening the file dialog can take
   focus away from the popover and close it, and a detached input still
   reports the chosen file once the dialog returns. */
function pickImage(section: HTMLElement): void {
    const courseId = section.dataset.courseId;
    if (!courseId) return;

    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.addEventListener("change", () => {
        const file = input.files?.[0];
        if (file) saveImage(section, courseId, file);
    });
    input.click();
}

async function saveImage(section: HTMLElement, courseId: string, file: File): Promise<void> {
    if (!file.type.startsWith("image/")) {
        setStatus(section, "That file isn't an image.");
        return;
    }

    const isGif = file.type === "image/gif";
    if (isGif && file.size > MAX_GIF_BYTES) {
        setStatus(section, `That GIF is ${formatSize(file.size)}. GIFs stay animated, so they can't be shrunk; the limit is ${formatSize(MAX_GIF_BYTES)}.`);
        return;
    }

    setStatus(section, "Reading image…");
    let dataUrl: string;
    try {
        dataUrl = isGif ? await readGif(file) : await toCardImage(file);
    } catch {
        // A HEIC photo passes the type check above but Chrome can't decode it.
        setStatus(section, /heic|heif/i.test(file.type)
            ? "Chrome can't display HEIC photos. Export it as a JPEG first."
            : "Chrome can't display that image format.");
        return;
    }

    try {
        // Re-read rather than trusting `images`, so a change saved from another
        // tab in the meantime isn't overwritten.
        const stored = (await chrome.storage.local.get(COURSE_IMAGES_KEY))[COURSE_IMAGES_KEY];
        const next = { ...(isCourseImages(stored) ? stored : {}), [storageKey(courseId)]: dataUrl };
        await chrome.storage.local.set({ [COURSE_IMAGES_KEY]: next });
    } catch {
        setStatus(section, "Not enough room to store that image. Try a smaller one.");
        return;
    }
    setStatus(section, "");
}

async function resetImage(section: HTMLElement): Promise<void> {
    const courseId = section.dataset.courseId;
    if (!courseId) return;

    const stored = (await chrome.storage.local.get(COURSE_IMAGES_KEY))[COURSE_IMAGES_KEY];
    if (!isCourseImages(stored)) return;
    const { [storageKey(courseId)]: _removed, ...rest } = stored;
    await chrome.storage.local.set({ [COURSE_IMAGES_KEY]: rest });
    setStatus(section, "");
}

/* Decoding first is the check that Chrome can display it at all. */
async function readGif(file: File): Promise<string> {
    (await createImageBitmap(file)).close();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}

function formatSize(bytes: number): string {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* Decodes the file (which is also the check that Chrome can display it at
   all) and re-encodes it no wider than MAX_WIDTH. */
async function toCardImage(file: File): Promise<string> {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_WIDTH / bitmap.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return canvas.toDataURL("image/webp", 0.85);
}
