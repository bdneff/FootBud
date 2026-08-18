// FootBud ESPN draft bridge: content script for the ESPN draft room.
//
// ESPN has no public draft API, so this script reads the pick history the
// draft room already renders in your browser and relays it to FootBud.
// EXPERIMENTAL: ESPN changes its markup without notice. If picks stop
// flowing, set DEBUG = true, open the console on the draft room tab, and
// adjust the selectors in findPickRows() below.

const DEBUG = false;
const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'D/ST', 'DST'];
const POSITION_RE = new RegExp(`\\b(${POSITIONS.join('|').replace('/', '\\/')})\\b`);

function log(...args) {
  if (DEBUG) console.log('[footbud-bridge]', ...args);
}

// Strategy: collect candidate rows from any element that looks like a pick
// history entry. ESPN has rendered pick history as tables and as list items
// across seasons, so we try several shapes and keep whichever parses.
function findPickRows() {
  const selectors = [
    '[class*="pick-history"] tr',
    '[class*="pickHistory"] tr',
    '[class*="pick-history"] li',
    '[class*="draft-history"] tr',
    'table tr',
  ];
  for (const selector of selectors) {
    const rows = [...document.querySelectorAll(selector)].filter((row) =>
      POSITION_RE.test(row.textContent || ''),
    );
    if (rows.length > 0) {
      log(`selector "${selector}" matched ${rows.length} rows`);
      return rows;
    }
  }
  return [];
}

// Parse one row of pick-history text into a pick. Expected text shapes:
//   "1.1 Bijan Robinson RB ATL Team Name"  |  "R1, P1 Bijan Robinson ATL RB"
function parseRow(row, index) {
  const text = (row.textContent || '').replace(/\s+/g, ' ').trim();
  const posMatch = text.match(POSITION_RE);
  if (!posMatch) return null;
  const position = posMatch[1] === 'D/ST' ? 'DST' : posMatch[1];

  // Overall pick number: "R1, P5" or "1.5" or a leading integer.
  let overall = null;
  const rp = text.match(/R(\d+),?\s*P(\d+)/i);
  const dot = text.match(/^(\d+)\.(\d+)\b/);
  const teams = window.__footbudTeams || 0;
  if (rp && teams) overall = (Number(rp[1]) - 1) * teams + Number(rp[2]);
  else if (dot && teams) overall = (Number(dot[1]) - 1) * teams + Number(dot[2]);
  else {
    const lead = text.match(/^(\d+)\b/);
    if (lead) overall = Number(lead[1]);
  }
  if (!overall) overall = index + 1; // fall back to row order

  // Player name: text before the position token, minus pick numbering.
  const before = text.slice(0, posMatch.index).replace(/^[\d.,RP\s]+/i, '').trim();
  const name = before.split(/\s{2,}/)[0].trim();
  if (!name) return null;

  return { overall, slot: 0, playerName: name, position, team: null };
}

let lastSent = '';

function scan() {
  const rows = findPickRows();
  const picks = rows
    .map((row, i) => parseRow(row, i))
    .filter(Boolean)
    .sort((a, b) => a.overall - b.overall)
    // Deduplicate by overall (some layouts render a row twice).
    .filter((p, i, arr) => i === 0 || arr[i - 1].overall !== p.overall);
  if (picks.length === 0) return;
  const fingerprint = JSON.stringify(picks.map((p) => [p.overall, p.playerName]));
  if (fingerprint === lastSent) return;
  lastSent = fingerprint;
  log('sending', picks.length, 'picks');
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
