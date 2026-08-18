// FootBud ESPN draft bridge: runs in the FootBud tab.
// Downstream: hands relayed picks, clock status, and pick results to the
// app, which listens for this exact message shape (see
// startEspnBridgeListener in src/store.ts). Upstream: forwards the app's
// pick and projection requests to the background worker.
//
// Security: only messages posted by this page itself, from this page's own
// origin, are accepted — a cross-origin iframe embedded in the page cannot
// trigger a pick submission or inject data.

const PAGE_ORIGIN = window.location.origin;

chrome.runtime.onMessage.addListener((message) => {
  if (!message) return;
  if (message.type === 'footbud-picks') {
    window.postMessage({ source: 'footbud-espn-bridge', picks: message.picks }, PAGE_ORIGIN);
  } else if (message.type === 'footbud-status') {
    window.postMessage({ source: 'footbud-espn-bridge', status: message.status }, PAGE_ORIGIN);
  } else if (message.type === 'footbud-pick-result') {
    window.postMessage(
      {
        source: 'footbud-espn-bridge',
        pickResult: { ok: message.ok === true, reason: message.reason ?? null, playerName: message.playerName ?? '' },
      },
      PAGE_ORIGIN,
    );
  }
});

window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== PAGE_ORIGIN) return;
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
          PAGE_ORIGIN,
        );
      })
      .catch(() => {});
  }
});
