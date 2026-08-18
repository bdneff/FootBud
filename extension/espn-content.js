// FootBud ESPN draft bridge: content script for the ESPN draft room.
//
// ESPN has no public draft API, so this script reads the pick history the
// draft room already renders in your browser and relays it to FootBud.
// EXPERIMENTAL: ESPN changes its markup without notice. If picks stop
// flowing, set DEBUG = true, open the console on the draft room tab, and
// adjust the selectors in findPickRows() below.

// Debug logging is ON by default while the parser is being calibrated
// against real draft rooms. Watch the console on the ESPN draft room tab.
const DEBUG = true;
const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'D/ST', 'DST'];
const POSITION_RE = new RegExp(`\\b(${POSITIONS.join('|').replace('/', '\\/')})\\b`);

function log(...args) {
  if (DEBUG) console.log('[footbud-bridge]', ...args);
}

// ---- Extension lifecycle guard ------------------------------------------
// When the extension is reloaded or updated (the refresh button on
// chrome://extensions), content scripts already running in open tabs are
// orphaned: their chrome.runtime dies and every sendMessage after that
// throws "Extension context invalidated" synchronously. An orphaned script
// cannot reconnect; the only fix is refreshing the tab. Detect the state
// once, stop all timers, and tell the user loudly with an on-page banner.
// Captured picks survive in sessionStorage across the refresh.

let contextDead = false;
let scanTimer = null;
let heartbeatTimer = null;
let observerRef = null;

function showReloadBanner() {
  try {
    if (document.getElementById('footbud-reload-banner')) return;
    const el = document.createElement('div');
    el.id = 'footbud-reload-banner';
    el.textContent =
      'FootBud lost its connection (the extension was reloaded or updated). Click here to refresh this tab and reconnect — captured picks are kept.';
    el.style.cssText =
      'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#b91c1c;color:#fff;' +
      'font:14px/1.5 system-ui,sans-serif;padding:9px 16px;text-align:center;cursor:pointer;';
    el.addEventListener('click', () => location.reload());
    (document.body || document.documentElement).appendChild(el);
  } catch {
    // Banner is best-effort; the console warning already fired.
  }
}

