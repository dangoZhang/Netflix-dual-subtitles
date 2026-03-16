import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const distRoot = join(root, 'dist');
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const version = packageJson.version;

const coreSource = readFileSync(join(root, 'src', 'core.js'), 'utf8').trim();
const extensionBridge = readFileSync(
  join(root, 'src', 'extension', 'content-script.js'),
  'utf8'
).trim();
const popupHtml = readFileSync(join(root, 'src', 'extension', 'popup.html'), 'utf8').replaceAll(
  '__VERSION__',
  version
);

rmSync(distRoot, { force: true, recursive: true });
mkdirSync(join(distRoot, 'chromium'), { recursive: true });
mkdirSync(join(distRoot, 'firefox'), { recursive: true });

const userscript = `// ==UserScript==
// @name         Netflix Dual Subtitles
// @namespace    https://github.com/dangoZhang/Netflix-dual-subtitles
// @version      ${version}
// @description  Bilingual subtitle overlay for Netflix. Supports Tampermonkey and Violentmonkey on Chrome, Edge, Firefox, and Safari.
// @author       dangoZhang
// @match        https://www.netflix.com/*
// @run-at       document-start
// @grant        unsafeWindow
// @homepageURL  https://github.com/dangoZhang/Netflix-dual-subtitles
// @supportURL   https://github.com/dangoZhang/Netflix-dual-subtitles/issues
// @downloadURL  https://raw.githubusercontent.com/dangoZhang/Netflix-dual-subtitles/main/Netflix-dual-subtitles.user.js
// @updateURL    https://raw.githubusercontent.com/dangoZhang/Netflix-dual-subtitles/main/Netflix-dual-subtitles.user.js
// ==/UserScript==

(() => {
  const pageWindow =
    typeof unsafeWindow !== 'undefined'
      ? unsafeWindow
      : typeof window.wrappedJSObject !== 'undefined'
        ? window.wrappedJSObject
        : window;

${coreSource}

  bootNetflixDualSubtitles(pageWindow, {
    platform: 'userscript',
    version: '${version}',
  });
})();
`;

const injectedScript = `(() => {
${coreSource}

  bootNetflixDualSubtitles(window, {
    platform: 'extension',
    version: '${version}',
  });
})();
`;

const chromiumManifest = {
  manifest_version: 3,
  name: 'Netflix Dual Subtitles',
  version,
  description:
    'Render bilingual subtitles on Netflix by sampling subtitle tracks already rendered by Netflix.',
  action: {
    default_title: 'Netflix Dual Subtitles',
    default_popup: 'popup.html',
  },
  content_scripts: [
    {
      matches: ['https://www.netflix.com/*'],
      js: ['content-script.js'],
      run_at: 'document_start',
    },
  ],
  web_accessible_resources: [
    {
      resources: ['injected.js'],
      matches: ['https://www.netflix.com/*'],
    },
  ],
};

const firefoxManifest = {
  ...chromiumManifest,
  browser_specific_settings: {
    gecko: {
      id: 'netflix-dual-subtitles@dangozhang.github.io',
      strict_min_version: '128.0',
    },
  },
};

writeFileSync(join(root, 'Netflix-dual-subtitles.user.js'), userscript);
writeFileSync(join(distRoot, 'chromium', 'content-script.js'), extensionBridge + '\n');
writeFileSync(join(distRoot, 'chromium', 'injected.js'), injectedScript);
writeFileSync(join(distRoot, 'chromium', 'popup.html'), popupHtml);
writeFileSync(
  join(distRoot, 'chromium', 'manifest.json'),
  JSON.stringify(chromiumManifest, null, 2) + '\n'
);

writeFileSync(join(distRoot, 'firefox', 'content-script.js'), extensionBridge + '\n');
writeFileSync(join(distRoot, 'firefox', 'injected.js'), injectedScript);
writeFileSync(join(distRoot, 'firefox', 'popup.html'), popupHtml);
writeFileSync(
  join(distRoot, 'firefox', 'manifest.json'),
  JSON.stringify(firefoxManifest, null, 2) + '\n'
);

console.log(`Built Netflix Dual Subtitles v${version}`);
