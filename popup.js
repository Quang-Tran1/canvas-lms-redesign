/*
 * This file runs in two different contexts:
 *   1. As the popup page (chrome-extension:// ...) -> runs initPopup()
 *   2. As a content script on an enabled Canvas site -> runs initPage()
 * The protocol check below decides which one.
 *
 * Both injections share one isolated world per frame, and Chrome injects this
 * file twice whenever a page that already has the content script gets
 * executeScript'd again -- re-enabling a site without reloading, for one. Two
 * evaluations of top-level const declarations is a SyntaxError thrown before
 * any statement runs, so no runtime guard can catch it; the IIFE below is what
 * keeps the declarations out of the shared scope, and the sentinel stops the
 * second copy from initializing over the first.
 */

(() => {
    if (window.__betterLmsInjected) return;
    window.__betterLmsInjected = true;

    const SITES_KEY = "enabledSites";      // array of match patterns, e.g. "https://canvas.school.edu/*"
    const BG_KEY = "backgroundImage";      // string, the user's background image as a data: URL
    const SCHOOL_ACCENT_KEY = "useSchoolAccent";  // boolean, defaults to true
    const ACCENT_KEY = "accentColor";      // string, "#rrggbb"
    const THEME_KEY = "colorScheme";       // one of THEMES; light when unset
    const THEMES = ["light", "hybrid", "dark"];
    const DEFAULT_THEME = "light";
    const SCRIPT_ID = "canvas-redesign-sites";
    const BG_STYLE_ID = "canvas-redesign-bg";
    const DEFAULT_ACCENT = "#b33d3e";

    /* chrome.storage.local gives us 10 MB, and base64 makes the stored copy about a
       third bigger than the file on disk. Capping the file at 4 MB keeps a saved
       image well inside the quota without needing the unlimitedStorage permission. */
    const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

    if (location.protocol === "chrome-extension:") {
        initPopup();
    } else {
        initPage();
    }

    /* ---------------------------------------------------------------- page side */

    /* Paints the wallpaper by injecting a <style> element rather than by setting a
       CSS variable. Chrome silently discards any custom property value longer than
       2 MiB, and a base64 image passes that easily -- setProperty reports no error,
       the declaration simply never lands, and styles.css quietly falls back to its
       default image. background-image declared directly has no such limit.

       The element lives in <head> (or <html> before <head> exists at
       document_start), so Canvas re-rendering <body> can't wipe it out. */
    function applyBackground(url) {
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
    function applyAccent(useSchoolAccent, color) {
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
    function applyTheme(theme) {
        const root = document.documentElement;
        if (!root) return;

        root.setAttribute("data-theme", THEMES.includes(theme) ? theme : DEFAULT_THEME);
    }

    async function initPage() {
        const stored = await chrome.storage.local.get([BG_KEY, SCHOOL_ACCENT_KEY, ACCENT_KEY, THEME_KEY]);
        applyBackground(stored[BG_KEY]);
        applyAccent(stored[SCHOOL_ACCENT_KEY] !== false, stored[ACCENT_KEY]);
        applyTheme(stored[THEME_KEY]);

        // Live-update any open Canvas tab when the popup saves a change.
        chrome.storage.onChanged.addListener(async (changes, area) => {
            if (area !== "local") return;

            if (changes[BG_KEY]) {
                applyBackground(changes[BG_KEY].newValue);
            }
            if (changes[THEME_KEY]) {
                applyTheme(changes[THEME_KEY].newValue);
            }
            if (changes[SCHOOL_ACCENT_KEY] || changes[ACCENT_KEY]) {
                // Re-read both, since only one of the two may have changed.
                const current = await chrome.storage.local.get([SCHOOL_ACCENT_KEY, ACCENT_KEY]);
                applyAccent(current[SCHOOL_ACCENT_KEY] !== false, current[ACCENT_KEY]);
            }
        });
    }

    function isHexColor(value) {
        return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
    }

    /* --------------------------------------------------------------- popup side */

    async function initPopup() {
        const enableButton = document.getElementById("enable-site");
        const siteStatus = document.getElementById("site-status");
        const fileInput = document.getElementById("bg-file");
        const chooseButton = document.getElementById("choose-bg");
        const resetButton = document.getElementById("reset-bg");
        const bgStatus = document.getElementById("bg-status");
        const bgPreview = document.getElementById("bg-preview");
        const themeRadios = [...document.querySelectorAll('input[name="theme"]')];
        const schoolAccentBox = document.getElementById("use-school-accent");
        const accentPicker = document.getElementById("accent-color");
        const accentValue = document.getElementById("accent-value");

        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const url = tab && tab.url ? new URL(tab.url) : null;
        const isWebPage = url && (url.protocol === "http:" || url.protocol === "https:");
        const pattern = isWebPage ? `${url.origin}/*` : null;

        // Fill the controls in from storage.
        const stored = await chrome.storage.local.get([BG_KEY, SITES_KEY, SCHOOL_ACCENT_KEY, ACCENT_KEY, THEME_KEY]);
        showPreview(stored[BG_KEY]);
        const theme = THEMES.includes(stored[THEME_KEY]) ? stored[THEME_KEY] : DEFAULT_THEME;
        themeRadios.forEach((radio) => { radio.checked = radio.value === theme; });
        applyTheme(theme);               // the popup wears the same theme it sets
        schoolAccentBox.checked = stored[SCHOOL_ACCENT_KEY] !== false;   // default: on
        accentPicker.value = isHexColor(stored[ACCENT_KEY]) ? stored[ACCENT_KEY] : DEFAULT_ACCENT;
        syncAccentControls();

        /* The picker is only meaningful when the school's own color isn't in use. */
        function syncAccentControls() {
            accentPicker.disabled = schoolAccentBox.checked;
            accentValue.textContent = schoolAccentBox.checked ? "school color" : accentPicker.value;
        }

        const builtIn = isWebPage && isBuiltInSite(url.hostname);
        let enabled = builtIn || (isWebPage && (await registeredPatterns()).includes(pattern));
        renderSite();

        /* Enabled sites get an outline button that turns the styling back off.
           Built-in ones can't be turned off from here -- their content script comes
           from the manifest, and nothing at runtime can withdraw that. */
        function renderSite(message) {
            enableButton.classList.toggle("secondary", enabled && !builtIn);
            enableButton.disabled = !isWebPage || builtIn;

            if (!isWebPage) {
                enableButton.textContent = "Enable on this site";
                siteStatus.textContent = message ?? "Not a website.";
                return;
            }
            if (builtIn) {
                enableButton.textContent = "Enabled (built in)";
                siteStatus.textContent = message ?? url.hostname;
                return;
            }
            enableButton.textContent = enabled ? "Disable on this site" : "Enable on this site";
            siteStatus.textContent = message ?? (enabled ? url.hostname : "");
        }

        enableButton.addEventListener("click", async () => {
            siteStatus.classList.remove("error");
            siteStatus.textContent = "";
            enableButton.disabled = true;        // no second click while this runs

            let message;
            try {
                // No await before the branch: chrome.permissions.request inside
                // enableSite() only prompts while the user gesture is still live.
                message = enabled ? await disableSite() : await enableSite();
            } finally {
                renderSite(message);
            }
        });

        async function enableSite() {
            const granted = await chrome.permissions.request({ origins: [pattern] });
            if (!granted) {
                siteStatus.classList.add("error");
                return "Permission denied.";
            }

            const current = (await chrome.storage.local.get(SITES_KEY))[SITES_KEY] || [];
            const sites = current.includes(pattern) ? current : [...current, pattern];
            await chrome.storage.local.set({ [SITES_KEY]: sites });

            // Keeps the styling applied on every future visit to this site.
            await registerSites(sites);

            // ...and apply it to the tab that's already open, without a reload.
            await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["styles.css"] });
            await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["popup.js"] });

            enabled = true;
        }

        async function disableSite() {
            const current = (await chrome.storage.local.get(SITES_KEY))[SITES_KEY] || [];
            await chrome.storage.local.set({ [SITES_KEY]: current.filter((p) => p !== pattern) });
            await registerSites(current.filter((p) => p !== pattern));

            // Hand the host permission back rather than sit on access we no longer
            // use. Re-enabling prompts for it again, which is the honest trade.
            await chrome.permissions.remove({ origins: [pattern] });

            // Best effort at clearing the open tab: this only reaches CSS that was
            // inserted with insertCSS, so a page styled by the registered content
            // script keeps its look until it reloads.
            try {
                await chrome.scripting.removeCSS({ target: { tabId: tab.id }, files: ["styles.css"] });
            } catch {
                // Nothing of ours to remove in this tab.
            }

            enabled = false;
            return "Disabled. Reload the page to clear it.";
        }

        /* Shows the saved image back to the user, so the popup reflects what's
           actually stored rather than just claiming a save happened. */
        function showPreview(dataUrl) {
            if (dataUrl) {
                bgPreview.src = dataUrl;
                bgPreview.hidden = false;
            } else {
                bgPreview.removeAttribute("src");
                bgPreview.hidden = true;
            }
        }

        /* Clearing the input's value on failure means picking the same file again
           still fires "change" -- the event only fires when the value differs. */
        function failBackground(message) {
            bgStatus.classList.add("error");
            bgStatus.textContent = message;
            fileInput.value = "";
        }

        // The real <input type="file"> is visually hidden so the picker can use the
        // same button styling as everything else in the popup.
        chooseButton.addEventListener("click", () => fileInput.click());

        fileInput.addEventListener("change", async () => {
            const file = fileInput.files[0];
            if (!file) return;                        // picker was cancelled

            bgStatus.classList.remove("error");

            if (!file.type.startsWith("image/")) {
                failBackground("That file isn't an image.");
                return;
            }
            if (file.size > MAX_IMAGE_BYTES) {
                failBackground(`That image is ${formatSize(file.size)}. The limit is ${formatSize(MAX_IMAGE_BYTES)}.`);
                return;
            }

            bgStatus.textContent = "Reading image…";

            let dataUrl;
            try {
                dataUrl = await readAsDataUrl(file);
            } catch {
                failBackground("Couldn't read that file.");
                return;
            }

            // A HEIC file passes the type check above and stores without complaint,
            // but Chrome can't decode it, so the background silently never paints.
            // Only an actual decode tells us whether this image will render.
            if (!(await canDecode(dataUrl))) {
                failBackground(/heic|heif/i.test(file.type)
                    ? "Chrome can't display HEIC photos. Export it as a JPEG first."
                    : "Chrome can't display that image format.");
                return;
            }

            try {
                await chrome.storage.local.set({ [BG_KEY]: dataUrl });
            } catch {
                // In practice this is always the quota: base64 inflates the file by
                // about a third, so something just under the cap can still overflow.
                failBackground("Not enough room to store that image. Try a smaller one.");
                return;
            }

            showPreview(dataUrl);
            bgStatus.textContent = `Using ${file.name}.`;
            fileInput.value = "";
        });

        themeRadios.forEach((radio) => {
            radio.addEventListener("change", async () => {
                // "change" also fires on the radio being cleared in some engines.
                if (!radio.checked) return;
                applyTheme(radio.value);     // repaint the popup without waiting on storage
                await chrome.storage.local.set({ [THEME_KEY]: radio.value });
            });
        });

        schoolAccentBox.addEventListener("change", async () => {
            syncAccentControls();

            // Turning the box off with no color ever picked would otherwise leave
            // ACCENT_KEY unset, and the page would keep the school color -- even
            // though the picker is showing one. Save what it's showing.
            const update = { [SCHOOL_ACCENT_KEY]: schoolAccentBox.checked };
            if (!schoolAccentBox.checked) {
                update[ACCENT_KEY] = accentPicker.value;
            }
            await chrome.storage.local.set(update);
        });

        // "input" fires while dragging in the picker, so open tabs preview live.
        accentPicker.addEventListener("input", async () => {
            accentValue.textContent = accentPicker.value;
            await chrome.storage.local.set({ [ACCENT_KEY]: accentPicker.value });
        });

        resetButton.addEventListener("click", async () => {
            await chrome.storage.local.remove(BG_KEY);
            showPreview(null);
            fileInput.value = "";
            bgStatus.classList.remove("error");
            bgStatus.textContent = "Back to the default background.";
        });
    }

    /* Resolves false if Chrome can't render the image -- the same decode the CSS
       background will attempt, so it can't disagree with what the page does. */
    function canDecode(dataUrl) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve(true);
            img.onerror = () => resolve(false);
            img.src = dataUrl;
        });
    }

    function readAsDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
        });
    }

    function formatSize(bytes) {
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    /* True if styles.css already applies here: either the built-in instructure.com
       rule in manifest.json, or a site the user enabled earlier. */
    /* Covered by the static content_scripts entry in manifest.json, so styling is
       always on here and there's nothing to register or unregister. */
    function isBuiltInSite(hostname) {
        return hostname === "instructure.com" || hostname.endsWith(".instructure.com");
    }

    /* Which patterns are actually live, asked of the scripting API rather than of
       storage. The two drift apart whenever Chrome clears dynamic registrations on
       update, and believing storage is what used to leave the popup reporting a
       site as enabled while nothing was injecting into it. */
    async function registeredPatterns() {
        const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
        return registered.length ? registered[0].matches || [] : [];
    }

    /* Registers (or updates) the one dynamic content script covering every site the
       user has enabled. Survives browser restarts; background.js puts it back after
       an update, which is the one case Chrome does not. */
    async function registerSites(sites) {
        const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });

        // Disabling the last site means unregistering outright -- a content script
        // with an empty matches array is rejected, so this can't go through update.
        if (!sites.length) {
            if (registered.length) {
                await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
            }
            return;
        }

        const script = {
            id: SCRIPT_ID,
            matches: sites,
            css: ["styles.css"],
            js: ["popup.js"],
            runAt: "document_start",
            persistAcrossSessions: true,
        };

        if (registered.length) {
            await chrome.scripting.updateContentScripts([script]);
        } else {
            await chrome.scripting.registerContentScripts([script]);
        }
    }
})();
