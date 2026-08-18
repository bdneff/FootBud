# FootBud ESPN Draft Bridge

A small companion browser extension that relays picks from an open ESPN
fantasy football draft room to the FootBud tab.

## Why an extension

ESPN has no public draft API: draft results only appear in their API after
the draft ends, the live draft room runs over a private authenticated
WebSocket, and their endpoints block browser apps (no CORS). The one
legitimate place the pick feed exists during your draft is the draft room
page your own browser is already rendering. Extensions are allowed to read
the pages you have open, so this one watches the pick history and forwards
each pick to FootBud. Nothing is scraped from ESPN's servers beyond what
your browser already loaded, and nothing leaves your machine.

## Install (Chrome / Edge / Brave)

1. Open `chrome://extensions`
2. Turn on "Developer mode" (top right)
3. Click "Load unpacked" and select this `extension/` folder

## Use

1. In FootBud, set up your league (teams, roster, your draft position,
   scoring) to match your ESPN league, and load projections
2. In FootBud, open "Drafting on ESPN?" under Live draft sync and press
   "Start ESPN-linked draft"
3. Open your ESPN draft room in another tab of the same browser
4. Picks appear in FootBud as the extension reports them

If FootBud is not running on localhost, add your origin to the second
`content_scripts` entry in `manifest.json` and reload the extension.

## After updating the extension (IMPORTANT)

Whenever the extension code changes (`git pull`) and you press the reload
button on `chrome://extensions`, Chrome orphans the copies of the bridge
already running in open tabs — they lose their link to the extension and
every message they try to send throws "Extension context invalidated".

**Always refresh BOTH tabs after reloading the extension:**

1. Refresh the ESPN draft room tab (F5)
2. Refresh the FootBud tab (F5)

If you forget, the ESPN tab now shows a red banner ("FootBud lost its
connection") — click it to refresh. Captured picks are kept across the
refresh, so nothing is lost mid-draft.

## Status: experimental

ESPN changes its draft room markup without notice, and this parser was
written against known historical layouts, not a live draft room. If picks
stop flowing:

1. Set `DEBUG = true` at the top of `espn-content.js`
2. Reload the extension and the draft room tab
3. Open the console on the draft room tab and look at which selector
   matched and what text each row produced
4. Adjust `findPickRows()` / `parseRow()` accordingly; both are small and
   commented

Manual entry in FootBud always works as the fallback, and Sleeper drafts
sync natively without this extension.
