/*
 * Content script: applies the stored theme, accent and wallpaper to a Canvas
 * page, and keeps them in sync while the popup edits them.
 *
 * Chrome injects content scripts a second time whenever a page that already
 * has them gets executeScript'd again -- re-enabling a site without reloading,
 * for one. The sentinel stops the second copy from initializing over the first.
 */

import {
    ACCENT_KEY,
    BG_KEY,
    SCHOOL_ACCENT_KEY,
    THEME_KEY,
    applyAccent,
    applyBackground,
    applyTheme,
    readSettings,
} from "../shared/settings";
import { mountTodo } from "./todo/mount";

declare global {
    interface Window {
        __betterLmsInjected?: boolean;
    }
}

if (!window.__betterLmsInjected) {
    window.__betterLmsInjected = true;
    initPage();
    mountTodo();
}

async function initPage(): Promise<void> {
    const stored = await readSettings();
    applyBackground(stored[BG_KEY]);
    applyAccent(stored[SCHOOL_ACCENT_KEY] !== false, stored[ACCENT_KEY]);
    applyTheme(stored[THEME_KEY]);

    // Live-update any open Canvas tab when the popup saves a change.
    chrome.storage.onChanged.addListener(async (changes, area) => {
        if (area !== "local") return;

        if (changes[BG_KEY]) {
            applyBackground(changes[BG_KEY].newValue as string | undefined);
        }
        if (changes[THEME_KEY]) {
            applyTheme(changes[THEME_KEY].newValue);
        }
        if (changes[SCHOOL_ACCENT_KEY] || changes[ACCENT_KEY]) {
            // Re-read both, since only one of the two may have changed.
            const current = await readSettings();
            applyAccent(current[SCHOOL_ACCENT_KEY] !== false, current[ACCENT_KEY]);
        }
    });
}
