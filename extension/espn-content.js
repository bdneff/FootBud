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
  // No visible history rows: fall back to the accumulated announcements.
  const announced = Object.values(captured).sort((a, b) => a.overall - b.overall);
  if (picks.length < announced.length) picks = announced;
  if (picks.length === 0) return;
  const fingerprint = JSON.stringify(picks.map((p) => [p.overall, p.playerName]));
  if (fingerprint === lastSent) return;
  lastSent = fingerprint;
  log('sending picks:', picks.map((p) => `${p.overall} ${p.playerName} ${p.position ?? '?'}`));
  chrome.runtime.sendMessage({ type: 'footbud-picks', picks }).catch(() => {});
}

// Team count improves round/pick math; FootBud can not tell us, so read it
// from the draft board header if present (count of team columns).
function detectTeams() {
  const headers = document.querySelectorAll('[class*="draft-board"] th, [class*="draftBoard"] th');
  if (headers.length > 2) window.__footbudTeams = headers.length - 1;
}

const observer = new MutationObserver(() => {
  detectTeams();
  scan();
});
observer.observe(document.body, { childList: true, subtree: true, characterData: true });
setInterval(scan, 4000);
log('FootBud ESPN bridge active');