function markContextDead() {
  if (contextDead) return;
  contextDead = true;
  if (scanTimer) clearInterval(scanTimer);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (observerRef) {
    try {
      observerRef.disconnect();
    } catch {
      // Already gone.
    }
  }
  console.warn(
    '[footbud-bridge] The FootBud extension was reloaded or updated while this tab was open. ' +
      'Refresh this ESPN tab (and the FootBud tab) to reconnect. Captured picks are kept.',
  );
  showReloadBanner();
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

/** chrome.runtime.sendMessage that survives extension reloads instead of throwing. */
function safeSend(message, callback) {
  if (!extensionAlive()) return;
  try {
    if (callback) chrome.runtime.sendMessage(message, callback);
    else chrome.runtime.sendMessage(message).catch(() => {});
  } catch {
    markContextDead();
  }
}

// Strategy: collect candidate rows from any element that looks like a pick
// entry. Calibrated against a live 2026 draft room, which renders picks as
// <li class="picklist--item picklist--pick"> inside UL.picklist; older
// table-based shapes are kept as fallbacks. A row only counts once a player
// is actually in it (a playername child or position text), so the pre-pick
// team-name rows and the upcoming "pick train" are ignored.
function findPickRows() {
  const selectors = [
    '[class*="pick-history"] li',
    '[class*="pick-history"] tr',
    '[class*="pickHistory"] li',
    '[class*="pickHistory"] tr',
    '[class*="history"] li',
    '[class*="history"] tr',
    'li[class*="picklist--pick"]',
    '[class*="picklist"] li',
    '[class*="draft-history"] tr',
    '[class*="pick-cell"]',
    '[class*="pickCell"]',
    'table tr',
  ];
  const PICK_NUMBER_RE = /PICK\s*\d+|R(?:ND)?\s*\d+\s*,?\s*P(?:ICK)?\s*\d+|^\s*\d+\.\d+/i;
  for (const selector of selectors) {
    const rows = [...document.querySelectorAll(selector)].filter(
      (row) =>
        row.querySelector('[class*="playername"], [class*="playerName"]') ||
        POSITION_RE.test(row.textContent || ''),
    );
    if (rows.length === 0) continue;
    // Real pick rows carry pick numbering somewhere; the available-players
    // list (also full of names and positions) does not. Skip selectors
    // whose rows never show a pick number so we never mistake the player
    // pool for the pick history.
    if (!rows.some((row) => PICK_NUMBER_RE.test(row.textContent || ''))) {
      log(`selector "${selector}" matched ${rows.length} rows but none carry pick numbers; skipping`);
      continue;
    }
    log(`selector "${selector}" matched ${rows.length} rows`);
    return rows;
  }
  return [];
}

// Parse one pick row. Preferred path: ESPN's playerinfo child elements
// (playerinfo__playername etc.); fallback: text heuristics for older
// table layouts ("1.1 Bijan Robinson RB ATL" / "R1, P1 ...").
function parseRow(row, index) {
  const text = (row.textContent || '').replace(/\s+/g, ' ').trim();

  const nameEl = row.querySelector('[class*="playername"], [class*="playerName"]');
  const posEl = row.querySelector('[class*="playerpos"], [class*="playerPos"], [class*="position"]');
  const teamEl = row.querySelector('[class*="playerteam"], [class*="playerTeam"], [class*="pro-team"]');

  let name = nameEl ? nameEl.textContent.replace(/\s+/g, ' ').trim() : null;
  let position = null;
  const posText = posEl ? posEl.textContent : text;
  const posMatch = (posText || '').match(POSITION_RE);
  if (posMatch) position = posMatch[1] === 'D/ST' ? 'DST' : posMatch[1];

  if (!name) {
    // Text-only fallback needs a position token to anchor on.
    if (!posMatch || posText !== text) return null;
    const before = text.slice(0, posMatch.index).replace(/^[\d.,RP\s]+/i, '').trim();
    name = before.split(/\s{2,}/)[0].trim();
  }
  if (!name) return null;
  // ESPN writes defenses as "Bears D/ST"; normalize the suffix.
  name = name.replace(/\s*D\/ST\s*$/i, ' DST').trim();

  // Overall pick number: "PICK 12" (current picklist), "R1, P5", "1.5",
  // or a leading integer. Per-round numbering is fixed up in scan().
  let overall = null;
  const teams = window.__footbudTeams || 0;
  const pickWord = text.match(/PICK\s*(\d+)/i);
  const rp = text.match(/R(?:ND)?\s*(\d+),?\s*P(?:ICK)?\s*(\d+)/i);
  const dot = text.match(/^(\d+)\.(\d+)\b/);
  if (rp && teams) overall = (Number(rp[1]) - 1) * teams + Number(rp[2]);
  else if (pickWord) overall = Number(pickWord[1]);
  else if (dot && teams) overall = (Number(dot[1]) - 1) * teams + Number(dot[2]);
  else {
    const lead = text.match(/^(\d+)\b/);
    if (lead) overall = Number(lead[1]);
  }
  if (!overall) overall = index + 1; // fall back to row order

  const team = teamEl ? teamEl.textContent.replace(/\s+/g, ' ').trim() : null;
  return { overall, slot: 0, playerName: name, position, team };
}

// ---- Announcement capture ----------------------------------------------
// ESPN shows every completed pick as a card in the pickArea:
//   <div class="player-drafted"> "You drafted Ja'Marr Chase!" /
//   "Shyte Mate drafted Bijan Robinson!" with "Cincinnati Bengals / WR"
// in a child <p>. Cards are transient, so each one is captured as it
// appears, numbered from the "On the Clock: Pick N" counter, and the
// accumulated list persists in sessionStorage across page refreshes.
// This works with no history tab open; row-based history, when visible,
// stays preferred because it is authoritative.

const STORE_KEY = 'footbud-captured-picks:' + location.search;
let captured = {};
try {
  captured = JSON.parse(sessionStorage.getItem(STORE_KEY) || '{}');
} catch {
  captured = {};
}

function currentClockPick() {
  const el = document.querySelector('[class*="current-pick"]');
  const m = el && (el.textContent || '').match(/Pick\s*(\d+)/i);
  return m ? Number(m[1]) : null;
}

function captureAnnouncements() {
  const cards = document.querySelectorAll('[class*="player-drafted"], [class*="playerDrafted"]');
  for (const card of cards) {
    const text = (card.textContent || '').replace(/\s+/g, ' ').trim();
    const m = text.match(/drafted\s+(.+?)!/i);
    if (!m) continue;
    let name = m[1].trim().replace(/\s*D\/ST\s*$/i, ' DST');
    if (!name) continue;
    if (Object.values(captured).some((p) => p.playerName === name)) continue;

    let position = null;
    let team = null;
    const meta = card.querySelector('p');
    const metaText = meta ? (meta.textContent || '').replace(/\s+/g, ' ').trim() : '';
    const pm = (metaText || text).match(POSITION_RE);
    if (pm) position = pm[1] === 'D/ST' ? 'DST' : pm[1];
    if (metaText.includes('/')) team = metaText.split('/')[0].trim();

    // The card announces the pick made just before the one now on the clock.
    const clock = currentClockPick();
    const lastCaptured = Math.max(0, ...Object.keys(captured).map(Number));
    let overall = clock !== null ? clock - 1 : lastCaptured + 1;
    if (overall < 1) overall = 1;
    if (captured[overall]) overall = lastCaptured + 1; // clock raced ahead
    captured[overall] = { overall, slot: 0, playerName: name, position, team };
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify(captured));
    } catch {
      // Storage full or unavailable: in-memory capture still works.
    }
    log('captured announcement:', overall, name, position ?? '?');
  }
}

