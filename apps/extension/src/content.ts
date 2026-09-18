let lastUrl = location.href;

setInterval(() => {
  if (lastUrl === location.href) return;
  lastUrl = location.href;
  void chrome.runtime.sendMessage({ type: "PAGE_CHANGED", url: lastUrl });
}, 1_000);
