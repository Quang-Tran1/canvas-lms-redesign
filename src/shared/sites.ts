/*
 * Sites the user has enabled beyond the built-in *.instructure.com match, and
 * the one dynamic content-script registration that covers them all.
 *
 * Shared by the popup (enable / disable) and the background worker (which puts
 * the registration back after an extension update).
 */

export const SITES_KEY = "enabledSites";   // array of match patterns, e.g. "https://canvas.school.edu/*"
export const SCRIPT_ID = "canvas-redesign-sites";

/* Covered by the static content_scripts entry in the manifest, so styling is
   always on here and there's nothing to register or unregister. */
export function isBuiltInSite(hostname: string): boolean {
    return hostname === "instructure.com" || hostname.endsWith(".instructure.com");
}

export async function enabledSites(): Promise<string[]> {
    const stored = await chrome.storage.local.get(SITES_KEY);
    return (stored[SITES_KEY] as string[] | undefined) || [];
}

export function saveEnabledSites(sites: string[]): Promise<void> {
    return chrome.storage.local.set({ [SITES_KEY]: sites });
}

/* The built file names of the content script and its stylesheet. Vite gives
   them hashed names, so they're read from the built manifest rather than
   hardcoded -- the static content_scripts entry always lists the same files
   the dynamic registration needs. */
export function contentScriptFiles(): { js: string[]; css: string[] } {
    const entry = chrome.runtime.getManifest().content_scripts?.[0];
    return { js: entry?.js || [], css: entry?.css || [] };
}

function siteScript(matches: string[]): chrome.scripting.RegisteredContentScript {
    const { js, css } = contentScriptFiles();
    return {
        id: SCRIPT_ID,
        matches,
        css,
        js,
        runAt: "document_start",
        persistAcrossSessions: true,
    };
}

/* Which patterns are actually live, asked of the scripting API rather than of
   storage. The two drift apart whenever Chrome clears dynamic registrations on
   update, and believing storage is what used to leave the popup reporting a
   site as enabled while nothing was injecting into it. */
export async function registeredPatterns(): Promise<string[]> {
    const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
    return registered.length ? registered[0].matches || [] : [];
}

/* Registers (or updates) the one dynamic content script covering every site the
   user has enabled. Survives browser restarts; the background worker puts it
   back after an update, which is the one case Chrome does not. */
export async function registerSites(sites: string[]): Promise<void> {
    const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });

    // Disabling the last site means unregistering outright -- a content script
    // with an empty matches array is rejected, so this can't go through update.
    if (!sites.length) {
        if (registered.length) {
            await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
        }
        return;
    }

    const script = siteScript(sites);
    if (registered.length) {
        await chrome.scripting.updateContentScripts([script]);
    } else {
        await chrome.scripting.registerContentScripts([script]);
    }
}
