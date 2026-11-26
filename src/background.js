/**
 * Service worker for IG Mini Player.
 *
 * Besides settings and the toolbar badge, it makes the mini player open when the user leaves the
 * *browser window* (another app, another window), not only when they switch tabs:
 *
 * Chrome opens Automatic Picture-in-Picture only when a tab is deactivated inside its window.
 * So when a window whose active tab is Instagram loses focus, we park a small placeholder tab in
 * front of it. Chrome then fires its own auto-PiP for the Instagram tab. When the window gets
 * focus again we switch back to Instagram and drop the placeholder, which closes the popup.
 */
const DEFAULT_SETTINGS = {
  autoPipOnTabSwitch: true,
  autoPipOnWindowBlur: true,
  autoPipMuted: true,
  pipWidth: 364,
  pipHeight: 628,
};

const IG_URL_PATTERNS = ['https://www.instagram.com/*', 'https://instagram.com/*'];
const IG_URL_RE = /^https:\/\/(www\.)?instagram\.com\//;
const PLACEHOLDER_URL = chrome.runtime.getURL('placeholder/placeholder.html');
const STATE_KEY = 'igpipState';
const RETRY_DELAYS_MS = [700, 1800];
const MAX_REFUSALS = 2;

chrome.runtime.onInstalled.addListener(async (details) => {
  const existing = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  const toSet = {};
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (existing[key] === undefined) toSet[key] = value;
  }
  if (Object.keys(toSet).length > 0) await chrome.storage.local.set(toSet);

  // Open Instagram tabs still run the previous version's scripts (or none): refresh them so the
  // mini player works straight away instead of opening empty.
  if (details.reason === 'install' || details.reason === 'update') {
    const tabs = await chrome.tabs.query({ url: IG_URL_PATTERNS });
    for (const tab of tabs) {
      chrome.tabs.reload(tab.id).catch(() => {});
    }
  }
});

function setTabBadge(tabId, active) {
  if (typeof tabId !== 'number') return;
  chrome.action.setBadgeText({ tabId, text: active ? 'PiP' : '' }).catch(() => {});
  if (active) {
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#E1306C' }).catch(() => {});
    chrome.action.setBadgeTextColor?.({ tabId, color: '#FFFFFF' })?.catch?.(() => {});
  }
}

// ---------------------------------------------------------------------------
// Parked-window state. Kept in storage.session because the worker can be stopped between events.
//   lastFocused: id of the last browser window that had focus
//   parked: { [windowId]: { igTabId, placeholderTabId, pipOpened } }
//   refused: { [igTabId]: times Chrome did not open a mini player after we parked }
// ---------------------------------------------------------------------------
async function readState() {
  const stored = await chrome.storage.session.get(STATE_KEY);
  const state = stored[STATE_KEY] || {};
  return { lastFocused: state.lastFocused ?? null, parked: state.parked || {}, refused: state.refused || {} };
}

function writeState(state) {
  return chrome.storage.session.set({ [STATE_KEY]: state });
}

// Events arrive faster than their async handlers finish: run them one at a time. Each task is
// capped so one browser call that never settles cannot hold up every later event.
const TASK_TIMEOUT_MS = 6000;
let queue = Promise.resolve();
function serial(fn) {
  const run = () =>
    Promise.race([
      Promise.resolve().then(fn),
      new Promise((resolve) => setTimeout(resolve, TASK_TIMEOUT_MS)),
    ]).catch(() => {});
  queue = queue.then(run, run);
  return queue;
}

// Know which window has focus from the moment the worker starts, not only after the first
// focus-change event.
serial(async () => {
  const state = await readState();
  if (state.lastFocused !== null) return;
  const win = await chrome.windows.getLastFocused().catch(() => null);
  if (win && win.focused && typeof win.id === 'number') {
    state.lastFocused = win.id;
    await writeState(state);
  }
});

/** Put Instagram back in front in a parked window and drop the placeholder tab. */
async function restoreWindow(state, windowId, { focusWindow = false } = {}) {
  const rec = state.parked[windowId];
  if (!rec) return false;
  delete state.parked[windowId];
  await writeState(state);
  if (focusWindow) await chrome.windows.update(Number(windowId), { focused: true }).catch(() => {});
  await chrome.tabs.update(rec.igTabId, { active: true }).catch(() => {});
  await chrome.tabs.remove(rec.placeholderTabId).catch(() => {});
  return true;
}

