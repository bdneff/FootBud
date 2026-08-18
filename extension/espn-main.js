// FootBud ESPN draft bridge: MAIN-world tap on the draft room's WebSocket.
//
// ESPN delivers every pick (all teams, not just yours) over a WebSocket the
// page opens (wss://fantasydraft.espn.com/.../JOIN?...). This script runs
// in the page's own world before the room connects, wraps the WebSocket
// constructor, forwards inbound messages to the isolated content script via
// a DOM event, and keeps a reference to the draft socket so FootBud can
// submit a pick (the protocol's outgoing frame is "SELECT <playerId>").
// Nothing is sent anywhere except to/from the FootBud content script in
// this same tab.
(() => {
  const Orig = window.WebSocket;
  if (!Orig || Orig.__footbudWrapped) return;

  let draftSocket = null;

  function Wrapped(url, protocols) {
    const ws = protocols !== undefined ? new Orig(url, protocols) : new Orig(url);
    const shortUrl = String(url).slice(0, 200);
    if (shortUrl.includes('fantasydraft')) draftSocket = ws;
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

  // Pick submission from FootBud (via the content script). Only ever sends
  // the protocol's own SELECT frame, and only on an open draft socket.
  document.addEventListener('footbud-send-select', (event) => {
    const playerId = event && event.detail && event.detail.playerId;
    if (typeof playerId !== 'number' && typeof playerId !== 'string') return;
    let ok = false;
    let reason = '';
    if (!draftSocket) reason = 'no draft socket';
    else if (draftSocket.readyState !== Orig.OPEN) reason = 'draft socket not open';
    else {
      try {
        draftSocket.send(`SELECT ${playerId}`);
        ok = true;
      } catch (e) {
        reason = String(e && e.message ? e.message : e);
      }
    }
    document.dispatchEvent(
      new CustomEvent('footbud-select-result', { detail: { playerId, ok, reason } }),
    );
  });
})();
