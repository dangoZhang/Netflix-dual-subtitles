(() => {
function bootNetflixDualSubtitles(pageWindow, runtime = {}) {
  const APP_KEY = '__NFDS_APP__';
  const OPEN_SETTINGS_EVENT = '__NFDS_OPEN_SETTINGS__';
  const VERSION = runtime.version || '0.0.0';
  const PLATFORM = runtime.platform || 'unknown';
  const STORAGE_PREFIX = 'nfds.';
  const DEFAULTS = {
    enabled: true,
    hideNative: true,
    primaryPreference: 'en',
    secondaryPreference: 'zh-Hans',
    primaryTrackId: '',
    secondaryTrackId: '',
    swapLines: false,
  };

  if (pageWindow[APP_KEY]?.version === VERSION) {
    pageWindow[APP_KEY].touch?.();
    return;
  }

  if (pageWindow[APP_KEY]?.destroy) {
    pageWindow[APP_KEY].destroy();
  }

  const state = {
    config: null,
    running: false,
    loopHandle: null,
    lastWatchKey: null,
    lastVideoEl: null,
    originalTrackId: '',
    subtitleContainer: null,
    topLineText: '',
    bottomLineText: '',
    noticeTimer: null,
    lastNoticeKey: '',
    disposers: [],
    modalTracks: [],
    historyHookInstalled: false,
  };

  const STORAGE_KEYS = Object.freeze({
    enabled: 'enabled',
    hideNative: 'hideNative',
    primaryPreference: 'primaryPreference',
    secondaryPreference: 'secondaryPreference',
    primaryTrackId: 'primaryTrackId',
    secondaryTrackId: 'secondaryTrackId',
    swapLines: 'swapLines',
  });

  const sleep = (ms) => new Promise((resolve) => pageWindow.setTimeout(resolve, ms));
  const normalize = (value) => String(value || '').trim().toLowerCase();
  const isWatchPage = () => pageWindow.location.pathname.startsWith('/watch/');

  function safeGetStorage(key, fallbackValue) {
    try {
      const raw = pageWindow.localStorage.getItem(STORAGE_PREFIX + key);
      return raw == null ? fallbackValue : JSON.parse(raw);
    } catch (error) {
      return fallbackValue;
    }
  }

  function safeSetStorage(key, value) {
    try {
      pageWindow.localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
    } catch (error) {
      console.warn('[NFDS] Failed to persist setting', key, error);
    }
  }

  function readConfig() {
    state.config = {
      enabled: safeGetStorage(STORAGE_KEYS.enabled, DEFAULTS.enabled),
      hideNative: safeGetStorage(STORAGE_KEYS.hideNative, DEFAULTS.hideNative),
      primaryPreference: safeGetStorage(
        STORAGE_KEYS.primaryPreference,
        DEFAULTS.primaryPreference
      ),
      secondaryPreference: safeGetStorage(
        STORAGE_KEYS.secondaryPreference,
        DEFAULTS.secondaryPreference
      ),
      primaryTrackId: safeGetStorage(STORAGE_KEYS.primaryTrackId, DEFAULTS.primaryTrackId),
      secondaryTrackId: safeGetStorage(
        STORAGE_KEYS.secondaryTrackId,
        DEFAULTS.secondaryTrackId
      ),
      swapLines: safeGetStorage(STORAGE_KEYS.swapLines, DEFAULTS.swapLines),
    };
    return state.config;
  }

  function writeConfig(partialConfig) {
    const nextConfig = {
      ...readConfig(),
      ...partialConfig,
    };

    safeSetStorage(STORAGE_KEYS.enabled, nextConfig.enabled);
    safeSetStorage(STORAGE_KEYS.hideNative, nextConfig.hideNative);
    safeSetStorage(STORAGE_KEYS.primaryPreference, nextConfig.primaryPreference);
    safeSetStorage(STORAGE_KEYS.secondaryPreference, nextConfig.secondaryPreference);
    safeSetStorage(STORAGE_KEYS.primaryTrackId, nextConfig.primaryTrackId);
    safeSetStorage(STORAGE_KEYS.secondaryTrackId, nextConfig.secondaryTrackId);
    safeSetStorage(STORAGE_KEYS.swapLines, nextConfig.swapLines);

    state.config = nextConfig;
    updateControlButton();
    return nextConfig;
  }

  function addDisposable(disposer) {
    state.disposers.push(disposer);
  }

  function listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    addDisposable(() => target.removeEventListener(type, handler, options));
  }

  function ensureStyles() {
    if (document.getElementById('nfds-style')) {
      return;
    }

    const style = document.createElement('style');
    style.id = 'nfds-style';
    style.textContent = `
      :root.nfds-hide-native [class*="timedtext"],
      :root.nfds-hide-native [data-uia*="timedtext"],
      :root.nfds-hide-native [data-uia*="subtitles"] {
        opacity: 0 !important;
        visibility: hidden !important;
      }

      #nfds-notice {
        position: fixed;
        top: 16px;
        left: 16px;
        z-index: 2147483647;
        max-width: min(520px, calc(100vw - 32px));
        padding: 12px 14px;
        border-radius: 12px;
        background: rgba(10, 10, 10, 0.9);
        color: #fff;
        font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        box-shadow: 0 12px 30px rgba(0, 0, 0, 0.28);
        pointer-events: none;
        opacity: 0;
        transform: translateY(-8px);
        transition: opacity 160ms ease, transform 160ms ease;
        white-space: pre-wrap;
      }

      #nfds-notice[data-visible="true"] {
        opacity: 1;
        transform: translateY(0);
      }

      #nfds-overlay {
        position: fixed;
        left: 0;
        right: 0;
        bottom: 16%;
        z-index: 2147483646;
        display: flex;
        justify-content: center;
        pointer-events: none;
        padding: 0 4vw;
      }

      #nfds-overlay[hidden] {
        display: none !important;
      }

      #nfds-overlay-box {
        max-width: min(92vw, 1100px);
        text-align: center;
        color: #fff;
        text-shadow: 0 2px 12px rgba(0, 0, 0, 0.92);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
          "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
      }

      .nfds-line {
        white-space: pre-line;
        line-height: 1.3;
      }

      #nfds-line-top {
        font-size: clamp(18px, 2.55vw, 30px);
        margin-bottom: 0.26em;
        opacity: 0.96;
      }

      #nfds-line-bottom {
        font-size: clamp(16px, 2.15vw, 24px);
        font-weight: 700;
      }

      #nfds-control {
        position: fixed;
        top: 16px;
        right: 16px;
        z-index: 2147483647;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        height: 40px;
        padding: 0 14px;
        border: 0;
        border-radius: 999px;
        background: rgba(10, 10, 10, 0.84);
        color: #fff;
        font: 600 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        box-shadow: 0 12px 30px rgba(0, 0, 0, 0.24);
        cursor: pointer;
        backdrop-filter: blur(12px);
      }

      #nfds-control::before {
        content: "";
        width: 10px;
        height: 10px;
        border-radius: 999px;
        background: #31d158;
        box-shadow: 0 0 0 4px rgba(49, 209, 88, 0.16);
      }

      #nfds-control[data-running="false"]::before {
        background: #ff9f0a;
        box-shadow: 0 0 0 4px rgba(255, 159, 10, 0.16);
      }

      #nfds-modal {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 24px;
        background: rgba(0, 0, 0, 0.56);
      }

      #nfds-modal[data-open="true"] {
        display: flex;
      }

      #nfds-modal-panel {
        width: min(540px, calc(100vw - 32px));
        padding: 20px;
        border-radius: 18px;
        background: #101010;
        color: #fff;
        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.34);
        font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      #nfds-modal-panel h2 {
        margin: 0 0 6px;
        font-size: 18px;
      }

      #nfds-modal-panel p {
        margin: 0;
        color: rgba(255, 255, 255, 0.72);
      }

      .nfds-field {
        margin-top: 14px;
      }

      .nfds-field label {
        display: block;
        margin-bottom: 6px;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.03em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.7);
      }

      .nfds-field select,
      .nfds-field button {
        font: inherit;
      }

      .nfds-field select {
        width: 100%;
        height: 42px;
        padding: 0 12px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.06);
        color: #fff;
      }

      .nfds-checkbox-row {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-top: 12px;
      }

      .nfds-checkbox-row input {
        width: 16px;
        height: 16px;
      }

      .nfds-help {
        margin-top: 14px;
        padding: 12px 14px;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.05);
        color: rgba(255, 255, 255, 0.72);
        font-size: 12px;
      }

      #nfds-modal-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        justify-content: flex-end;
        margin-top: 18px;
      }

      .nfds-btn {
        min-width: 112px;
        height: 40px;
        padding: 0 14px;
        border: 0;
        border-radius: 999px;
        background: #e50914;
        color: #fff;
        cursor: pointer;
        font-weight: 700;
      }

      .nfds-btn[data-variant="ghost"] {
        background: rgba(255, 255, 255, 0.08);
      }

      .nfds-btn[data-variant="danger"] {
        background: #5f1013;
      }

      #nfds-modal-status {
        min-height: 20px;
        margin-top: 12px;
        color: rgba(255, 255, 255, 0.74);
        font-size: 12px;
      }
    `;

    (document.head || document.documentElement).appendChild(style);
  }

  function ensureNotice() {
    let notice = document.getElementById('nfds-notice');
    if (!notice) {
      notice = document.createElement('div');
      notice.id = 'nfds-notice';
      notice.setAttribute('aria-live', 'polite');
      (document.body || document.documentElement).appendChild(notice);
    }
    return notice;
  }

  function showNotice(message, options = {}) {
    const { persist = false, dedupeKey = message } = options;
    if (state.lastNoticeKey === dedupeKey && !persist) {
      return;
    }

    state.lastNoticeKey = dedupeKey;

    const notice = ensureNotice();
    notice.textContent = message;
    notice.dataset.visible = 'true';

    if (state.noticeTimer) {
      pageWindow.clearTimeout(state.noticeTimer);
      state.noticeTimer = null;
    }

    if (!persist) {
      state.noticeTimer = pageWindow.setTimeout(() => {
        notice.dataset.visible = 'false';
        state.noticeTimer = null;
      }, 4200);
    }
  }

  function hideNotice() {
    const notice = document.getElementById('nfds-notice');
    if (!notice) {
      return;
    }

    notice.dataset.visible = 'false';
    if (state.noticeTimer) {
      pageWindow.clearTimeout(state.noticeTimer);
      state.noticeTimer = null;
    }
  }

  function ensureOverlay() {
    let overlay = document.getElementById('nfds-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'nfds-overlay';
      overlay.hidden = true;
      overlay.innerHTML = `
        <div id="nfds-overlay-box">
          <div id="nfds-line-top" class="nfds-line"></div>
          <div id="nfds-line-bottom" class="nfds-line"></div>
        </div>
      `;
    }

    const parent = document.body || document.documentElement;
    if (overlay.parentNode !== parent) {
      parent.appendChild(overlay);
    }

    return overlay;
  }

  function setOverlayText(topText, bottomText) {
    const overlay = ensureOverlay();
    const topLine = overlay.querySelector('#nfds-line-top');
    const bottomLine = overlay.querySelector('#nfds-line-bottom');

    topLine.textContent = topText || '';
    bottomLine.textContent = bottomText || '';
    overlay.hidden = !topText && !bottomText;
  }

  function clearOverlayText() {
    state.topLineText = '';
    state.bottomLineText = '';
    setOverlayText('', '');
  }

  function ensureControlButton() {
    let button = document.getElementById('nfds-control');
    if (!button) {
      button = document.createElement('button');
      button.id = 'nfds-control';
      button.type = 'button';
      button.title = 'Open Netflix Dual Subtitles settings (Alt+Shift+D)';
      button.addEventListener('click', () => {
        void openSettings();
      });
      (document.body || document.documentElement).appendChild(button);
    }
    return button;
  }

  function updateControlButton() {
    const config = readConfig();
    const button = ensureControlButton();
    const enabled = Boolean(config.enabled);
    button.dataset.running = state.running ? 'true' : 'false';
    button.textContent = enabled ? 'Dual Subtitles' : 'Dual Subtitles Off';
    button.style.opacity = isWatchPage() ? '1' : '0.72';
  }

  function getModalElements() {
    return {
      modal: document.getElementById('nfds-modal'),
      status: document.getElementById('nfds-modal-status'),
      primarySelect: document.getElementById('nfds-primary-select'),
      secondarySelect: document.getElementById('nfds-secondary-select'),
      hideNative: document.getElementById('nfds-hide-native'),
      swapLines: document.getElementById('nfds-swap-lines'),
      enableToggle: document.getElementById('nfds-enable-toggle'),
    };
  }

  function closeSettings() {
    const modal = document.getElementById('nfds-modal');
    if (modal) {
      modal.dataset.open = 'false';
    }
  }

  function ensureModal() {
    let modal = document.getElementById('nfds-modal');
    if (modal) {
      return modal;
    }

    modal = document.createElement('div');
    modal.id = 'nfds-modal';
    modal.dataset.open = 'false';
    modal.innerHTML = `
      <div id="nfds-modal-panel" role="dialog" aria-modal="true" aria-labelledby="nfds-modal-title">
        <h2 id="nfds-modal-title">Netflix Dual Subtitles</h2>
        <p>Pick two subtitle tracks and the overlay will keep them visible together.</p>

        <div class="nfds-field">
          <label for="nfds-primary-select">Top line</label>
          <select id="nfds-primary-select"></select>
        </div>

        <div class="nfds-field">
          <label for="nfds-secondary-select">Bottom line</label>
          <select id="nfds-secondary-select"></select>
        </div>

        <div class="nfds-checkbox-row">
          <input id="nfds-enable-toggle" type="checkbox" />
          <label for="nfds-enable-toggle">Enable dual subtitles on watch pages</label>
        </div>

        <div class="nfds-checkbox-row">
          <input id="nfds-hide-native" type="checkbox" />
          <label for="nfds-hide-native">Hide Netflix native subtitles while the overlay is active</label>
        </div>

        <div class="nfds-checkbox-row">
          <input id="nfds-swap-lines" type="checkbox" />
          <label for="nfds-swap-lines">Swap top and bottom lines</label>
        </div>

        <div class="nfds-help">
          Hotkey: <strong>Alt + Shift + D</strong> opens this panel.
          Netflix must already have subtitles enabled once so the page keeps updating subtitle DOM nodes.
        </div>

        <div id="nfds-modal-status"></div>

        <div id="nfds-modal-actions">
          <button type="button" class="nfds-btn" data-variant="ghost" data-nfds-action="close">Close</button>
          <button type="button" class="nfds-btn" data-variant="danger" data-nfds-action="stop">Stop Overlay</button>
          <button type="button" class="nfds-btn" data-variant="ghost" data-nfds-action="restart">Re-init</button>
          <button type="button" class="nfds-btn" data-nfds-action="save">Save & Restart</button>
        </div>
      </div>
    `;

    modal.addEventListener('click', (event) => {
      if (event.target === modal) {
        closeSettings();
      }
    });

    modal.addEventListener('click', (event) => {
      const action = event.target?.dataset?.nfdsAction;
      if (!action) {
        return;
      }

      if (action === 'close') {
        closeSettings();
        return;
      }

      if (action === 'stop') {
        writeConfig({ enabled: false });
        stop();
        setModalStatus('Overlay stopped. Netflix native subtitles restored.');
        return;
      }

      if (action === 'restart') {
        writeConfig({ enabled: true });
        void restart({ showConfirmation: true });
        return;
      }

      if (action === 'save') {
        void saveSettingsFromModal();
      }
    });

    (document.body || document.documentElement).appendChild(modal);
    return modal;
  }

  function setModalStatus(message) {
    const { status } = getModalElements();
    if (status) {
      status.textContent = message;
    }
  }

  function getPlayer() {
    const videoPlayerApi = pageWindow.netflix?.appContext?.state?.playerApp?.getAPI?.()?.videoPlayer;
    if (!videoPlayerApi?.getAllPlayerSessionIds || !videoPlayerApi?.getVideoPlayerBySessionId) {
      return null;
    }

    const sessionIds = videoPlayerApi.getAllPlayerSessionIds();
    const selectedId = sessionIds.find((sessionId) => String(sessionId).startsWith('watch-')) || sessionIds[0];
    return selectedId ? videoPlayerApi.getVideoPlayerBySessionId(selectedId) : null;
  }

  function getCurrentTimedTextTrack(player) {
    try {
      if (typeof player?.getTimedTextTrack === 'function') {
        return player.getTimedTextTrack();
      }
      if (typeof player?.getCurrentTimedTextTrack === 'function') {
        return player.getCurrentTimedTextTrack();
      }
      if (typeof player?.getSelectedTimedTextTrack === 'function') {
        return player.getSelectedTimedTextTrack();
      }
    } catch (error) {
      return null;
    }

    return null;
  }

  function getTimedTextTracks(player) {
    return Array.isArray(player?.getTimedTextTrackList?.()) ? player.getTimedTextTrackList() : [];
  }

  function findTrackById(player, trackId) {
    if (!trackId) {
      return null;
    }

    return getTimedTextTracks(player).find(
      (track) => String(track.trackId) === String(trackId)
    ) || null;
  }

  function scoreTrackMatch(track, preference) {
    const want = normalize(preference);
    if (!want) {
      return -1;
    }

    const displayName = normalize(track.displayName);
    const bcp47 = normalize(track.bcp47);
    let score = 0;

    if (bcp47 === want) {
      score = 100;
    } else if (bcp47.startsWith(want + '-')) {
      score = 90;
    } else if (displayName === want) {
      score = 80;
    } else if (displayName.includes(want)) {
      score = 70;
    }

    if (track.trackType === 'PRIMARY') {
      score += 10;
    } else if (track.trackType === 'ASSISTIVE') {
      score -= 10;
    }

    return score;
  }

  function findTrack(player, preference) {
    let bestTrack = null;
    let bestScore = -1;

    for (const track of getTimedTextTracks(player)) {
      const score = scoreTrackMatch(track, preference);
      if (score > bestScore) {
        bestTrack = track;
        bestScore = score;
      }
    }

    return bestScore >= 0 ? bestTrack : null;
  }

  function getSelectableTracks(player) {
    return getTimedTextTracks(player).filter((track) => {
      const displayName = String(track.displayName || '');
      const code = String(track.bcp47 || '');
      if (!displayName && !code) {
        return false;
      }

      const loweredName = displayName.toLowerCase();
      return !loweredName.includes('off') && !loweredName.includes('关闭') && !loweredName.includes('關閉');
    });
  }

  function describeTrack(track) {
    if (!track) {
      return 'Unavailable';
    }

    const label = [];
    if (track.displayName) {
      label.push(track.displayName);
    }
    if (track.bcp47) {
      label.push(`(${track.bcp47})`);
    }
    if (track.trackType) {
      label.push(`[${track.trackType}]`);
    }
    return label.join(' ');
  }

  function findSubtitleContainer() {
    const selectors = [
      '[data-uia*="timedtext"]',
      '[data-uia*="subtitles"]',
      '[class*="timedtext"]',
      '[class*="TimedText"]',
    ];

    for (const selector of selectors) {
      const node = document.querySelector(selector);
      if (node) {
        return node;
      }
    }

    return Array.from(document.querySelectorAll('div')).find((node) => {
      return /timedtext/i.test(node.className || '');
    }) || null;
  }

  function getSubtitleContainer() {
    if (state.subtitleContainer?.isConnected) {
      return state.subtitleContainer;
    }

    state.subtitleContainer = findSubtitleContainer();
    return state.subtitleContainer;
  }

  function textFromContainer(container) {
    if (!container) {
      return '';
    }

    const walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT
    );

    let output = '';
    let node = null;

    while ((node = walker.nextNode())) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.tagName === 'BR') {
          output += '\n';
        }
      } else if (node.nodeType === Node.TEXT_NODE) {
        output += node.nodeValue || '';
      }
    }

    return output
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .trim();
  }

  function waitSubtitleStable(container, timeoutMs = 300, settleMs = 120) {
    return new Promise((resolve) => {
      let lastText = textFromContainer(container);
      let settledTimer = null;
      let finished = false;

      const finish = () => {
        if (finished) {
          return;
        }
        finished = true;
        if (settledTimer) {
          pageWindow.clearTimeout(settledTimer);
        }
        observer.disconnect();
        resolve(lastText);
      };

      const bump = () => {
        if (settledTimer) {
          pageWindow.clearTimeout(settledTimer);
        }
        settledTimer = pageWindow.setTimeout(finish, settleMs);
      };

      const observer = new MutationObserver(() => {
        const text = textFromContainer(container);
        if (text !== lastText) {
          lastText = text;
        }
        bump();
      });

      observer.observe(container, {
        childList: true,
        subtree: true,
        characterData: true,
      });

      bump();
      pageWindow.setTimeout(finish, timeoutMs);
    });
  }

  async function sampleTrack(player, track, timeoutMs = 520) {
    const container = getSubtitleContainer();
    if (!container) {
      return '';
    }

    try {
      player.setTimedTextTrack(track);
    } catch (error) {
      console.warn('[NFDS] Failed to switch track', track, error);
      return '';
    }

    const stableText = await waitSubtitleStable(container, timeoutMs, 120);
    if (stableText) {
      return stableText;
    }

    await sleep(70);
    return textFromContainer(container);
  }

  function ensureRootNodes() {
    ensureStyles();
    ensureOverlay();
    ensureControlButton();
    ensureModal();
  }

  function updateNativeSubtitleVisibility() {
    const config = readConfig();
    const shouldHide = state.running && config.hideNative;
    document.documentElement.classList.toggle('nfds-hide-native', shouldHide);
  }

  function resolveTrackSelections(player) {
    const config = readConfig();

    const topTrack =
      findTrackById(player, config.primaryTrackId) ||
      findTrack(player, config.primaryPreference) ||
      null;

    const bottomTrack =
      findTrackById(player, config.secondaryTrackId) ||
      findTrack(player, config.secondaryPreference) ||
      null;

    return { topTrack, bottomTrack };
  }

  async function waitForPlayer(timeoutMs = 10000) {
    const attempts = Math.max(1, Math.ceil(timeoutMs / 150));
    for (let index = 0; index < attempts; index += 1) {
      if (!isWatchPage()) {
        return null;
      }

      const player = getPlayer();
      if (player) {
        return player;
      }

      await sleep(150);
    }

    return null;
  }

  async function waitForRuntimeReady(timeoutMs = 16000) {
    const attempts = Math.max(1, Math.ceil(timeoutMs / 150));
    for (let index = 0; index < attempts; index += 1) {
      if (!isWatchPage()) {
        return null;
      }

      const player = getPlayer();
      const video = document.querySelector('video');
      if (player && video) {
        return { player, video };
      }

      await sleep(150);
    }

    return null;
  }

  function rememberCurrentTrack(player) {
    const current = getCurrentTimedTextTrack(player);
    state.originalTrackId = current?.trackId ? String(current.trackId) : '';
  }

  function restoreOriginalTrack() {
    if (!state.originalTrackId) {
      return;
    }

    const player = getPlayer();
    const originalTrack = findTrackById(player, state.originalTrackId);
    if (!player || !originalTrack) {
      return;
    }

    try {
      player.setTimedTextTrack(originalTrack);
    } catch (error) {
      console.warn('[NFDS] Failed to restore original subtitle track', error);
    }
  }

  function updateRenderedLines(firstText, secondText) {
    const config = readConfig();
    const topText = config.swapLines ? secondText : firstText;
    const bottomText = config.swapLines ? firstText : secondText;

    if (topText === state.topLineText && bottomText === state.bottomLineText) {
      return;
    }

    state.topLineText = topText;
    state.bottomLineText = bottomText;
    setOverlayText(topText, bottomText);
  }

  async function runSamplingLoop(player, topTrack, bottomTrack) {
    if (!state.running || !isWatchPage()) {
      return;
    }

    ensureRootNodes();
    updateNativeSubtitleVisibility();

    if (!getSubtitleContainer()) {
      showNotice(
        'Netflix subtitle DOM is not visible yet. Turn subtitles on once in the player, then press Re-init.',
        { dedupeKey: 'missing-subtitle-dom' }
      );
      state.loopHandle = pageWindow.setTimeout(
        () => void runSamplingLoop(player, topTrack, bottomTrack),
        900
      );
      return;
    }

    const firstText = await sampleTrack(player, topTrack);
    const secondText = await sampleTrack(player, bottomTrack);
    updateRenderedLines(firstText, secondText);

    state.loopHandle = pageWindow.setTimeout(
      () => void runSamplingLoop(player, topTrack, bottomTrack),
      700
    );
  }

  async function start() {
    const config = readConfig();
    if (!config.enabled) {
      stop();
      return;
    }

    if (state.running) {
      return;
    }

    if (!isWatchPage()) {
      updateControlButton();
      return;
    }

    ensureRootNodes();
    state.running = true;
    updateControlButton();
    updateNativeSubtitleVisibility();

    const runtimeState = await waitForRuntimeReady();
    if (!runtimeState) {
      stop({ keepEnabled: true, restoreTrack: false });
      showNotice('Netflix player not ready yet. Re-open the episode or press Re-init.', {
        dedupeKey: 'player-not-ready',
      });
      return;
    }

    const { player, video } = runtimeState;
    rememberCurrentTrack(player);

    const { topTrack, bottomTrack } = resolveTrackSelections(player);
    if (!topTrack || !bottomTrack) {
      stop({ keepEnabled: true, restoreTrack: true });
      showNotice(
        'Could not resolve both subtitle tracks on this title. Open Dual Subtitles settings to pick tracks manually.',
        { dedupeKey: 'tracks-missing' }
      );
      return;
    }

    state.lastWatchKey = pageWindow.location.pathname;
    state.lastVideoEl = video;
    state.subtitleContainer = null;

    showNotice(
      `Dual subtitles active on ${PLATFORM}\nTop: ${describeTrack(topTrack)}\nBottom: ${describeTrack(bottomTrack)}`,
      { dedupeKey: `started:${topTrack.trackId}:${bottomTrack.trackId}` }
    );

    await runSamplingLoop(player, topTrack, bottomTrack);
  }

  function stop(options = {}) {
    const { keepEnabled = false, restoreTrack = true } = options;
    if (!keepEnabled) {
      writeConfig({ enabled: false });
    }

    state.running = false;
    if (state.loopHandle) {
      pageWindow.clearTimeout(state.loopHandle);
      state.loopHandle = null;
    }

    state.subtitleContainer = null;
    state.lastWatchKey = null;
    state.lastVideoEl = null;
    clearOverlayText();
    document.documentElement.classList.remove('nfds-hide-native');
    if (restoreTrack) {
      restoreOriginalTrack();
    }
    updateControlButton();
  }

  async function restart(options = {}) {
    const { showConfirmation = false } = options;
    stop({ keepEnabled: true, restoreTrack: true });
    await start();
    if (showConfirmation) {
      setModalStatus('Overlay restarted with the current settings.');
    }
  }

  function createTrackOption(track) {
    return {
      value: String(track.trackId),
      label: describeTrack(track),
      preference: track.bcp47 || track.displayName || '',
    };
  }

  function populateTrackSelect(selectNode, tracks, selectedTrackId, selectedPreference) {
    selectNode.innerHTML = '';

    const selectPlaceholder = document.createElement('option');
    selectPlaceholder.value = '';
    selectPlaceholder.textContent = tracks.length
      ? 'Auto-detect from preferred language'
      : 'Open a Netflix watch page with subtitles enabled';
    selectNode.appendChild(selectPlaceholder);

    for (const track of tracks) {
      const option = document.createElement('option');
      option.value = String(track.trackId);
      option.textContent = describeTrack(track);
      selectNode.appendChild(option);
    }

    if (selectedTrackId && tracks.some((track) => String(track.trackId) === String(selectedTrackId))) {
      selectNode.value = String(selectedTrackId);
      return;
    }

    const fallbackTrack = selectedPreference ? findTrack({ getTimedTextTrackList: () => tracks }, selectedPreference) : null;
    if (fallbackTrack) {
      selectNode.value = String(fallbackTrack.trackId);
      return;
    }

    selectNode.value = '';
  }

  async function refreshModal() {
    ensureRootNodes();
    const config = readConfig();
    const elements = getModalElements();

    elements.enableToggle.checked = Boolean(config.enabled);
    elements.hideNative.checked = Boolean(config.hideNative);
    elements.swapLines.checked = Boolean(config.swapLines);
    setModalStatus('Loading available subtitle tracks from Netflix...');

    if (!isWatchPage()) {
      state.modalTracks = [];
      populateTrackSelect(
        elements.primarySelect,
        [],
        config.primaryTrackId,
        config.primaryPreference
      );
      populateTrackSelect(
        elements.secondarySelect,
        [],
        config.secondaryTrackId,
        config.secondaryPreference
      );
      setModalStatus('Open any Netflix watch page to pick subtitle tracks.');
      return;
    }

    const player = await waitForPlayer(3500);
    if (!player) {
      setModalStatus('Netflix player API is not ready yet. Try again after playback starts.');
      return;
    }

    const tracks = getSelectableTracks(player);
    state.modalTracks = tracks;

    populateTrackSelect(
      elements.primarySelect,
      tracks,
      config.primaryTrackId,
      config.primaryPreference
    );
    populateTrackSelect(
      elements.secondarySelect,
      tracks,
      config.secondaryTrackId,
      config.secondaryPreference
    );

    if (!tracks.length) {
      setModalStatus('No subtitle tracks found yet. Turn subtitles on in Netflix once, then reopen this panel.');
      return;
    }

    setModalStatus(`Loaded ${tracks.length} subtitle tracks from the current title.`);
  }

  async function saveSettingsFromModal() {
    const elements = getModalElements();
    const tracksById = new Map(
      state.modalTracks.map((track) => [String(track.trackId), track])
    );

    const selectedPrimaryTrack = tracksById.get(elements.primarySelect.value) || null;
    const selectedSecondaryTrack = tracksById.get(elements.secondarySelect.value) || null;

    writeConfig({
      enabled: Boolean(elements.enableToggle.checked),
      hideNative: Boolean(elements.hideNative.checked),
      swapLines: Boolean(elements.swapLines.checked),
      primaryTrackId: selectedPrimaryTrack ? String(selectedPrimaryTrack.trackId) : '',
      secondaryTrackId: selectedSecondaryTrack ? String(selectedSecondaryTrack.trackId) : '',
      primaryPreference:
        selectedPrimaryTrack?.bcp47 ||
        selectedPrimaryTrack?.displayName ||
        readConfig().primaryPreference,
      secondaryPreference:
        selectedSecondaryTrack?.bcp47 ||
        selectedSecondaryTrack?.displayName ||
        readConfig().secondaryPreference,
    });

    if (!readConfig().enabled) {
      stop();
      setModalStatus('Saved. Dual subtitles are disabled.');
      return;
    }

    await restart({ showConfirmation: false });
    setModalStatus('Saved. Overlay restarted with the selected tracks.');
  }

  async function openSettings() {
    const modal = ensureModal();
    modal.dataset.open = 'true';
    await refreshModal();
  }

  function handleHotkey(event) {
    if (event.defaultPrevented) {
      return;
    }

    const activeTag = document.activeElement?.tagName?.toLowerCase();
    if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select') {
      return;
    }

    if (event.altKey && event.shiftKey && event.code === 'KeyD') {
      event.preventDefault();
      void openSettings();
    }
  }

  function installUrlChangeHook() {
    if (pageWindow.__nfdsHistoryHooked) {
      return;
    }

    pageWindow.__nfdsHistoryHooked = true;
    const dispatchUrlChange = () => pageWindow.dispatchEvent(new Event('nfds:urlchange'));
    const originalPushState = pageWindow.history.pushState;
    const originalReplaceState = pageWindow.history.replaceState;

    pageWindow.history.pushState = function pushStateWrapper() {
      const result = originalPushState.apply(this, arguments);
      dispatchUrlChange();
      return result;
    };

    pageWindow.history.replaceState = function replaceStateWrapper() {
      const result = originalReplaceState.apply(this, arguments);
      dispatchUrlChange();
      return result;
    };

    pageWindow.addEventListener('popstate', dispatchUrlChange);
  }

  async function maybeAutoAttach() {
    ensureRootNodes();
    updateControlButton();

    const config = readConfig();
    if (!config.enabled) {
      if (state.running) {
        stop({ keepEnabled: true, restoreTrack: true });
      }
      return;
    }

    if (!isWatchPage()) {
      if (state.running) {
        stop({ keepEnabled: true, restoreTrack: true });
      }
      return;
    }

    const currentPath = pageWindow.location.pathname;
    const currentVideo = document.querySelector('video');

    if (!state.running) {
      await start();
      return;
    }

    const shouldRestart =
      (state.lastWatchKey && currentPath !== state.lastWatchKey) ||
      (state.lastVideoEl && currentVideo && currentVideo !== state.lastVideoEl);

    if (shouldRestart) {
      await restart({ showConfirmation: false });
    }
  }

  function touch() {
    ensureRootNodes();
    updateControlButton();
  }

  function destroy() {
    stop({ keepEnabled: true, restoreTrack: true });
    hideNotice();

    const overlay = document.getElementById('nfds-overlay');
    const modal = document.getElementById('nfds-modal');
    const button = document.getElementById('nfds-control');
    const notice = document.getElementById('nfds-notice');
    const style = document.getElementById('nfds-style');

    overlay?.remove();
    modal?.remove();
    button?.remove();
    notice?.remove();
    style?.remove();

    for (const disposer of state.disposers.splice(0)) {
      try {
        disposer();
      } catch (error) {
        console.warn('[NFDS] Failed to dispose listener', error);
      }
    }

    delete pageWindow[APP_KEY];
  }

  pageWindow[APP_KEY] = {
    version: VERSION,
    openSettings,
    start,
    stop,
    restart,
    destroy,
    touch,
  };

  ensureRootNodes();
  updateControlButton();
  installUrlChangeHook();

  listen(pageWindow, 'keydown', handleHotkey, true);
  listen(pageWindow, OPEN_SETTINGS_EVENT, () => {
    void openSettings();
  });
  listen(pageWindow, 'nfds:urlchange', () => {
    pageWindow.setTimeout(() => {
      void maybeAutoAttach();
    }, 0);
  });

  const watchdog = pageWindow.setInterval(() => {
    void maybeAutoAttach();
  }, 900);
  addDisposable(() => pageWindow.clearInterval(watchdog));

  pageWindow.setTimeout(() => {
    void maybeAutoAttach();
  }, 0);
}

  bootNetflixDualSubtitles(window, {
    platform: 'extension',
    version: '6.0.0',
  });
})();
