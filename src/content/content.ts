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
    TODO_KEY,
    DASHBOARD_GRADES_KEY,
    CLASS_RANK_KEY,
    ANIMATION_KEY,
    applyAccent,
    applyAnimation,
    applyBackground,
    applyTheme,
    isEnabled,
    readSettings,
} from "../shared/settings";
import { setDashboardGradesEnabled } from "./grades/mount";
import { setClassRankEnabled } from "./grades/rankMount";
import { setTodoEnabled } from "./todo/mount";

declare global {
    interface Window {
        __betterLmsInjected?: boolean;
    }
}

if (!window.__betterLmsInjected) {
    window.__betterLmsInjected = true;
    initPage();
}

async function initPage(): Promise<void> {
    const stored = await readSettings();
    applyBackground(stored[BG_KEY]);
    applyAccent(isEnabled(stored[SCHOOL_ACCENT_KEY]), stored[ACCENT_KEY]);
    applyTheme(stored[THEME_KEY]);
    applyAnimation(stored[ANIMATION_KEY]);

    // Canvas renders its sidebar long after this, so waiting on the storage
    // read above costs nothing visible.
    setTodoEnabled(isEnabled(stored[TODO_KEY]));
    setDashboardGradesEnabled(isEnabled(stored[DASHBOARD_GRADES_KEY]));
    setClassRankEnabled(isEnabled(stored[CLASS_RANK_KEY]));

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
            applyAccent(isEnabled(current[SCHOOL_ACCENT_KEY]), current[ACCENT_KEY]);
        }
        if (changes[ANIMATION_KEY]) {
            applyAnimation(changes[ANIMATION_KEY].newValue);
        }
        // Each feature mounts or tears itself down in place, no reload needed.
        if (changes[TODO_KEY]) {
            setTodoEnabled(isEnabled(changes[TODO_KEY].newValue));
        }
        if (changes[DASHBOARD_GRADES_KEY]) {
            setDashboardGradesEnabled(isEnabled(changes[DASHBOARD_GRADES_KEY].newValue));
        }
        if (changes[CLASS_RANK_KEY]) {
            setClassRankEnabled(isEnabled(changes[CLASS_RANK_KEY].newValue));
        }
    });
}