let lastSent = '';
let lastEmptyLog = 0;

function scan() {
  captureAnnouncements();
  const rows = findPickRows();
  if (DEBUG && rows.length === 0 && Object.keys(captured).length === 0 && Date.now() - lastEmptyLog > 15000) {
    lastEmptyLog = Date.now();
    // Fingerprint wherever drafted players actually render: small elements
    // whose text carries a position token, with their ancestor chain, so the
    // right selector can be written no matter what ESPN calls the container.
    const hits = [];
    for (const el of document.querySelectorAll('body *')) {
      if (hits.length >= 8) break;
      if (el.children.length > 2) continue;
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (text.length < 3 || text.length > 60 || !POSITION_RE.test(text)) continue;
      let chain = `${el.tagName}.${String(el.className).slice(0, 50)}`;
      let node = el.parentElement;
      for (let depth = 0; node && depth < 4; depth++) {
        chain = `${node.tagName}.${String(node.className).slice(0, 50)} > ${chain}`;
        node = node.parentElement;
      }
      hits.push(`${chain} :: "${text.slice(0, 60)}"`);
    }
    if (hits.length === 0) {
      log('no drafted players visible in the page yet. If picks HAVE been made, picks will be captured from the announcement cards as they appear; earlier picks made before the extension loaded cannot be recovered — refresh guidance: start the extension before the draft begins.');
    } else {
      log('found player-like elements but no selector matched their rows. Paste this diagnostic:\n' + hits.join('\n'));
    }
  }
  if (DEBUG && rows.length > 0) {
    log('sample row texts:', rows.slice(0, 3).map((r) => (r.textContent || '').replace(/\s+/g, ' ').slice(0, 100)));
  }
  let picks = rows.map((row, i) => parseRow(row, i)).filter(Boolean);
  // If ESPN numbers picks per round ("PICK 1" restarting each round), the
  // parsed overalls will not be strictly increasing in row order; the row
  // order itself is the true draft order, so renumber from it.
  const increasing = picks.every((p, i) => i === 0 || p.overall > picks[i - 1].overall);
  if (!increasing) {
    log('pick numbers not strictly increasing (per-round numbering); using row order');
    picks = picks.map((p, i) => ({ ...p, overall: i + 1 }));
  }
  picks.sort((a, b) => a.overall - b.overall);
  // Deduplicate by overall (some layouts render a row twice).
  picks = picks.filter((p, i, arr) => i === 0 || arr[i - 1].overall !== p.overall);
  // Source priority: the draft socket sees every pick by every team, so it
  // wins whenever it has the most complete list; announcement cards and
  // history rows remain as fallbacks.
  const announced = Object.values(captured).sort((a, b) => a.overall - b.overall);
  if (picks.length < announced.length) picks = announced;
  const fromSocket = resolvedSocketPicks();
  if (fromSocket.length >= picks.length) picks = fromSocket;
  if (picks.length === 0) return;
  const fingerprint = JSON.stringify(picks.map((p) => [p.overall, p.playerName]));
  if (fingerprint === lastSent) return;
  lastSent = fingerprint;
  log('sending picks:', picks.map((p) => `${p.overall} ${p.playerName} ${p.position ?? '?'}`));
  safeSend({ type: 'footbud-picks', picks });
}

