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

## Publishing to the Chrome Web Store (one-click install for everyone)

Chrome only allows one-click installs through the Web Store, so that is
the path to letting testers skip Developer mode entirely. Publishing as
**unlisted** keeps it out of search; only people with the link can
install it. One-time $5 developer fee, review usually takes 1 to 3 days.

1. Run `npm run ext:pack` (or use the checked-in `footbud-extension.zip`
   at the repo root)
2. Create a developer account at
   https://chrome.google.com/webstore/devconsole (sign in with Google,
   pay the $5 registration)
3. Click "New item" and upload `footbud-extension.zip`
4. Fill in the listing: the 128px icon is in `icons/icon128.png`, you
   need at least one 1280x800 screenshot (screenshot FootBud during a
   draft), and a short description
5. Privacy tab: declare that the extension reads the ESPN draft room
   page the user has open and relays picks to the FootBud tab in the
   same browser; no data is collected, stored remotely, or sent to any
   server. Single purpose: draft pick relay.
6. Set visibility to **Unlisted** and submit for review
7. When approved, share the store link; installs and updates are then
   one click

After any code change: bump `"version"` in `manifest.json`, run
`npm run ext:pack`, and upload the new zip in the developer console.
Store installs update themselves within hours; nobody has to
re-download anything.

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
