/*
 * Chrome clears dynamically registered content scripts on every extension
 * update -- persistAcrossSessions covers browser restarts, not updates, because
 * a registration points at files that an update is allowed to change. Nothing
 * else in the extension re-registers them, so without this the theming silently
 * stops applying to every custom school domain the moment a new version ships.
 *
 * The constants below are duplicated from popup.js rather than imported: that
 * file dispatches on location.protocol, which is chrome-extension: in a service
 * worker, so loading it here would run initPopup() and die on `document`.
 */

const SITES_KEY = "enabledSites";
const SCRIPT_ID = "canvas-redesign-sites";

function siteScript(matches) {
    return {
        id: SCRIPT_ID,
        matches,
        css: ["styles.css"],
        js: ["popup.js"],
        runAt: "document_start",
        persistAcrossSessions: true,
    };
}

// Fires on install and on update, which is exactly when registrations are gone.
chrome.runtime.onInstalled.addListener(async () => {
    const sites = (await chrome.storage.local.get(SITES_KEY))[SITES_KEY] || [];
    if (!sites.length) return;

    // One pattern we no longer hold permission for would reject the whole call,
    // so drop any the user has revoked since enabling it.
    const granted = [];
    for (const pattern of sites) {
        if (await chrome.permissions.contains({ origins: [pattern] })) {
            granted.push(pattern);
        }
    }
    if (!granted.length) return;

    // Chrome is documented to clear these on update, but check rather than
    // assume -- registering an id that already exists throws.
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
    if (existing.length) {
        await chrome.scripting.updateContentScripts([siteScript(granted)]);
    } else {
        await chrome.scripting.registerContentScripts([siteScript(granted)]);
    }
});