// Team count improves round/pick math; FootBud can not tell us, so read it
// from the draft board header if present (count of team columns).
function detectTeams() {
  const headers = document.querySelectorAll('[class*="draft-board"] th, [class*="draftBoard"] th');
  if (headers.length > 2) window.__footbudTeams = headers.length - 1;
}

// ---- Discovery probes ---------------------------------------------------
// Opponent and autodraft picks do not produce the "You drafted" card, so
// two probes find where they DO surface:
// 1. WebSocket tap (espn-main.js wraps the page's WebSocket and forwards
//    message samples): every pick must arrive through the socket.
// 2. DOM sniffer: logs any newly added element whose text carries a player
//    position, the moment it appears.
// Paste the [footbud-bridge] ws/new-element lines that show up right after
// an opponent's pick; they are the calibration data for a full parser.

// ---- Socket pick capture (primary source) -------------------------------
// The draft socket speaks a simple text protocol; every pick by every team
// arrives as:   SELECTED <teamId> <playerId> <overall> {memberGUID}
// The id is ESPN's player id (negative ids are D/ST). Names come from the
// player directory served by the background worker. The frame's own overall
// pick number is trusted when it forms a sane increasing sequence (arrival
// order is only the fallback), and round-1 frames teach the teamId -> draft
// slot mapping. Persistence is keyed by the league id from the socket URL so
// tab refreshes and rejoin URLs keep the same sequence.

let socketKey = 'footbud-socket-picks:' + location.search;
let socketPicks = [];
function loadSocketPicks() {
  try {
    socketPicks = JSON.parse(sessionStorage.getItem(socketKey) || '[]');
  } catch {
    socketPicks = [];
  }
}
loadSocketPicks();

/** teamId -> draft slot, learned from round-1 SELECTED frames. */
let teamSlotMap = {};
let numberingDegraded = false;

const SEASON = (() => {
  const now = new Date();
  return now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
})();

let playerMap = null;
let playerMapRequested = false;
function ensurePlayerMap() {
  if (playerMap || playerMapRequested) return;
  playerMapRequested = true;
  safeSend({ type: 'footbud-need-players', season: SEASON }, (resp) => {
    const err = chrome.runtime && chrome.runtime.lastError;
    if (err) {
      log('player directory request failed:', err.message);
      playerMapRequested = false; // retry on a later message
      return;
    }
    if (resp && resp.players) {
      playerMap = resp.players;
      log(`player directory loaded: ${Object.keys(playerMap).length} players`);
      scan();
    } else {
      log('player directory failed to load:', resp && resp.error);
      playerMapRequested = false; // retry on a later message
    }
  });
}

function recordSocketPick(playerId, frameOverall, teamId) {
  if (socketPicks.some((p) => p.playerId === playerId)) return;
  const lastOverall = socketPicks.length ? socketPicks[socketPicks.length - 1].overall : 0;
  // Trust the frame's own pick number when it is sane and advances the
  // sequence; otherwise fall back to arrival order and flag it so the app
  // can warn instead of silently misattributing every roster.
  let overall;
  if (Number.isInteger(frameOverall) && frameOverall > lastOverall && frameOverall <= 600) {
    overall = frameOverall;
  } else {
    overall = lastOverall + 1;
    if (Number.isInteger(frameOverall)) {
      numberingDegraded = true;
      log(`frame pick number ${frameOverall} did not fit the sequence (last ${lastOverall}); using arrival order`);
    }
  }
  // Round-1 frames map team ids to draft slots: the k-th overall pick of
  // round 1 belongs to slot k. Only trust a clean from-the-start capture.
  if (
    Number.isInteger(teamId) &&
    !(teamId in teamSlotMap) &&
    overall === Object.keys(teamSlotMap).length + 1
  ) {
    teamSlotMap[teamId] = overall;
    if (teamId === myTeamId) log(`your draft slot is ${overall} (from round-1 order)`);
  }
  socketPicks.push({ overall, playerId, teamId: Number.isInteger(teamId) ? teamId : null });
  try {
    sessionStorage.setItem(socketKey, JSON.stringify(socketPicks));
  } catch {
    // In-memory list still works.
  }
  const info = playerMap && playerMap[playerId];
  log(`socket pick ${overall}: id ${playerId}${info ? ` -> ${info.name} ${info.position ?? ''}` : ' (name pending directory)'}`);
}

