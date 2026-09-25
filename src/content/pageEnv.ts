/*
 * Reads Canvas's ENV object from the page.
 *
 * The content script runs in an isolated world, so it cannot see window.ENV
 * even though the page sets it. The ENV object is a plain JSON literal in an
 * inline <script> in <head>, so it is parsed straight out of the page source.
 *
 * ENV is undocumented and differs from page to page, so every caller treats
 * each key as optional and checks its type.
 */

export type PageEnv = Record<string, unknown>;

/* Walks forward from the opening brace to its match, so the scan stops at the
   end of the ENV object rather than at the first "}" inside a string value.
   Returns -1 if the braces never balance. */
function findObjectEnd(text: string, open: number): number {
    let depth = 0;
    let inString = false;
    for (let i = open; i < text.length; i++) {
        const character = text[i];
        if (inString) {
            if (character === "\\") i++;               // skip the escaped character
            else if (character === '"') inString = false;
        } else if (character === '"') {
            inString = true;
        } else if (character === "{") {
            depth++;
        } else if (character === "}") {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

function parse(): PageEnv | null {
    for (const script of document.scripts) {
        if (script.src) continue;                     // only inline scripts carry ENV
        const text = script.textContent;
        if (!text) continue;

        const match = /\bENV\s*=\s*\{/.exec(text);
        if (!match) continue;

        const open = match.index + match[0].length - 1;
        const close = findObjectEnd(text, open);
        if (close < 0) continue;

        try {
            return JSON.parse(text.slice(open, close + 1)) as PageEnv;
        } catch {
            return null;                              // ENV is there but not plain JSON
        }
    }
    return null;
}

/* ENV never changes after the page loads, and on some pages (Grades) it is
   large, so a successful parse is kept. A miss isn't: this can run before the
   <script> carrying ENV has been parsed, and a later call should still find it. */
let cached: PageEnv | null = null;

export function readPageEnv(): PageEnv | null {
    cached ??= parse();
    return cached;
}
