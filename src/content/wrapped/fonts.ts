/*
 * The faces Canvas Wrapped is set in. Canvas ships none of them (its Lato
 * Extended stops at Bold), so they come with the extension.
 *
 * Inlined as data: URLs for the same reason as every other content-script
 * asset (see themePresets.ts), and only the Latin subset of each weight the
 * design uses, about 90 KB in all.
 *
 * Declared on the document rather than in the widget's shadow root: Chrome
 * ignores @font-face inside a shadow root, but shadow content can use faces
 * the document declares. The family names are prefixed so a page that loads
 * its own Inter or Rubik is left alone.
 *
 * @fontsource/inter is pinned to 5.0.16, a release that still carries Inter 3.
 * The design was drawn in Inter 3, and Inter 4 respaced several glyphs ("1"
 * most visibly), which moves every number on the slides by a few pixels.
 */

import interMedium from "@fontsource/inter/files/inter-latin-500-normal.woff2?inline";
import interBlack from "@fontsource/inter/files/inter-latin-900-normal.woff2?inline";
import rubikSemiBold from "@fontsource/rubik/files/rubik-latin-600-normal.woff2?inline";
import latoBlack from "@fontsource/lato/files/lato-latin-900-normal.woff2?inline";
import { injectCss } from "../inject-css";

const STYLE_ID = "blms-wrapped-fonts";

const FACES: [family: string, weight: number, src: string][] = [
    ["BLMS Wrapped Inter", 500, interMedium],
    ["BLMS Wrapped Inter", 900, interBlack],
    ["BLMS Wrapped Rubik", 600, rubikSemiBold],
    ["BLMS Wrapped Lato", 900, latoBlack],
];

export function injectWrappedFonts(): void {
    const css = FACES.map(([family, weight, src]) =>
        `@font-face { font-family: "${family}"; font-style: normal; font-weight: ${weight}; ` +
        `font-display: block; src: url("${src}") format("woff2"); }`,
    ).join("\n");
    injectCss(STYLE_ID, css);
}