function resolvedSocketPicks() {
  if (socketPicks.length === 0) return [];
  if (!playerMap) {
    ensurePlayerMap();
    return [];
  }
  return socketPicks.map((p) => {
    const info = playerMap[p.playerId];
    const slot = p.teamId !== null && teamSlotMap[p.teamId] ? teamSlotMap[p.teamId] : 0;
    return {
      overall: p.overall,
      slot,
      playerName: info ? info.name : `ESPN player ${p.playerId}`,
      position: info ? info.position : null,
      team: info ? info.team : null,
    };
  });
}

let wsLogCount = 0;
let wsLogWindowStart = 0;
// ---- Clock / on-the-clock status ---------------------------------------
// CLOCK <n> <msRemaining> <teamId> ticks every ~5s for the team on the
// clock; SELECTING <teamId> <allottedMs> announces a new turn. The JOIN
// URL's numbered param 3 is our own team id, so the two together tell
// FootBud whether it is our pick and how much time is left.

let myTeamId = null;
let clockState = { onClockTeamId: null, msRemaining: null, at: 0 };
let lastStatusSent = 0;

function pushStatus(force) {
  const now = Date.now();
  if (!force && now - lastStatusSent < 1000) return;
  lastStatusSent = now;
  safeSend({
    type: 'footbud-status',
    status: {
      myTeamId,
      onClockTeamId: clockState.onClockTeamId,
      yourTurn:
        myTeamId !== null &&
        clockState.onClockTeamId !== null &&
        myTeamId === clockState.onClockTeamId,
      msRemaining: clockState.msRemaining,
      at: clockState.at,
      // Your draft slot, once round-1 frames have taught it.
      mySlot: myTeamId !== null && teamSlotMap[myTeamId] ? teamSlotMap[myTeamId] : null,
      numberingDegraded,
    },
  });
}

// Heartbeat so FootBud can detect a dead feed (closed tab, dropped socket):
// while the draft socket has been seen, a status goes out at least every 5s.
heartbeatTimer = setInterval(() => {
  if (draftSocketSeen) pushStatus(true);
}, 5000);

let draftSocketSeen = false;
document.addEventListener('footbud-ws-message', (event) => {
  const detail = event.detail || {};
  const data = String(detail.data || '').trim();
  const url = String(detail.url || '');

  // The draft feed lives on fantasydraft.espn.com; everything else on the
  // page (telemetry etc.) is ignored for pick parsing.
  const isDraftSocket = url.includes('fantasydraft');
  if (isDraftSocket && !draftSocketSeen) {
    draftSocketSeen = true;
    const teamMatch = url.match(/[?&]3=(\d+)/);
    if (teamMatch) myTeamId = Number(teamMatch[1]);
    // Key persistence by league id so refreshes and rejoin URLs (whose query
    // strings differ) continue the same pick sequence.
    const leagueMatch = url.match(/league-(\d+)/);
    if (leagueMatch) {
      socketKey = 'footbud-socket-picks:league-' + leagueMatch[1];
      loadSocketPicks();
    }
    log('draft socket connected:', url.slice(0, 90), '| my team id:', myTeamId ?? 'unknown');
    ensurePlayerMap();
  }

  const parts = data.split(/\s+/);
  // SELECTED <teamId> <playerId> <overall> {memberGUID}
  if (isDraftSocket && parts[0] === 'SELECTED' && parts.length >= 3 && /^-?\d+$/.test(parts[2])) {
    ensurePlayerMap();
    const teamId = /^\d+$/.test(parts[1] ?? '') ? Number(parts[1]) : null;
    const frameOverall = /^\d+$/.test(parts[3] ?? '') ? Number(parts[3]) : null;
    recordSocketPick(Number(parts[2]), frameOverall, teamId);
    // The turn is over until the next SELECTING arrives.
    clockState = { onClockTeamId: null, msRemaining: null, at: Date.now() };
    pushStatus(true);
    scan();
    return;
  }
  if (isDraftSocket && parts[0] === 'SELECTING' && parts.length >= 3) {
    clockState = { onClockTeamId: Number(parts[1]), msRemaining: Number(parts[2]), at: Date.now() };
    pushStatus(true);
    return;
  }
  if (isDraftSocket && parts[0] === 'CLOCK' && parts.length >= 4) {
    clockState = { onClockTeamId: Number(parts[3]), msRemaining: Number(parts[2]), at: Date.now() };
    pushStatus(false);
    return;
  }

  if (!DEBUG) return;
  if (parts[0] === 'CLOCK' || parts[0] === 'PING' || parts[0] === 'PONG') return; // ticks are noise
  const now = Date.now();
  if (now - wsLogWindowStart > 10000) {
    wsLogWindowStart = now;
    wsLogCount = 0;
  }
  if (wsLogCount >= 20) return; // cap the flood; samples are what matter
  wsLogCount++;
  log('ws:', String(detail.url || ''), '::', data.slice(0, 200));
});

