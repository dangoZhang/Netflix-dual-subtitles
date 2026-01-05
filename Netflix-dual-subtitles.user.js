// ==UserScript==
// @name         Netflix Dual Subtitles (Safari DOM-sample Overlay)
// @namespace    https://example.com/
// @version      5.0.0
// @description  Netflix bilingual subtitles on Safari: hide native subtitles, rapidly sample two subtitle tracks and show both via overlay. Works even when subtitle network is in worker/SW (no fetch/XHR sniff needed).
// @match        https://www.netflix.com/*
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(() => {
  'use strict';

  const W = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;

  const DEFAULT_L1 = 'en';      // line1 language (top)
  const DEFAULT_L2 = 'zh-Hans'; // line2 language (bottom or vice versa)
  const SAMPLE_MS  = 260;       // per track sampling delay
  const LOOP_MS    = 700;       // loop interval (must be >= 2*SAMPLE_MS)

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const norm = (s) => String(s || '').trim().toLowerCase();
  const isWatch = () => location.pathname.startsWith('/watch/');

  const isDisabled = () => GM_getValue('nfds_disabled', false);
  const setDisabled = (v) => GM_setValue('nfds_disabled', !!v);

  GM_addStyle(`
    #nfds-hud{ display:none !important; }
    #nfds-hud{
      position:fixed; left:10px; top:10px; z-index:2147483647;
      background:rgba(0,0,0,.75); color:#fff; padding:8px 10px;
      font:12px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",Arial;
      border-radius:8px; pointer-events:none; max-width:60vw; white-space:pre-wrap;
    }
    #nfds-root{
      position: fixed; left:0; right:0; bottom:18%;
      z-index:2147483647; pointer-events:none;
      display:flex; justify-content:center; padding:0 4vw;
    }
    #nfds-box{
      max-width:92vw; text-align:center; line-height:1.25;
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",Arial,sans-serif;
      text-shadow:0 2px 8px rgba(0,0,0,.9); color:#fff;
    }
    #nfds-line1{
      font-size:clamp(16px,2.4vw,28px);
      opacity:.92;
      margin-bottom:.25em;
      white-space:pre-line;
    }
    #nfds-line2{
      font-size:clamp(14px,2.0vw,22px);
      font-weight:600;
      white-space:pre-line;
    }

    /* Hide Netflix native subtitles (keep DOM updating) */
    .nfds-hide-native [class*="timedtext"],
    .nfds-hide-native [data-uia*="timedtext"],
    .nfds-hide-native [data-uia*="subtitles"]{
      opacity: 0 !important;
      visibility: hidden !important;
    }
  `);

  const HUD = (() => {
    const el = document.createElement('div');
    el.id = 'nfds-hud';
    el.textContent = 'NF DualSub: loading...';
    document.documentElement.appendChild(el);
    return { set: (t) => (el.textContent = t) };
  })();

  function ensureOverlay() {
    let root = document.getElementById('nfds-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'nfds-root';
      root.innerHTML = `
        <div id="nfds-box">
          <div id="nfds-line1"></div>
          <div id="nfds-line2"></div>
        </div>`;
    }
    const parent = document.body || document.documentElement;
    if (root.parentNode !== parent) parent.appendChild(root);
    return root;
  }

  // Keep overlay alive (Netflix SPA)
  setInterval(() => { if (isWatch()) ensureOverlay(); }, 1000);

  function getPlayer() {
    const vp = W.netflix?.appContext?.state?.playerApp?.getAPI?.()?.videoPlayer;
    if (!vp?.getAllPlayerSessionIds || !vp?.getVideoPlayerBySessionId) return null;
    const all = vp.getAllPlayerSessionIds();
    const sid = all.find(x => String(x).startsWith('watch-')) || all[0];
    return sid ? vp.getVideoPlayerBySessionId(sid) : null;
  }

  function findTrack(player, want) {
    const w = norm(want);
    const tracks = player?.getTimedTextTrackList?.() || [];
    let best = null;
    for (const t of tracks) {
      const dn = norm(t.displayName);
      const bc = norm(t.bcp47);
      const hit = (bc === w) || (w && bc.startsWith(w)) || (dn === w) || (w && dn.includes(w));
      if (!hit) continue;
      if (!best) best = t;
      else {
        // prefer PRIMARY over ASSISTIVE if both match
        const bp = String(best.trackType || '') === 'ASSISTIVE';
        const tp = String(t.trackType || '') === 'ASSISTIVE';
        if (!bp && tp) best = t;
      }
    }
    return best;
  }

  function getCurrentTimedTextTrack(player) {
      try {
        if (typeof player.getTimedTextTrack === 'function') return player.getTimedTextTrack();
        if (typeof player.getCurrentTimedTextTrack === 'function') return player.getCurrentTimedTextTrack();
        if (typeof player.getSelectedTimedTextTrack === 'function') return player.getSelectedTimedTextTrack();
      } catch (e) {}
      return null;
    }

  function findTrackById(player, trackId) {
      const tracks = player?.getTimedTextTrackList?.() || [];
      return tracks.find(t => String(t.trackId) === String(trackId)) || null;
    }

  function findSubtitleContainer() {
    // Most common Netflix containers contain "timedtext"
    const selectors = [
      '[data-uia*="timedtext"]',
      '[data-uia*="subtitles"]',
      '[class*="timedtext"]',
      '[class*="TimedText"]'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    // fallback: find a visible-ish element containing timedtext in className
    const all = Array.from(document.querySelectorAll('div'));
    return all.find(d => /timedtext/i.test(d.className || '')) || null;
  }

    function textFromContainer(el) {
      if (!el) return '';

      // 只读容器内真实显示的文字，手动把 <br> 转成换行
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
      let out = '';
      let node;

      while ((node = walker.nextNode())) {
        if (node.nodeType === 1) { // ELEMENT
          const tag = node.tagName;
          if (tag === 'BR') out += '\n';
        } else if (node.nodeType === 3) { // TEXT
          out += node.nodeValue || '';
        }
      }

      return out
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n[ \t]+/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .trim();
    }

  function waitSubtitleStable(container, timeoutMs = 260, settleMs = 110) {
      return new Promise((resolve) => {
        let last = textFromContainer(container);
        let settledTimer = null;
        let done = false;

        const finish = () => {
          if (done) return;
          done = true;
          if (settledTimer) clearTimeout(settledTimer);
          obs.disconnect();
          resolve(last);
        };

        const bump = () => {
          if (settledTimer) clearTimeout(settledTimer);
          settledTimer = setTimeout(finish, settleMs); // ✅ 一段时间没变，认为稳定
        };

        const obs = new MutationObserver(() => {
          const now = textFromContainer(container);
          if (now !== last) last = now;
          bump();
        });

        obs.observe(container, { childList: true, subtree: true, characterData: true });

        // 立即启动一个 settle 计时：防止只有一次 mutation 的情况
        bump();

        setTimeout(finish, timeoutMs);
      });
    }

    async function sampleTrack(player, track, container, timeoutMs = 260) {
      try { player.setTimedTextTrack(track); } catch (e) {}
      const stable = await waitSubtitleStable(container, timeoutMs, 110);

      // 防止“先清空再写入”时读到空：补偿一次
      if (!stable) {
        await sleep(70);
        return textFromContainer(container);
      }
      return stable;
    }

  let running = false;
  let loopHandle = null;
  let lastWatchKey = null;
  let lastVideoEl = null;

  async function start() {
    setDisabled(false);
    if (running) return;
    running = true;

    try {
      ensureOverlay();
      document.documentElement.classList.add('nfds-hide-native');

      // Wait for player+video+subtitle container
      let player = null, video = null, box = null;
      for (let i = 0; i < 260; i++) {
        if (!isWatch()) return;
        player = getPlayer();
        video = document.querySelector('video');
        box = findSubtitleContainer();
        if (player && video && box) break;
        await sleep(150);
      }

      if (!player || !video) {
        HUD.set('NF DualSub: player/video not ready. Reload watch page.');
        running = false;
        return;
      }
      if (!box) {
        HUD.set(
          'NF DualSub: subtitle DOM not found yet.\n' +
          'Tip: turn ON any subtitle in Netflix once, then Re-init.'
        );
        running = false;
        return;
      }

      const want1 = GM_getValue('nfds_l1', DEFAULT_L1);
      const want2 = GM_getValue('nfds_l2', DEFAULT_L2);

      const tracks = player.getTimedTextTrackList?.() || [];
        const id1 = GM_getValue('nfds_l1_id', '');
        const id2 = GM_getValue('nfds_l2_id', '');

        const t1 = id1 ? (findTrackById(player, id1) || findTrack(player, want1)) : findTrack(player, want1);
        const t2 = id2 ? (findTrackById(player, id2) || findTrack(player, want2)) : findTrack(player, want2);

      HUD.set(
        `NF DualSub (DOM sample)\n` +
        `tracks: ${tracks.length}\n` +
        `L1: ${want1} -> ${t1 ? (t1.bcp47 || t1.displayName) : 'NOT FOUND'}\n` +
        `L2: ${want2} -> ${t2 ? (t2.bcp47 || t2.displayName) : 'NOT FOUND'}\n` +
        `native subtitles: hidden\nstatus: sampling...`
      );

      if (!t1 || !t2) {
        HUD.set('NF DualSub: track not found.\nUse menu to set languages.');
        running = false;
        return;
      }

      lastWatchKey = location.pathname; // /watch/xxxx
      lastVideoEl = video;

      const line1 = document.getElementById('nfds-line1');
      const line2 = document.getElementById('nfds-line2');

      let lastL1 = '', lastL2 = '';

      const loop = async () => {
        if (!running || !isWatch()) return;
        ensureOverlay();

        // sample L1
        const s1 = await sampleTrack(player, t1, box, SAMPLE_MS + 250);
        // sample L2
        const s2 = await sampleTrack(player, t2, box, SAMPLE_MS + 250);

        if (s1 !== lastL1) { line1.textContent = s1; lastL1 = s1; }
        if (s2 !== lastL2) { line2.textContent = s2; lastL2 = s2; }

        // keep looping
        loopHandle = setTimeout(loop, LOOP_MS);
      };

      loop();

    } catch (e) {
      HUD.set('NF DualSub error:\n' + (e && e.stack ? e.stack : String(e)));
      running = false;
    }
  }

  function stop() {
    setDisabled(true);
    running = false;
    if (loopHandle) clearTimeout(loopHandle);
    loopHandle = null;
    document.documentElement.classList.remove('nfds-hide-native');
    const l1 = document.getElementById('nfds-line1'); if (l1) l1.textContent = '';
    const l2 = document.getElementById('nfds-line2'); if (l2) l2.textContent = '';
    HUD.set('NF DualSub: stopped');
    lastWatchKey = null;
    lastVideoEl = null;
  }

  function getSelectableTracks(player) {
  const tracks = player?.getTimedTextTrackList?.() || [];
  // 过滤“關閉/off”等
  return tracks.filter(t => {
    const name = String(t.displayName || '');
    const bc = t.bcp47;
    if (!name) return false;
    if (name.includes('關閉') || name.toLowerCase() === 'off') return false;
    // 有些轨 bcp47 为空也可能存在，但通常可以过滤掉
    return true;
  });
}

    function buildLangOptionsFromTracks(tracks) {
      return tracks.map(t => {
        const bc = t.bcp47 ? String(t.bcp47) : '';
        const tt = t.trackType ? String(t.trackType) : '';
        const label = `${t.displayName}${bc ? ` (${bc})` : ''}${tt ? ` — ${tt}` : ''}`;
        return {
          value: String(t.trackId), // ✅ 用 trackId，避免 ru 重复/选错
          label
        };
      });
    }

    function showSelectDialog({ title, currentValue, options }) {
      return new Promise((resolve) => {
        // 遮罩
        const overlay = document.createElement('div');
        overlay.style.cssText = `
          position:fixed; inset:0; z-index:2147483647;
          background:rgba(0,0,0,.55); display:flex; align-items:center; justify-content:center;
          pointer-events:auto;
        `;

        // 面板
        const panel = document.createElement('div');
        panel.style.cssText = `
          width:min(520px,92vw);
          background:#111; color:#fff; border-radius:12px; padding:14px 14px 12px;
          font:14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Arial;
          box-shadow:0 10px 30px rgba(0,0,0,.45);
        `;

        const h = document.createElement('div');
        h.textContent = title;
        h.style.cssText = `font-weight:700; margin-bottom:10px;`;

        const sel = document.createElement('select');
        sel.style.cssText = `
          width:100%; padding:10px 10px;
          border-radius:10px; border:1px solid rgba(255,255,255,.15);
          background:#1a1a1a; color:#fff;
        `;

        // options
        for (const opt of options) {
          const o = document.createElement('option');
          o.value = opt.value;
          o.textContent = opt.label;
          if (String(opt.value) === String(currentValue)) o.selected = true;
          sel.appendChild(o);
        }

        const tip = document.createElement('div');
        tip.style.cssText = `opacity:.75; margin-top:10px; font-size:12px;`;
        tip.textContent = `提示：只显示当前片源可选字幕轨（PRIMARY/ASSISTIVE）。`;

        const row = document.createElement('div');
        row.style.cssText = `display:flex; gap:10px; justify-content:flex-end; margin-top:12px;`;

        const btnCancel = document.createElement('button');
        btnCancel.textContent = 'Cancel';
        btnCancel.style.cssText = `
          padding:8px 12px; border-radius:10px; border:1px solid rgba(255,255,255,.18);
          background:transparent; color:#fff; cursor:pointer;
        `;

        const btnOK = document.createElement('button');
        btnOK.textContent = 'Save';
        btnOK.style.cssText = `
          padding:8px 12px; border-radius:10px; border:0;
          background:#e50914; color:#fff; cursor:pointer; font-weight:700;
        `;

        const close = (v) => {
          overlay.remove();
          resolve(v);
        };

        btnCancel.onclick = () => close(null);
        btnOK.onclick = () => close(sel.value);
        overlay.onclick = (e) => { if (e.target === overlay) close(null); };

        row.appendChild(btnCancel);
        row.appendChild(btnOK);

        panel.appendChild(h);
        panel.appendChild(sel);
        panel.appendChild(tip);
        panel.appendChild(row);

        overlay.appendChild(panel);
        document.body.appendChild(overlay);
      });
    }

    // 设置语言后让它立刻生效：等价于你手点 Re-init
    async function applyLangAndRestart() {
      // 你当前脚本里应该有 stop()/start()
      if (typeof stop === 'function') stop();
      if (typeof start === 'function') await start();
    }

GM_registerMenuCommand('NF 双语字幕：设置 L1 (上行)', async () => {
    const curId = GM_getValue('nfds_l1_id', '');
    const curStr = GM_getValue('nfds_l1', DEFAULT_L1);
    const player = getPlayer();
    const tracks = getSelectableTracks(player);
    const options = buildLangOptionsFromTracks(tracks);
    const current = getCurrentTimedTextTrack(player);
    const defaultId =
      curId ||
      (current && current.trackId ? String(current.trackId) : '') ||
      (options[0]?.value || '');

    const chosen = await showSelectDialog({
      title: '选择 L1（上行字幕）',
      currentValue: defaultId,      // ✅ 用 trackId 作为默认选中
      options
    });

    if (chosen != null) {
      const tr = findTrackById(player, chosen);

      GM_setValue('nfds_l1_id', String(chosen)); // ✅ 保存 trackId
      GM_setValue('nfds_l1', (tr?.bcp47 || tr?.displayName || curStr)); // fallback

      setDisabled(false);
      await applyLangAndRestart();
    }
});

GM_registerMenuCommand('NF 双语字幕：设置 L2 (下行)', async () => {
    const curId = GM_getValue('nfds_l2_id', '');
    const curStr = GM_getValue('nfds_l2', DEFAULT_L2);
    const player = getPlayer();
    const tracks = getSelectableTracks(player);
    const options = buildLangOptionsFromTracks(tracks);
    const current = getCurrentTimedTextTrack(player);
    const defaultId =
      curId ||
      (current && current.trackId ? String(current.trackId) : '') ||
      (options[0]?.value || '');

    const chosen = await showSelectDialog({
      title: '选择 L2（下行字幕）',
      currentValue: defaultId,      // ✅ 用 trackId 作为默认选中
      options
    });

    if (chosen != null) {
      const tr = findTrackById(player, chosen);

      GM_setValue('nfds_l2_id', String(chosen));
      GM_setValue('nfds_l2', (tr?.bcp47 || tr?.displayName || curStr));

      setDisabled(false);
      await applyLangAndRestart();
    }
});

  GM_registerMenuCommand('NF 双语字幕：Re-init', async () => {
    stop();
    await start();
  });

  GM_registerMenuCommand('NF 双语字幕：Stop（恢复原生字幕）', () => {
    stop();
  });
    // ===== SPA URL change hook + auto attach/reinit =====
    function installUrlChangeHook() {
      if (history.__nfds_hooked) return;
      history.__nfds_hooked = true;

      const fire = () => window.dispatchEvent(new Event('nfds-urlchange'));
      const _push = history.pushState;
      const _replace = history.replaceState;

      history.pushState = function () { _push.apply(this, arguments); fire(); };
      history.replaceState = function () { _replace.apply(this, arguments); fire(); };
      window.addEventListener('popstate', fire);
    }

    async function maybeAutoAttach(reason = '') {
      if (isDisabled()) {
        if (running) stop();
        return;
      }

      if (!isWatch()) {
        if (running) stop();
        return;
      }

      // in /watch
      ensureOverlay();

      // 自动启动：解决“从首页进入播放页不启动”
      if (!running) {
        await start();
        return;
      }

      // 自动换集：video 节点替换 或 watchId 改变 => 自动 Re-init
      const curKey = location.pathname;
      const curVideo = document.querySelector('video');

      const changed =
        (lastWatchKey && curKey !== lastWatchKey) ||
        (lastVideoEl && curVideo && curVideo !== lastVideoEl);

      if (changed) {
        stop();
        await start();
      }
    }

    // boot
    (async () => {
      // wait DOM root
      for (let i = 0; i < 60; i++) {
        if (document.documentElement) break;
        await sleep(50);
      }

      installUrlChangeHook();

      window.addEventListener('nfds-urlchange', () => {
        // 不要 await，避免阻塞 Netflix 自己的路由；用任务队列跑
        setTimeout(() => { maybeAutoAttach('urlchange'); }, 0);
      });

      // watchdog：兜底，处理 auto-next 等不触发 urlchange 的情况
      setInterval(() => { maybeAutoAttach('watchdog'); }, 800);

      // first try
      await maybeAutoAttach('boot');
    })();

})();