import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.config.ts";

export default defineConfig({
    plugins: [
        preact(),
        crx({
            manifest,
            contentScripts: {
                // Build the content script as one self-contained file instead of
                // CRXJS's default loader + dynamic import. The loader only works
                // on origins listed in web_accessible_resources, which can't
                // include the school domains users enable at runtime.
                standaloneFiles: ["src/content/content.ts"],
            },
        }),
    ],
    build: {
        outDir: "dist",
        emptyOutDir: true,
    },
});
