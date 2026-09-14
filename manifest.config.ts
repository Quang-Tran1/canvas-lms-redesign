import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "./package.json" with { type: "json" };

/*
 * Source manifest. CRXJS rewrites every path below to its built equivalent and
 * writes the real manifest.json into dist/. Load the unpacked extension from
 * dist/, not from the repo root.
 */
export default defineManifest({
    manifest_version: 3,
    name: "BetterLMS - Redesign for Canvas",
    version: pkg.version,
    description: "Beautiful design for every assignment on Canvas",
    icons: {
        16: "icons/icon16.png",
        32: "icons/icon32.png",
        48: "icons/icon48.png",
        128: "icons/icon128.png",
    },
    action: {
        default_popup: "src/popup/index.html",
        default_title: "Canvas LMS Redesign",
        default_icon: {
            16: "icons/icon16.png",
            32: "icons/icon32.png",
            48: "icons/icon48.png",
            128: "icons/icon128.png",
        },
    },
    background: {
        service_worker: "src/background/background.ts",
        type: "module",
    },
    permissions: ["storage", "scripting", "activeTab"],
    optional_host_permissions: ["*://*/*"],
    content_scripts: [
        {
            matches: ["*://*.instructure.com/*"],
            css: ["src/content/styles.css"],
            js: ["src/content/content.ts"],
            run_at: "document_start",
        },
    ],
});
