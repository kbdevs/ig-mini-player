// Parked in front of the Instagram tab while its video plays in the mini player (see background.js).
const igTabId = Number(location.hash.slice(1)) || 0;
const titleEl = document.getElementById('title');
const detailEl = document.getElementById('detail');

let returning = false;
function goBack(focusWindow) {
  if (returning) return;
  returning = true;
  chrome.runtime.sendMessage({ type: 'igpip:placeholder-return', igTabId, focusWindow }).catch(() => {});
  // If the worker did not answer (it restarts lazily), allow another attempt.
  setTimeout(() => {
    returning = false;
  }, 1500);
}

document.getElementById('back').addEventListener('click', () => goBack(true));

// Backup for the worker's windows.onFocusChanged listener: ask the browser whether this window
// is the focused one. (The page's own focus events are no use here: a tab opened in a background
// window still reports document.hasFocus() === true.)
setInterval(async () => {
  try {
    const win = await chrome.windows.getCurrent();
    if (win && win.focused) goBack(false);
  } catch {
    // Ignore
  }
}, 500);

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== 'igpip:placeholder-state' || message.igTabId !== igTabId) return;
  if (message.pipOpen) {
    titleEl.textContent = 'Playing in the mini player';
    detailEl.textContent =
      'Instagram moved to the floating window when you left this window. It comes back here when you return.';
  } else {
    titleEl.textContent = 'Mini player closed';
    detailEl.textContent = 'Your video is paused. It picks up again when you come back to Instagram.';
  }
});
