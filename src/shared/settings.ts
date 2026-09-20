/*
 * User settings stored in chrome.storage.local, and the functions that apply
 * them to a document. Shared by the popup (which edits them and previews them
 * on itself) and the content script (which applies them to Canvas).
 */

export const BG_KEY = "backgroundImage";          // string, the user's background image as a data: URL
export const SCHOOL_ACCENT_KEY = "useSchoolAccent"; // boolean, defaults to true
export const ACCENT_KEY = "accentColor";          // string, "#rrggbb"
export const THEME_KEY = "colorScheme";           // one of THEMES; light when unset
export const TODO_KEY = "enableTodo";             // boolean, defaults to true

export const THEMES = ["light", "hybrid", "dark"] as const;
export type Theme = (typeof THEMES)[number];
export const DEFAULT_THEME: Theme = "light";
export const DEFAULT_ACCENT = "#b33d3e";

const BG_STYLE_ID = "canvas-redesign-bg";

/* chrome.storage.local gives us 10 MB, and base64 makes the stored copy about a
   third bigger than the file on disk. Capping the file at 4 MB keeps a saved
   image well inside the quota without needing the unlimitedStorage permission. */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export interface Settings {
    [BG_KEY]?: string;
    [SCHOOL_ACCENT_KEY]?: boolean;
    [ACCENT_KEY]?: string;
    [THEME_KEY]?: string;
    [TODO_KEY]?: boolean;
}

export function readSettings(): Promise<Settings> {
    return chrome.storage.local.get([BG_KEY, SCHOOL_ACCENT_KEY, ACCENT_KEY, THEME_KEY, TODO_KEY]) as Promise<Settings>;
}

/* Settings that default to on read as enabled unless explicitly stored false,
   so a user who has never opened the popup still gets them. */
export function isEnabled(value: unknown): boolean {
    return value !== false;
}

export function isTheme(value: unknown): value is Theme {
    return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

export function isHexColor(value: unknown): value is string {
    return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

/* Paints the wallpaper by injecting a <style> element rather than by setting a
   CSS variable. Chrome silently discards any custom property value longer than
   2 MiB, and a base64 image passes that easily -- setProperty reports no error,
   the declaration simply never lands, and styles.css quietly falls back to its
   default image. background-image declared directly has no such limit.

   The element lives in <head> (or <html> before <head> exists at
   document_start), so Canvas re-rendering <body> can't wipe it out. */
export function applyBackground(url: string | undefined): void {
    const root = document.documentElement;
    if (!root) return;

    const existing = document.getElementById(BG_STYLE_ID);
    if (!url) {
        if (existing) existing.remove();
        return;
    }

    const style = existing || document.createElement("style");
    style.id = BG_STYLE_ID;
    // Escape quotes/backslashes so the URL can't break out of url("...").
    // !important is what beats the default rule in styles.css, whichever
    // order the two stylesheets happen to land in.
    style.textContent = `html body { background-image: url("${url.replace(/["\\]/g, "\\$&")}") !important; }`;
    if (!existing) (document.head || root).append(style);
}

/* Overrides --accent (and the fill derived from it) with the user's own color.
   Clearing the inline values hands control back to styles.css, where --accent is
   var(--ic-brand-primary) -- the school's own brand color. */
export function applyAccent(useSchoolAccent: boolean, color: unknown): void {
    const root = document.documentElement;
    if (!root) return;

    if (useSchoolAccent || !isHexColor(color)) {
        root.style.removeProperty("--accent");
        root.style.removeProperty("--accent-fill");
    } else {
        root.style.setProperty("--accent", color);
        root.style.setProperty("--accent-fill", `color-mix(in srgb, ${color} 20%, transparent)`);
    }
}

/* Every palette in styles.css hangs off :root[data-theme="..."], light
   included -- there is no bare :root block -- so the attribute is always
   present. Removing it for light would leave the page with no variables
   defined at all rather than a light theme. An unrecognised stored value
   falls back rather than propagating through as a broken attribute.

   Works on the popup's own <html> too, which is why the popup can restyle
   itself with the same call. */
export function applyTheme(theme: unknown): void {
    const root = document.documentElement;
    if (!root) return;

    root.setAttribute("data-theme", isTheme(theme) ? theme : DEFAULT_THEME);
}
