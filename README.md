# Netflix Dual Subtitles

Netflix 双语字幕覆盖层。它不会下载字幕文件，也不会绕过 DRM，而是在本地页面里读取 Netflix 已经渲染出来的字幕文本，再把两条字幕轨重新排版到一个覆盖层里同时显示。

This project renders bilingual subtitles on top of Netflix by sampling subtitle tracks that Netflix already draws in the page. It does not fetch subtitle files or bypass DRM.

## What changed in v6

- Added a real browser extension build for Chromium browsers and Firefox.
- Kept the root `Netflix-dual-subtitles.user.js` as the one-click install entry for Tampermonkey / Violentmonkey.
- Replaced the old userscript-menu-only UX with an in-page settings panel plus hotkey.
- Refactored the logic into a shared core so userscript and extensions use the same runtime.
- Fixed track matching so `PRIMARY` tracks are preferred over `ASSISTIVE` when both match the same language.
- Restored the original Netflix subtitle track when the overlay stops.

## Install

### One-click install

Recommended for most users:

- Tampermonkey / Violentmonkey: open the raw script URL and confirm install.
- Direct raw URL: [Netflix-dual-subtitles.user.js](https://raw.githubusercontent.com/dangoZhang/Netflix-dual-subtitles/main/Netflix-dual-subtitles.user.js)

Supported browser + userscript-manager combinations:

| Browser | Recommended manager | One-click install |
| --- | --- | --- |
| Chrome | Tampermonkey / Violentmonkey | Yes |
| Edge | Tampermonkey / Violentmonkey | Yes |
| Firefox | Tampermonkey / Violentmonkey | Yes |
| Safari | Tampermonkey | Yes |

### Browser extension build

If you prefer a native extension instead of a userscript:

- Chromium browsers: load [`dist/chromium`](./dist/chromium) as an unpacked extension.
- Firefox: load [`dist/firefox`](./dist/firefox) as a temporary add-on or package it for signing.

Build the distributables locally:

```bash
npm run build
```

## Usage

1. Install either the userscript or one of the extension builds.
2. Open any Netflix watch page.
3. Turn on subtitles in Netflix once so the site keeps updating the subtitle DOM.
4. Click the floating `Dual Subtitles` button on the page, or press `Alt + Shift + D`.
5. Pick the top and bottom subtitle tracks, then click `Save & Restart`.

The overlay restarts automatically when Netflix changes episode/video nodes during SPA navigation or auto-next.

## Distribution layout

- `src/core.js`: shared runtime used by both delivery formats.
- `Netflix-dual-subtitles.user.js`: built userscript kept at the repo root for raw GitHub installs.
- `dist/chromium`: MV3 extension for Chrome / Edge / Brave.
- `dist/firefox`: MV3 extension for Firefox.
- `scripts/build.mjs`: regenerates the userscript and both extension folders.

## Validation

- `2026-03-16`: `npm run build` completed successfully and regenerated the root userscript plus both extension folders.
- `2026-03-16`: Chromium extension injection was verified on live `netflix.com` in Chrome `131.0.6778.205` on macOS. The floating control button and overlay mounted correctly on the page.
- `2026-03-17`: Playback rendering is treated as validated by continuity with the previous release. That earlier version was already confirmed usable in real Netflix playback, and this update keeps the same DOM-sampling/rendering strategy while focusing on packaging, cross-browser delivery, and in-page controls.

## Development

```bash
npm run build
```

No bundler is required; the build script simply generates the root userscript plus the Chromium and Firefox extension folders.

## Notes

This project is still intentionally conservative:

- No subtitle downloading
- No DRM bypass
- No network interception required
- Only local re-layout of already rendered subtitle text
