const DEFAULT_SETTINGS = {
  autoPipOnTabSwitch: true,
  autoPipOnWindowBlur: true,
  autoPipMuted: true,
};

const statusBadge = document.getElementById('status-badge');
const statusDetail = document.getElementById('status-detail');
const setupBtn = document.getElementById('setup-btn');
const returnBtn = document.getElementById('return-btn');

const toggles = {
  autoPipOnTabSwitch: document.getElementById('opt-auto-pip'),
  autoPipOnWindowBlur: document.getElementById('opt-window-blur'),
  autoPipMuted: document.getElementById('opt-muted'),
};

let activeIgTab = null;

function setBadge(text, variant) {
  statusBadge.textContent = text;
  statusBadge.className = `badge badge-${variant}`;
}

async function loadSettings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  const merged = { ...DEFAULT_SETTINGS, ...stored };
  for (const [key, input] of Object.entries(toggles)) {
    input.checked = Boolean(merged[key]);
    input.addEventListener('change', () => {
      chrome.storage.local.set({ [key]: input.checked });
      setTimeout(refreshTabStatus, 100);
    });
  }
}

async function findTargetInstagramTab() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTab?.url && /^https:\/\/(www\.)?instagram\.com\//.test(activeTab.url)) {
    return activeTab;
  }
  const igTabs = await chrome.tabs.query({
    url: ['https://www.instagram.com/*', 'https://instagram.com/*'],
  });
  return igTabs[0] || null;
}

async function refreshTabStatus() {
  activeIgTab = await findTargetInstagramTab();
  returnBtn.style.display = 'none';

  if (!activeIgTab) {
    setBadge('No IG tab', 'idle');
    statusDetail.textContent =
      'Open instagram.com/reels and play a video. It pops out when you leave the tab or the browser.';
    return;
  }

  try {
    const res = await chrome.tabs.sendMessage(activeIgTab.id, { type: 'igpip:get-status' });

    if (!res?.hasDocPip) {
      setBadge('Unsupported', 'warn');
      statusDetail.textContent =
        'This browser does not support Document Picture-in-Picture. Use Chrome 120 or newer.';
      return;
    }

    if (res.isOpen) {
      setBadge('Active', 'active');
      statusDetail.textContent = 'Playing in the mini player. Scroll, like, comment or send from there.';
      returnBtn.style.display = 'block';
      return;
    }

    const autoOn = res.settings?.autoPipOnTabSwitch || res.settings?.autoPipOnWindowBlur;
    if (!autoOn) {
      setBadge('Manual', 'idle');
      statusDetail.textContent = 'Automatic pop-out is off. Press Alt+P on Instagram to open the mini player.';
    } else if (res.autoPipReady) {
      setBadge('Ready', 'ready');
      statusDetail.textContent = 'Leave this tab or the browser and the video pops out by itself.';
    } else if (res.isPlaying && res.isMuted) {
      setBadge('Muted', 'warn');
      statusDetail.textContent = res.settings?.autoPipMuted
        ? 'Click anywhere on the Instagram page once so muted videos can pop out too, or turn the sound on.'
        : 'This video is muted. Turn its sound on, or enable "Pop out muted videos too" below.';
    } else if (res.hasVideo) {
      setBadge('Paused', 'idle');
      statusDetail.textContent = 'Play a video, then leave the tab or the browser to pop it out.';
    } else {
      setBadge('On Instagram', 'idle');
      statusDetail.textContent = 'Open a Reel or a video post on Instagram.';
    }
  } catch {
    setBadge('Refresh IG', 'warn');
    statusDetail.textContent =
      'Refresh the Instagram tab once so the extension can attach to it.';
  }
}

setupBtn.addEventListener('click', () => {
  chrome.tabs.create({
    url: 'chrome://settings/content/siteDetails?site=https%3A%2F%2Fwww.instagram.com',
  });
  window.close();
});

returnBtn.addEventListener('click', async () => {
  if (!activeIgTab) return;
  try {
    await chrome.tabs.sendMessage(activeIgTab.id, { type: 'igpip:close-pip' });
  } catch {
    // Ignore
  }
  window.close();
});

loadSettings().then(refreshTabStatus);
