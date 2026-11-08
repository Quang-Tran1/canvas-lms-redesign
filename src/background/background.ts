/*
 * Chrome clears dynamically registered content scripts on every extension
 * update -- persistAcrossSessions covers browser restarts, not updates, because
 * a registration points at files that an update is allowed to change. Nothing
 * else in the extension re-registers them, so without this the theming silently
 * stops applying to every custom school domain the moment a new version ships.
 */

import { enabledSites, registerSites } from "../shared/sites";
import { DEFAULT_PRESET, applyPreset } from "../shared/themePresets";

// A fresh install starts on the default theme. Only on "install": an update
// must keep whatever the user has set up since.
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
    if (reason !== chrome.runtime.OnInstalledReason.INSTALL) return;
    try {
        await applyPreset(DEFAULT_PRESET);
    } catch (cause) {
        // Canvas just keeps its stock look until the user picks a theme.
        console.warn("[BetterLMS] could not apply the default theme:", cause);
    }
});

// Fires on install and on update, which is exactly when registrations are gone.
chrome.runtime.onInstalled.addListener(async () => {
    const sites = await enabledSites();
    if (!sites.length) return;

    // One pattern we no longer hold permission for would reject the whole call,
    // so drop any the user has revoked since enabling it.
    const granted: string[] = [];
    for (const pattern of sites) {
        if (await chrome.permissions.contains({ origins: [pattern] })) {
            granted.push(pattern);
        }
    }
    if (!granted.length) return;

    await registerSites(granted);
});