/**
 * Park a placeholder in front of the Instagram tab of an unfocused window.
 * Resolves 'parked', 'not-ready' (worth another look in a moment) or 'skip'.
 */
async function parkWindow(state, windowId) {
  if (state.parked[windowId]) return 'skip';
  const { autoPipOnWindowBlur } = await chrome.storage.local.get({ autoPipOnWindowBlur: true });
  if (!autoPipOnWindowBlur) return 'skip';

  let win;
  try {
    win = await chrome.windows.get(windowId, { populate: true });
  } catch {
    return 'skip';
  }
  if (win.type !== 'normal' || win.focused) return 'skip';
  const tab = (win.tabs || []).find((t) => t.active);
  if (!tab || !IG_URL_RE.test(tab.url || '')) return 'skip';
  // Chrome refused twice for this tab (auto picture-in-picture not allowed): stop flashing tabs.
  if ((state.refused[tab.id] || 0) >= MAX_REFUSALS) return 'skip';

  let answer;
  try {
    answer = await chrome.tabs.sendMessage(tab.id, { type: 'igpip:should-pop' });
  } catch {
    return 'skip'; // No content script in that tab (not refreshed yet).
  }
  if (!answer || !answer.eligible) return 'not-ready';

  // The user may already be back.
  const again = await chrome.windows.get(windowId).catch(() => null);
  if (!again || again.focused) return 'skip';

  const placeholder = await chrome.tabs.create({
    windowId,
    index: tab.index + 1,
    url: `${PLACEHOLDER_URL}#${tab.id}`,
    active: true,
    openerTabId: tab.id,
  });
  state.parked[windowId] = { igTabId: tab.id, placeholderTabId: placeholder.id, pipOpened: false };
  await writeState(state);
  return 'parked';
}

/**
 * Pop out the Instagram tab of a window that just lost focus, with a couple of retries:
 * the video may be between loops, or the silent keep-alive may have only just started.
 */
function tryPark(windowId, attempt = 0) {
  return serial(async () => {
    const state = await readState();
    const result = await parkWindow(state, windowId);

    if (result === 'not-ready' && attempt < RETRY_DELAYS_MS.length) {
      setTimeout(() => tryPark(windowId, attempt + 1), RETRY_DELAYS_MS[attempt]);
      return;
    }
    if (result !== 'parked') return;

    // Chrome can still refuse (site not allowed, nothing audible yet). Never strand the user on
    // the placeholder: if no mini player showed up, go back to Instagram and maybe try once more.
    const placeholderTabId = state.parked[windowId].placeholderTabId;
    setTimeout(() => {
      serial(async () => {
        const latest = await readState();
        const rec = latest.parked[windowId];
        if (!rec || rec.placeholderTabId !== placeholderTabId || rec.pipOpened) return;
        latest.refused[rec.igTabId] = (latest.refused[rec.igTabId] || 0) + 1;
        await restoreWindow(latest, windowId);
        if (attempt < RETRY_DELAYS_MS.length) {
          setTimeout(() => tryPark(windowId, attempt + 1), RETRY_DELAYS_MS[attempt]);
        }
      });
    }, 1800);
  });
}

