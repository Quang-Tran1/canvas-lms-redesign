/*
 * Ready-made themes: a wallpaper bundled with the extension, plus the color
 * scheme and accent color that go with it.
 *
 * Applying one copies its wallpaper into BG_KEY as a data: URL, exactly as if
 * the user had uploaded it, so the content script needs nothing new. Serving
 * the files to Canvas pages directly would need web_accessible_resources,
 * which can't list the school domains users enable at runtime (see
 * vite.config.ts). The wallpapers are a few hundred KB, so the copy is cheap.
 *
 * Shared by the popup (the Themes grid) and the background script (the
 * default theme on install).
 */

import {
    ACCENT_KEY,
    BG_KEY,
    SCHOOL_ACCENT_KEY,
    THEME_KEY,
    THEME_PRESET_KEY,
    type Theme,
} from "./settings";
import mountains from "../assets/themes/mountains.webp";
import mountainsThumb from "../assets/themes/mountains-thumb.webp";
import forest from "../assets/themes/forest.webp";
import forestThumb from "../assets/themes/forest-thumb.webp";
import jellyfish from "../assets/themes/jellyfish.webp";
import jellyfishThumb from "../assets/themes/jellyfish-thumb.webp";
import bridge from "../assets/themes/bridge.webp";
import bridgeThumb from "../assets/themes/bridge-thumb.webp";
import cosmos from "../assets/themes/cosmos.webp";
import cosmosThumb from "../assets/themes/cosmos-thumb.webp";

export interface ThemePreset {
    id: string;
    name: string;
    image: string;       // URL of the bundled wallpaper
    thumb: string;       // URL of its 240x150 thumbnail
    theme: Theme;
    accent: string;      // "#rrggbb"
}

export const THEME_PRESETS: readonly ThemePreset[] = [
    { id: "mountains", name: "Mountains", image: mountains, thumb: mountainsThumb, theme: "light", accent: "#12a4e0" },
    { id: "forest", name: "Forest", image: forest, thumb: forestThumb, theme: "dark", accent: "#acff80" },
    { id: "jellyfish", name: "Jellyfish", image: jellyfish, thumb: jellyfishThumb, theme: "dark", accent: "#4dd2ff" },
    { id: "bridge", name: "Golden Gate", image: bridge, thumb: bridgeThumb, theme: "light", accent: "#ff6714" },
    { id: "cosmos", name: "Cosmos", image: cosmos, thumb: cosmosThumb, theme: "light", accent: "#ff33be" },
];

/* What a fresh install starts with. */
export const DEFAULT_PRESET = THEME_PRESETS[0];

export function findPreset(id: unknown): ThemePreset | undefined {
    return THEME_PRESETS.find((preset) => preset.id === id);
}

/* Saves every setting the preset covers in one write, so open Canvas tabs
   switch wallpaper, scheme and accent together. Resolves to the wallpaper's
   data: URL, for the popup's preview. */
export async function applyPreset(preset: ThemePreset): Promise<string> {
    const dataUrl = await toDataUrl(preset.image);
    await chrome.storage.local.set({
        [BG_KEY]: dataUrl,
        [THEME_KEY]: preset.theme,
        [SCHOOL_ACCENT_KEY]: false,
        [ACCENT_KEY]: preset.accent,
        [THEME_PRESET_KEY]: preset.id,
    });
    return dataUrl;
}

/* FileReader would do this in the popup, but the background script is a
   service worker, so the bytes are base64-encoded by hand. Chunked because
   String.fromCharCode can't take a few hundred thousand arguments at once. */
async function toDataUrl(url: string): Promise<string> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Couldn't load ${url}: ${response.status}`);
    const blob = await response.blob();
    const bytes = new Uint8Array(await blob.arrayBuffer());

    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return `data:${blob.type || "image/webp"};base64,${btoa(binary)}`;
}
