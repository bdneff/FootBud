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

// When the extension is reloaded or updated while this tab is open, this
// script is orphaned: chrome.runtime dies and sendMessage throws
// "Extension context invalidated" synchronously. Detect it, stop, and tell
// the app so the user sees a real error instead of silence.
let contextDead = false;

function markContextDead() {
  if (contextDead) return;
  contextDead = true;
  console.warn(
    '[footbud-bridge] The FootBud extension was reloaded or updated. Refresh this FootBud tab to reconnect.',
  );
}

function extensionAlive() {
  if (contextDead) return false;
  try {
    if (chrome.runtime && chrome.runtime.id) return true;
  } catch {
    // Accessing chrome.runtime on an orphaned script can itself throw.
  }
  markContextDead();
  return false;
}

/** sendMessage that survives extension reloads. Returns the promise or null. */
function safeSend(message) {
  if (!extensionAlive()) return null;
  try {
    return chrome.runtime.sendMessage(message);
  } catch {
    markContextDead();
    return null;
  }
}

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
    const sent = safeSend({
      type: 'footbud-make-pick',
      playerName: data.playerName,
      position: typeof data.position === 'string' ? data.position : null,
    });
    if (sent === null) {
      // Orphaned script: surface a real failure so the app clears its
      // pending state and the user makes the pick in the ESPN tab.
      window.postMessage(
        {
          source: 'footbud-espn-bridge',
          pickResult: {
            ok: false,
            reason:
              'The FootBud extension was reloaded — refresh this page (and the ESPN tab) to reconnect, and make this pick in the ESPN tab.',
            playerName: data.playerName,
          },
        },
        PAGE_ORIGIN,
      );
    } else {
      sent.catch(() => {});
    }
    return;
  }

  if (data.type === 'request-projections' && typeof data.season === 'number') {
    const sent = safeSend({ type: 'footbud-need-projections', season: data.season });
    if (sent === null) {
      window.postMessage(
        {
          source: 'footbud-espn-bridge',
          projections: null,
          projectionsSeason: data.season,
          projectionsError:
            'The FootBud extension was reloaded — refresh this page to reconnect.',
        },
        PAGE_ORIGIN,
      );
      return;
    }
    sent
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
