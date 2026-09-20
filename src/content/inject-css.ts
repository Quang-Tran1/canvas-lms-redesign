/*
 * Adds a stylesheet to the page from a string. Widgets import their CSS with
 * Vite's "?inline" suffix and call this once at startup.
 *
 * The content script is built as one standalone file, so a plain CSS import
 * would be written to dist/ as a file nothing loads. Inlining keeps a widget's
 * styles inside its own folder, and they travel with the script wherever it
 * is injected (manifest match or a site the user enabled from the popup).
 *
 * At document_start there may be no <head> yet, so the element goes on <html>
 * in that case -- which also keeps it clear of Canvas re-rendering <body>.
 */
export function injectCss(id: string, css: string): void {
    if (document.getElementById(id)) return;
    const style = document.createElement("style");
    style.id = id;
    style.textContent = css;
    (document.head || document.documentElement).append(style);
}

/* Takes a widget's styles back off, for when the user switches it off. */
export function removeCss(id: string): void {
    document.getElementById(id)?.remove();
}
