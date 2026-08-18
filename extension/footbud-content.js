// FootBud ESPN draft bridge: runs in the FootBud tab.
// Downstream: hands relayed picks and clock status to the app, which
// listens for this exact message shape (see startEspnBridgeListener in
// src/store.ts). Upstream: forwards the app's pick requests to the
// background worker, which routes them to the ESPN draft room tab.

chrome.runtime.onMessage.addListener((message) => {
  if (!message) return;
  if (message.type === 'footbud-picks') {
    window.postMessage({ source: 'footbud-espn-bridge', picks: message.picks }, '*');
  } else if (message.type === 'footbud-status') {
    window.postMessage({ source: 'footbud-espn-bridge', status: message.status }, '*');
  }
});

window.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.source !== 'footbud-app') return;

  if (data.type === 'make-pick' && typeof data.playerName === 'string') {
    chrome.runtime
      .sendMessage({
        type: 'footbud-make-pick',
        playerName: data.playerName,
        position: typeof data.position === 'string' ? data.position : null,
      })
      .catch(() => {});
    return;
  }

  if (data.type === 'request-projections' && typeof data.season === 'number') {
    chrome.runtime
      .sendMessage({ type: 'footbud-need-projections', season: data.season })
      .then((resp) => {
        window.postMessage(
          {
            source: 'footbud-espn-bridge',
            projections: resp && resp.payload ? resp.payload : null,
            projectionsSeason: resp && resp.season,
            projectionsError: resp && resp.error ? resp.error : null,
          },
          '*',
        );
      })
      .catch(() => {});
  }
});
