// FootBud ESPN draft bridge: MAIN-world tap on the draft room's WebSocket.
//
// ESPN delivers every pick (all teams, not just yours) over a WebSocket the
// page opens. This script runs in the page's own world before the room
// connects, wraps the WebSocket constructor, and forwards inbound message
// samples to the isolated content script via a DOM event. Nothing is sent
// anywhere except to the FootBud content script in this same tab.
(() => {
  const Orig = window.WebSocket;
  if (!Orig || Orig.__footbudWrapped) return;

  function Wrapped(url, protocols) {
    const ws = protocols !== undefined ? new Orig(url, protocols) : new Orig(url);
    const shortUrl = String(url).slice(0, 140);
    ws.addEventListener('message', (ev) => {
      try {
        const data = typeof ev.data === 'string' ? ev.data : '(binary message)';
        document.dispatchEvent(
          new CustomEvent('footbud-ws-message', {
            detail: { url: shortUrl, data: data.slice(0, 500) },
          }),
        );
      } catch {
        // Never interfere with the page's own handling.
      }
    });
    return ws;
  }
  Wrapped.prototype = Orig.prototype;
  for (const key of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) Wrapped[key] = Orig[key];
  Wrapped.__footbudWrapped = true;
  window.WebSocket = Wrapped;
})();
