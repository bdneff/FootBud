# Testing FootBud

Thanks for helping test! FootBud is a fantasy football draft companion:
it watches your draft and, after every pick, tells you who to take next
and what you risk by waiting. It is read-only — you still make your
picks in your draft room.

## 1. Open the app

No install needed. Open:

**https://bdneff.github.io/FootBud/**

That alone is enough to test everything except live ESPN sync: set up a
league, load projections, and run a practice draft with manual pick
entry, or sync a Sleeper draft natively.

## 2. Optional: live ESPN draft sync (Chrome / Edge / Brave)

To have ESPN picks stream in automatically, install the companion
extension:

1. Download the code: on https://github.com/bdneff/FootBud click the
   green **Code** button, then **Download ZIP**, and extract it
2. Open `chrome://extensions`
3. Turn on **Developer mode** (top right)
4. Click **Load unpacked** and select the `extension` folder inside the
   extracted files (the folder itself, not a file in it)

Then:

1. In FootBud, set up your league to match your ESPN league (number of
   teams, roster spots, scoring, your draft position)
2. Under Live draft sync, press **Start ESPN-linked draft**
3. Open your ESPN draft room (a mock draft at
   https://fantasy.espn.com/football/mockdraftlobby works great) in
   another tab of the same browser
4. Picks appear in FootBud as they happen; the recommendation updates
   after every pick

Rule of thumb: if the extension ever updates or reloads, refresh both
the ESPN tab and the FootBud tab.

## 3. What feedback helps most

- Did the picks on FootBud's board match the real draft (right players,
  right teams, right order)?
- Did the recommendations feel smart or dumb? Any suggestion that felt
  like a big reach or an obvious miss — screenshot it with the round and
  pick number.
- Anything confusing in the UI, anywhere you got stuck.

If ESPN sync misbehaves: press F12 on the ESPN draft room tab, click
Console, type `footbud` in the filter box, and copy whatever
`[footbud-bridge]` lines are there. Those lines are exactly what we
need to fix it.
