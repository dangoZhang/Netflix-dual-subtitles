(() => {
  if (window.__NFDS_EXTENSION_BRIDGE__) {
    return;
  }

  window.__NFDS_EXTENSION_BRIDGE__ = true;

  const runtimeApi = typeof browser !== 'undefined' ? browser : chrome;
  const injectedScript = document.createElement('script');
  injectedScript.src = runtimeApi.runtime.getURL('injected.js');
  injectedScript.async = false;
  injectedScript.dataset.source = 'netflix-dual-subtitles';

  const root = document.documentElement || document.head || document.body;
  root.appendChild(injectedScript);
  injectedScript.remove();
})();