chrome.windows.onFocusChanged.addListener((windowId) => {
  serial(async () => {
    const state = await readState();
    const none = windowId === chrome.windows.WINDOW_ID_NONE;

    // Back in a parked window: return the video to its tab.
    if (!none && state.parked[windowId]) {
      state.lastFocused = windowId;
      await restoreWindow(state, windowId);
      return;
    }

    let previous = state.lastFocused;
    if (previous === null && none) {
      previous = (await chrome.windows.getLastFocused().catch(() => null))?.id ?? null;
    }
    if (!none) {
      state.lastFocused = windowId;
      await writeState(state);
    }
    if (previous !== null && previous !== windowId) tryPark(previous);
  });
});

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  serial(async () => {
    const state = await readState();
    const rec = state.parked[windowId];
    if (!rec || tabId === rec.placeholderTabId) return;
    // The user picked a tab themselves: the placeholder has done its job.
    delete state.parked[windowId];
    await writeState(state);
    await chrome.tabs.remove(rec.placeholderTabId).catch(() => {});
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== 'loading') return;
  serial(async () => {
    const state = await readState();
    if (!state.refused[tabId]) return;
    delete state.refused[tabId]; // Fresh page load: give it another chance.
    await writeState(state);
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  serial(async () => {
    const state = await readState();
    if (state.refused[tabId]) {
      delete state.refused[tabId];
      await writeState(state);
    }
    for (const [windowId, rec] of Object.entries(state.parked)) {
      if (rec.placeholderTabId === tabId) {
        delete state.parked[windowId];
        await writeState(state);
      } else if (rec.igTabId === tabId) {
        delete state.parked[windowId];
        await writeState(state);
        await chrome.tabs.remove(rec.placeholderTabId).catch(() => {});
      }
    }
  });
});

function findParkedByIgTab(state, igTabId) {
  for (const [windowId, rec] of Object.entries(state.parked)) {
    if (rec.igTabId === igTabId) return { windowId: Number(windowId), rec };
  }
  return null;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return false;

  if (message.type === 'igpip:pip-state') {
    const tabId = sender.tab?.id;
    const isOpen = Boolean(message.isOpen);
    setTabBadge(tabId, isOpen);
    serial(async () => {
      const state = await readState();
      if (isOpen && typeof tabId === 'number' && state.refused[tabId]) {
        delete state.refused[tabId]; // It works after all (e.g. the user just allowed it).
        await writeState(state);
      }
      const found = typeof tabId === 'number' ? findParkedByIgTab(state, tabId) : null;
      if (!found) return;
      if (isOpen) {
        found.rec.pipOpened = true;
        await writeState(state);
      }
      // Tell the placeholder page whether the popup is still showing.
      chrome.runtime.sendMessage({ type: 'igpip:placeholder-state', igTabId: tabId, pipOpen: isOpen }).catch(() => {});
    });
    sendResponse({ ok: true });
    return false;
  }

  // The Instagram page itself noticed it lost focus. This is a second, independent trigger for
  // windows.onFocusChanged; focus moving to the address bar or DevTools keeps the window focused
  // and is ignored by tryPark.
  if (message.type === 'igpip:page-blur') {
    const windowId = sender.tab?.windowId;
    if (typeof windowId === 'number' && sender.tab?.active) tryPark(windowId);
    sendResponse({ ok: true });
    return false;
  }

  // "Tab" button in the mini player: bring Instagram back to the front.
  if (message.type === 'igpip:focus-opener-tab') {
    const tabId = sender.tab?.id;
    const windowId = sender.tab?.windowId;
    serial(async () => {
      const state = await readState();
      if (typeof windowId === 'number') {
        await chrome.windows.update(windowId, { focused: true }).catch(() => {});
        await restoreWindow(state, windowId);
      }
      if (typeof tabId === 'number') await chrome.tabs.update(tabId, { active: true }).catch(() => {});
    });
    sendResponse({ ok: true });
    return false;
  }

  // The placeholder page regained focus, or its "Back to Instagram" button was pressed.
  if (message.type === 'igpip:placeholder-return') {
    const placeholderTabId = sender.tab?.id;
    const igTabId = Number(message.igTabId);
    serial(async () => {
      const state = await readState();
      const found = findParkedByIgTab(state, igTabId);
      if (found) {
        await restoreWindow(state, found.windowId, { focusWindow: Boolean(message.focusWindow) });
        return;
      }
      // Stale placeholder (e.g. restored session): just get out of the way.
      await chrome.tabs.update(igTabId, { active: true }).catch(() => {});
      if (typeof placeholderTabId === 'number') await chrome.tabs.remove(placeholderTabId).catch(() => {});
    });
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'igpip:open-auto-pip-settings') {
    chrome.tabs.create({ url: 'chrome://settings/content/siteDetails?site=https%3A%2F%2Fwww.instagram.com' });
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'igpip:get-defaults') {
    sendResponse({ defaults: DEFAULT_SETTINGS });
    return false;
  }

  return false;
});

chrome.commands?.onCommand.addListener(async (command) => {
  if (command !== 'toggle-pip') return;
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab?.id && IG_URL_RE.test(activeTab.url || '')) {
      await chrome.tabs.sendMessage(activeTab.id, { type: 'igpip:command-toggle' });
      return;
    }
    const igTabs = await chrome.tabs.query({ url: IG_URL_PATTERNS });
    if (igTabs[0]?.id) await chrome.tabs.sendMessage(igTabs[0].id, { type: 'igpip:command-toggle' });
  } catch {
    // Content script not ready in that tab.
  }
});
