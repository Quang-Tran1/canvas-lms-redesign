# BetterLMS - Redesign for Canvas

Chrome extension that restyles Canvas LMS. Built with Vite, CRXJS and Preact.

## Develop

```bash
npm install
npm run build
```

Then load the unpacked extension from the `dist/` folder at `chrome://extensions`.
Run `npm run build` again after changes and click reload on the extension.
`npm run dev` starts Vite with CRXJS hot reload instead; load `dist/` the same way.

`npm run typecheck` runs the TypeScript compiler without emitting.

## Layout

- `manifest.config.ts` is the source manifest. CRXJS writes the real `manifest.json` into `dist/`.
- `src/content/` is the content script and the Canvas stylesheet.
- `src/popup/` is the toolbar popup, a Preact component.
- `src/background/` is the service worker.
- `src/shared/` holds settings and site-registration code used by more than one entry.

The version in `package.json` is the extension version.
