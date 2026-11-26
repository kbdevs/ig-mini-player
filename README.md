# IG Mini Player

A Chrome extension that moves the Instagram video you are watching into a small always-on-top
window when you leave it, the way Google Meet does with a call. From the mini player you can
scroll to the next Reel, like, read and write comments, send it to people, mute and seek.

## Install

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick this folder (after an update, click the reload arrow on the
   extension card instead; open Instagram tabs refresh themselves).
3. One-time Chrome setting: click the extension's toolbar icon, press **Allow automatic pop-out in
   Chrome**, and set **Automatic picture-in-picture** to **Allow** for `instagram.com`.

Needs Chrome 120+ or another Chromium browser that ships Document Picture-in-Picture and
automatic picture-in-picture (tested in Chrome 158; also used in Helium).

## When it pops out

| You do this | What happens |
| --- | --- |
| Switch to another tab | The video moves to the mini player; it returns when you come back to the Instagram tab. |
| Switch to another app or window | Same. A placeholder tab stands in for Instagram while you are away and disappears when you return. |
| Close the mini player while away | The video pauses and picks up again when you return to Instagram. |
| Press `Alt+P` on Instagram | Opens or closes the mini player by hand. |

Chrome only pops out a tab that is playing sound. Instagram starts Reels muted, so while a muted
video plays the extension loops an inaudible tone to keep the tab eligible (the tab shows a speaker
icon). This needs one click or key press anywhere on the Instagram page after it loads. Turn it
off with **Pop out muted videos too** in the toolbar popup.

## In the mini player

| Control | Action |
| --- | --- |
| Scroll, `↑` `↓`, `J` `K` | Next / previous video (uses Instagram's own Reel navigation) |
| Click the video, `Space` | Play / pause |
| Double-click the video, `L` | Like |
| `C` | Comments: read, load more, view replies, like, reply, post |
| `S` | Send to people, or copy the link |
| `M` | Mute / unmute |
| Bottom bar | Seek |
| **Tab** | Go back to the Instagram tab |

Comments are loaded through the same Instagram endpoints the website uses, with your own session,
so they do not depend on how the page happens to be rendered. If that is unavailable (for example
logged out on a post page) the comments shown on the page are mirrored instead.

## How it works

- `src/page-bridge.js` (page world) registers Chrome's Automatic Picture-in-Picture handler and,
  while the mini player is open, keeps Instagram believing its tab is visible so playback and
  feed loading continue.
- `src/content.js` builds the mini player. Instagram's `<video>` never leaves the page: the popup
  shows a live `captureStream()` mirror and sound keeps coming from the original element.
- `src/ig-adapter.js` talks to Instagram: its buttons, its Reel navigation, its comments API.
- `src/background.js` handles leaving the browser window: Chrome only auto-opens
  Picture-in-Picture on a tab switch, so it parks `placeholder/placeholder.html` in front of
  Instagram when the window loses focus and removes it when focus returns.
- `src/pip-ui.js` is the mini player's interface.

## Tests

```bash
node test/e2e.mjs
```

Launches Google Chrome with the extension against live `instagram.com` and checks pop-out on tab
switch and on leaving the browser, scrolling, looping, the controls, and comments. It runs logged
out, so the logged-in comments flow is exercised against simulated Instagram responses.