const sniffSeen = new Set();
function sniffMutations(mutations) {
  if (!DEBUG) return;
  let logged = 0;
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (logged >= 3) return;
      if (!(node instanceof HTMLElement)) continue;
      const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
      if (text.length < 4 || text.length > 180 || !POSITION_RE.test(text)) continue;
      const key = text.slice(0, 60);
      if (sniffSeen.has(key)) continue;
      sniffSeen.add(key);
      let chain = `${node.tagName}.${String(node.className).slice(0, 40)}`;
      let parent = node.parentElement;
      for (let depth = 0; parent && depth < 3; depth++) {
        chain = `${parent.tagName}.${String(parent.className).slice(0, 40)} > ${chain}`;
        parent = parent.parentElement;
      }
      log('new element:', chain, '::', text.slice(0, 140));
      logged++;
    }
  }
}

// ---- Pick submission from FootBud ---------------------------------------
// FootBud sends the chosen player's name/position; we resolve it to an
// ESPN player id via the directory and hand the SELECT to the MAIN-world
// tap. Guarded: only when the draft socket says it is actually our turn.

function normalizeName(name) {
  return String(name)
    .toLowerCase()
    .replace(/\bd\/st\b/g, 'dst')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '')
    .replace(/[^a-z0-9 ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveEspnPlayerId(playerName, position) {
  if (!playerMap) return null;
  const want = normalizeName(playerName);
  let fallback = null;
  for (const [id, info] of Object.entries(playerMap)) {
    if (normalizeName(info.name) !== want) continue;
    if (position && info.position && info.position !== position) {
      fallback = Number(id);
      continue;
    }
    return Number(id);
  }
  return fallback;
}

/** Report a pick submission outcome back to the FootBud tab. */
function reportPickResult(ok, reason, playerName) {
  log(ok ? `SELECT sent for ${playerName}` : `pick failed: ${reason}`);
  safeSend({ type: 'footbud-pick-result', ok, reason: reason ?? null, playerName });
}

let pendingPickName = null;
document.addEventListener('footbud-select-result', (event) => {
  const d = (event && event.detail) || {};
  reportPickResult(
    d.ok === true,
    d.ok === true ? null : `ESPN draft socket rejected the pick (${d.reason}).`,
    pendingPickName ?? `player ${d.playerId}`,
  );
  pendingPickName = null;
});

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== 'footbud-do-pick') return;
  const name = String(message.playerName ?? '');
  const yourTurn =
    myTeamId !== null &&
    clockState.onClockTeamId !== null &&
    myTeamId === clockState.onClockTeamId;
  if (!yourTurn) {
    reportPickResult(false, 'ESPN says it is not your turn right now.', name);
    return;
  }
  const id = resolveEspnPlayerId(message.playerName, message.position);
  if (id === null) {
    reportPickResult(
      false,
      `Could not match "${name}" to an ESPN player — make this pick in the ESPN tab.`,
      name,
    );
    return;
  }
  log(`submitting pick: ${name} (ESPN id ${id})`);
  pendingPickName = name;
  document.dispatchEvent(new CustomEvent('footbud-send-select', { detail: { playerId: id } }));
});

const observer = new MutationObserver((mutations) => {
  if (contextDead) return;
  sniffMutations(mutations);
  detectTeams();
  scan();
});
observerRef = observer;
observer.observe(document.body, { childList: true, subtree: true, characterData: true });
scanTimer = setInterval(scan, 4000);
log('FootBud ESPN bridge active');
