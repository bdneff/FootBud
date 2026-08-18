// FootBud ESPN draft bridge: runs in the FootBud tab and hands relayed
// picks to the app, which listens for this exact message shape (see
// startEspnBridgeListener in src/store.ts).
chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== 'footbud-picks') return;
  window.postMessage({ source: 'footbud-espn-bridge', picks: message.picks }, '*');
});
