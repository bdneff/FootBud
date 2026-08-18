// FootBud ESPN draft bridge: service worker.
// 1. Relays picks from the ESPN draft room content script to FootBud tabs.
// 2. Serves the ESPN player directory (id -> name/position/team) so socket
//    pick messages, which carry only player ids, can be translated. The
//    fetch runs here because the service worker's host permission exempts
//    it from CORS; it uses the user's own logged-in ESPN session.

const POSITION_BY_ID = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DST' };
const TEAM_BY_ID = {
  0: 'FA', 1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN',
  8: 'DET', 9: 'GB', 10: 'TEN', 11: 'IND', 12: 'KC', 13: 'LV', 14: 'LAR', 15: 'MIA',
  16: 'MIN', 17: 'NE', 18: 'NO', 19: 'NYG', 20: 'NYJ', 21: 'PHI', 22: 'ARI', 23: 'PIT',
  24: 'LAC', 25: 'SF', 26: 'SEA', 27: 'TB', 28: 'WAS', 29: 'CAR', 30: 'JAX', 33: 'BAL',
  34: 'HOU',
};

let playerMapPromise = null;

async function fetchPlayerMap(season) {
  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/players?scoringPeriodId=0&view=players_wl`;
  const res = await fetch(url, {
    headers: { 'x-fantasy-filter': JSON.stringify({ filterActive: { value: true } }) },
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`players endpoint responded ${res.status}`);
  const list = await res.json();
  if (!Array.isArray(list) || list.length < 100) {
    throw new Error('players endpoint returned an unexpected shape');
  }
  const map = {};
  for (const p of list) {
    if (typeof p?.id !== 'number' || !p.fullName) continue;
    map[p.id] = {
      name: p.fullName.replace(/\s*D\/ST\s*$/i, ' DST'),
      position: POSITION_BY_ID[p.defaultPositionId] ?? null,
      team: TEAM_BY_ID[p.proTeamId ?? 0] ?? null,
    };
  }
  return map;
}

function getPlayerMap(season) {
  if (!playerMapPromise) {
    playerMapPromise = fetchPlayerMap(season).catch(async (firstError) => {
      // Preseason edge: this season's list may not exist yet.
      try {
        return await fetchPlayerMap(season - 1);
      } catch {
        playerMapPromise = null; // allow a retry later
        throw firstError;
      }
    });
  }
  return playerMapPromise;
}

/** Tab id of the ESPN draft room, learned from its own messages. */
let espnTabId = null;

function broadcastPickFailure(playerName, reason) {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.id === undefined) continue;
      chrome.tabs
        .sendMessage(tab.id, {
          type: 'footbud-pick-result',
          ok: false,
          reason,
          playerName: String(playerName ?? ''),
        })
        .catch(() => {});
    }
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return undefined;

  // Draft-room -> FootBud broadcasts (picks, clock status, pick results).
  if (
    message.type === 'footbud-picks' ||
    message.type === 'footbud-status' ||
    message.type === 'footbud-pick-result'
  ) {
    if (sender.tab?.id !== undefined) espnTabId = sender.tab.id;
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        if (tab.id === undefined || tab.id === sender.tab?.id) continue;
        chrome.tabs.sendMessage(tab.id, message).catch(() => {
          // Tab without the FootBud content script; ignore.
        });
      }
    });
    return undefined;
  }

  // FootBud -> draft room: submit a pick. A missing draft-room tab is a
  // failure the user must hear about, not a silent drop.
  if (message.type === 'footbud-make-pick') {
    if (espnTabId !== null) {
      chrome.tabs.sendMessage(espnTabId, { ...message, type: 'footbud-do-pick' }).catch(() => {
        broadcastPickFailure(message.playerName, 'The ESPN draft room tab did not respond.');
      });
    } else {
      broadcastPickFailure(
        message.playerName,
        'No ESPN draft room tab found — make this pick in the ESPN tab.',
      );
    }
    return undefined;
  }

  if (message.type === 'footbud-need-players') {
    getPlayerMap(message.season)
      .then((players) => sendResponse({ players }))
      .catch((e) => sendResponse({ error: e instanceof Error ? e.message : String(e) }));
    return true; // async response
  }

  // Full projections + ADP payload (kona_player_info) for FootBud's player
  // pool, fetched with the user's own ESPN session.
  if (message.type === 'footbud-need-projections') {
    const season = message.season;
    const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leaguedefaults/3?view=kona_player_info`;
    fetch(url, {
      headers: {
        'x-fantasy-filter': JSON.stringify({
          players: {
            limit: 400,
            sortDraftRanks: { sortPriority: 1, sortAsc: true, value: 'STANDARD' },
          },
        }),
      },
      credentials: 'include',
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`ESPN projections endpoint responded ${res.status}`);
        const payload = await res.json();
        sendResponse({ payload, season });
      })
      .catch((e) => sendResponse({ error: e instanceof Error ? e.message : String(e) }));
    return true; // async response
  }

  return undefined;
});
