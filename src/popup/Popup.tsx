import { useEffect, useRef, useState } from "preact/hooks";
import iconUrl from "../../icons/icon32.png";
import {
    ACCENT_KEY,
    BG_KEY,
    DEFAULT_ACCENT,
    DEFAULT_THEME,
    MAX_IMAGE_BYTES,
    SCHOOL_ACCENT_KEY,
    THEME_KEY,
    THEMES,
    type Theme,
    applyTheme,
    isHexColor,
    isTheme,
    readSettings,
} from "../shared/settings";
import {
    contentScriptFiles,
    enabledSites,
    isBuiltInSite,
    registerSites,
    registeredPatterns,
    saveEnabledSites,
} from "../shared/sites";

interface Site {
    tabId: number;
    hostname: string;
    pattern: string;       // "https://canvas.school.edu/*"
    builtIn: boolean;      // covered by the manifest's static content script
}

interface Status {
    text: string;
    error?: boolean;
}

export function Popup() {
    // null until the active tab is known; stays null on non-web pages.
    const [site, setSite] = useState<Site | null>(null);
    const [enabled, setEnabled] = useState(false);
    const [siteBusy, setSiteBusy] = useState(false);
    const [siteStatus, setSiteStatus] = useState<Status | null>(null);

    const [bgPreview, setBgPreview] = useState<string | null>(null);
    const [bgStatus, setBgStatus] = useState<Status | null>(null);
    const fileInput = useRef<HTMLInputElement>(null);

    const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);
    const [useSchoolAccent, setUseSchoolAccent] = useState(true);
    const [accent, setAccent] = useState(DEFAULT_ACCENT);

    // Fill the controls in from storage and work out which site we're on.
    useEffect(() => {
        (async () => {
            const stored = await readSettings();
            setBgPreview(stored[BG_KEY] || null);
            setTheme(isTheme(stored[THEME_KEY]) ? stored[THEME_KEY] : DEFAULT_THEME);
            setUseSchoolAccent(stored[SCHOOL_ACCENT_KEY] !== false);   // default: on
            setAccent(isHexColor(stored[ACCENT_KEY]) ? stored[ACCENT_KEY] : DEFAULT_ACCENT);

            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            const url = tab && tab.url ? new URL(tab.url) : null;
            const isWebPage = !!url && (url.protocol === "http:" || url.protocol === "https:");
            if (!url || !isWebPage || tab.id === undefined) return;

            const builtIn = isBuiltInSite(url.hostname);
            setSite({ tabId: tab.id, hostname: url.hostname, pattern: `${url.origin}/*`, builtIn });
            setEnabled(builtIn || (await registeredPatterns()).includes(`${url.origin}/*`));
        })();
    }, []);

    // The popup wears the same theme it sets.
    useEffect(() => { applyTheme(theme); }, [theme]);

    /* ------------------------------------------------------------ site */

    // Enabled sites get an outline button that turns the styling back off.
    // Built-in ones can't be turned off from here -- their content script comes
    // from the manifest, and nothing at runtime can withdraw that.
    let siteLabel = "Enable on this site";
    let siteText = siteStatus?.text ?? "";
    if (!site) {
        siteText = siteStatus?.text ?? "Not a website.";
    } else if (site.builtIn) {
        siteLabel = "Enabled (built in)";
        siteText = siteStatus?.text ?? site.hostname;
    } else if (enabled) {
        siteLabel = "Disable on this site";
        siteText = siteStatus?.text ?? site.hostname;
    }

    async function onToggleSite() {
        if (!site) return;
        setSiteStatus(null);
        setSiteBusy(true);          // no second click while this runs
        try {
            // No await before the branch: chrome.permissions.request inside
            // enableSite() only prompts while the user gesture is still live.
            if (enabled) await disableSite(site); else await enableSite(site);
        } finally {
            setSiteBusy(false);
        }
    }

    async function enableSite(site: Site) {
        const granted = await chrome.permissions.request({ origins: [site.pattern] });
        if (!granted) {
            setSiteStatus({ text: "Permission denied.", error: true });
            return;
        }

        const current = await enabledSites();
        const sites = current.includes(site.pattern) ? current : [...current, site.pattern];
        await saveEnabledSites(sites);

        // Keeps the styling applied on every future visit to this site.
        await registerSites(sites);

        // ...and apply it to the tab that's already open, without a reload.
        const { js, css } = contentScriptFiles();
        await chrome.scripting.insertCSS({ target: { tabId: site.tabId }, files: css });
        await chrome.scripting.executeScript({ target: { tabId: site.tabId }, files: js });

        setEnabled(true);
        setSiteStatus(null);
    }

    async function disableSite(site: Site) {
        const remaining = (await enabledSites()).filter((p) => p !== site.pattern);
        await saveEnabledSites(remaining);
        await registerSites(remaining);

        // Hand the host permission back rather than sit on access we no longer
        // use. Re-enabling prompts for it again, which is the honest trade.
        await chrome.permissions.remove({ origins: [site.pattern] });

        // Best effort at clearing the open tab: this only reaches CSS that was
        // inserted with insertCSS, so a page styled by the registered content
        // script keeps its look until it reloads.
        try {
            await chrome.scripting.removeCSS({ target: { tabId: site.tabId }, files: contentScriptFiles().css });
        } catch {
            // Nothing of ours to remove in this tab.
        }

        setEnabled(false);
        setSiteStatus({ text: "Disabled. Reload the page to clear it." });
    }

    /* ------------------------------------------------------ background */

    /* Clearing the input's value on failure means picking the same file again
       still fires "change" -- the event only fires when the value differs. */
    function failBackground(text: string) {
        setBgStatus({ text, error: true });
        if (fileInput.current) fileInput.current.value = "";
    }

    async function onPickBackground() {
        const input = fileInput.current;
        const file = input?.files?.[0];
        if (!input || !file) return;                    // picker was cancelled

        if (!file.type.startsWith("image/")) {
            failBackground("That file isn't an image.");
            return;
        }
        if (file.size > MAX_IMAGE_BYTES) {
            failBackground(`That image is ${formatSize(file.size)}. The limit is ${formatSize(MAX_IMAGE_BYTES)}.`);
            return;
        }

        setBgStatus({ text: "Reading image…" });

        let dataUrl: string;
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

        setBgPreview(dataUrl);
        setBgStatus({ text: `Using ${file.name}.` });
        input.value = "";
    }

    async function onResetBackground() {
        await chrome.storage.local.remove(BG_KEY);
        setBgPreview(null);
        if (fileInput.current) fileInput.current.value = "";
        setBgStatus({ text: "Back to the default background." });
    }

    /* ----------------------------------------------------------- theme */

    async function onTheme(next: Theme) {
        setTheme(next);                 // repaint the popup without waiting on storage
        await chrome.storage.local.set({ [THEME_KEY]: next });
    }

    async function onSchoolAccent(checked: boolean) {
        setUseSchoolAccent(checked);

        // Turning the box off with no color ever picked would otherwise leave
        // ACCENT_KEY unset, and the page would keep the school color -- even
        // though the picker is showing one. Save what it's showing.
        const update: Record<string, unknown> = { [SCHOOL_ACCENT_KEY]: checked };
        if (!checked) update[ACCENT_KEY] = accent;
        await chrome.storage.local.set(update);
    }

    // "input" fires while dragging in the picker, so open tabs preview live.
    async function onAccent(color: string) {
        setAccent(color);
        await chrome.storage.local.set({ [ACCENT_KEY]: color });
    }

    /* ---------------------------------------------------------- render */

    return (
        <>
            <h1><img class="logo" src={iconUrl} alt="" width="20" height="20" />Canvas Redesign</h1>

            <button
                id="enable-site"
                type="button"
                class={enabled && site && !site.builtIn ? "secondary" : ""}
                disabled={!site || site.builtIn || siteBusy}
                onClick={onToggleSite}
            >
                {siteLabel}
            </button>
            <p id="site-status" class={`status${siteStatus?.error ? " error" : ""}`}>{siteText}</p>

            <label class="field-label" for="bg-file">Background image</label>
            {/* Deliberately not image/*: that offers HEIC files the browser can't render. */}
            <input
                id="bg-file"
                ref={fileInput}
                class="visually-hidden"
                type="file"
                accept="image/jpeg, image/png, image/webp, image/gif, image/avif"
                onChange={onPickBackground}
            />
            <div class="row">
                {/* The real file input is visually hidden so the picker can use the
                    same button styling as everything else in the popup. */}
                <button type="button" class="secondary" onClick={() => fileInput.current?.click()}>Choose image…</button>
                <button type="button" class="secondary" onClick={onResetBackground}>Reset</button>
            </div>
            {bgPreview && <img id="bg-preview" class="preview" src={bgPreview} alt="Current background" />}
            <p id="bg-status" class={`status${bgStatus?.error ? " error" : ""}`}>{bgStatus?.text ?? ""}</p>

            <fieldset class="theme-row">
                <legend class="visually-hidden">Theme</legend>
                {THEMES.map((value) => (
                    <label class="theme-option" key={value}>
                        <span>{THEME_LABELS[value]}</span>
                        <input
                            type="radio"
                            name="theme"
                            value={value}
                            checked={theme === value}
                            onChange={() => onTheme(value)}
                        />
                    </label>
                ))}
            </fieldset>

            <label class="checkbox-row" for="use-school-accent">
                <input
                    id="use-school-accent"
                    type="checkbox"
                    checked={useSchoolAccent}
                    onChange={(e) => onSchoolAccent(e.currentTarget.checked)}
                />
                <span>Use school accent colors</span>
            </label>

            <label class="field-label" for="accent-color">Accent color</label>
            <div class="row">
                {/* The picker is only meaningful when the school's own color isn't in use. */}
                <input
                    id="accent-color"
                    type="color"
                    value={accent}
                    disabled={useSchoolAccent}
                    onInput={(e) => onAccent(e.currentTarget.value)}
                />
                <output id="accent-value" for="accent-color">{useSchoolAccent ? "school color" : accent}</output>
            </div>
        </>
    );
}

const THEME_LABELS: Record<Theme, string> = { light: "Light", hybrid: "Hybrid", dark: "Dark" };

/* Resolves false if Chrome can't render the image -- the same decode the CSS
   background will attempt, so it can't disagree with what the page does. */
function canDecode(dataUrl: string): Promise<boolean> {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        img.src = dataUrl;
    });
}

function readAsDataUrl(file: File): Promise<string> {
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
