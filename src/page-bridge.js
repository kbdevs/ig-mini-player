/**
 * MAIN-world bridge for IG Mini Player (runs at document_start).
 *
 * 1. Registers MediaSession 'enterpictureinpicture' so Chrome's Automatic Picture-in-Picture
 *    opens the mini player when the Instagram tab is hidden, and stops Instagram replacing it.
 * 2. While the mini player is open, tells Instagram the tab is still visible and blocks its
 *    background pause, so the video keeps playing and the feed keeps loading. The real
 *    visibility is forwarded to the content script as 'igpip:real-visibilitychange'.
 * 3. Writes text into Instagram's React / Lexical inputs (comment box, share search).
 */
(function installIGPipPageBridge(globalScope) {
  if (globalScope.__igPipBridgeInstalled) return;
  globalScope.__igPipBridgeInstalled = true;

  const ACTIVE_ATTR = 'data-igpip-active';
  const AUTO_ENABLED_ATTR = 'data-igpip-auto-enabled';
  const SETTING_MS_ATTR = 'data-igpip-setting-ms';
  const PLAYING_TARGET_ATTR = 'data-igpip-playing-target';
  const ALLOW_PAUSE_ATTR = 'data-igpip-allow-pause';
  const MOUNTED_ATTR = 'data-igpip-mounted';
  const INPUT_TARGET_ATTR = 'data-igpip-input-target';
  const PIP_SIZE_ATTR = 'data-igpip-size';

  const doc = globalScope.document;
  const docEl = () => doc && doc.documentElement;

  function isPipActive() {
    const el = docEl();
    return Boolean(el && el.getAttribute(ACTIVE_ATTR) === '1');
  }

  // Set for a moment after the tab is hidden, until we know whether Chrome opened the mini
  // player. Chrome's "enter picture-in-picture" request and the page's visibilitychange arrive in
  // no fixed order; without this, Instagram can pause the video first and nothing pops out.
  let pendingHide = false;
  let pendingHideTimer = 0;
  let replayingHide = false;

  /** Instagram should believe the tab is visible: mini player open, or still deciding. */
  function isShielded() {
    return pendingHide || isPipActive();
  }

  // -------------------------------------------------------------------------
  // 1. Visibility & Background Playback Protection (while PiP is active)
  // -------------------------------------------------------------------------
  const origHiddenDesc =
    globalScope.Document && Object.getOwnPropertyDescriptor(globalScope.Document.prototype, 'hidden');
  const origVisDesc =
    globalScope.Document && Object.getOwnPropertyDescriptor(globalScope.Document.prototype, 'visibilityState');

  function getRealHidden() {
    try {
      return origHiddenDesc?.get ? Boolean(origHiddenDesc.get.call(doc)) : false;
    } catch {
      return false;
    }
  }

  function getRealVisibilityState() {
    try {
      return origVisDesc?.get ? String(origVisDesc.get.call(doc)) : 'visible';
    } catch {
      return 'visible';
    }
  }

  if (origHiddenDesc && origHiddenDesc.configurable) {
    Object.defineProperty(globalScope.Document.prototype, 'hidden', {
      configurable: true,
      get() {
        if (this === doc && isShielded()) return false;
        return origHiddenDesc.get.call(this);
      },
    });
  }

  if (origVisDesc && origVisDesc.configurable) {
    Object.defineProperty(globalScope.Document.prototype, 'visibilityState', {
      configurable: true,
      get() {
        if (this === doc && isShielded()) return 'visible';
        return origVisDesc.get.call(this);
      },
    });
  }

  function endPendingHide() {
    if (!pendingHide) return;
    pendingHide = false;
    globalScope.clearTimeout(pendingHideTimer);
    if (isPipActive()) return; // The mini player opened: Instagram never hears about the hide.
    const el = docEl();
    if (el) {
      doc.querySelectorAll(`[${PLAYING_TARGET_ATTR}="1"]`).forEach((v) => v.removeAttribute(PLAYING_TARGET_ATTR));
    }
    if (getRealHidden()) {
      // No mini player after all: let Instagram handle the hidden tab as it normally would.
      replayingHide = true;
      try {
        doc.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
      } finally {
        replayingHide = false;
      }
    }
  }

  // Runs before any Instagram listener (registered at document_start, capture phase).
  doc.addEventListener(
    'visibilitychange',
    (event) => {
      if (replayingHide) return;
      const realHidden = getRealHidden();
      try {
        globalScope.dispatchEvent(
          new CustomEvent('igpip:real-visibilitychange', {
            detail: { hidden: realHidden, visibilityState: getRealVisibilityState() },
          })
        );
      } catch {
        // Ignore
      }

      if (isPipActive()) {
        event.stopImmediatePropagation();
        return;
      }

      if (realHidden) {
        const autoEnabled = docEl()?.getAttribute(AUTO_ENABLED_ATTR) === '1';
        const video = autoEnabled ? findBestPlayingVideoSync() : null;
        if (video) {
          // Hold the hide back and shield the video until Chrome's request arrives (or doesn't).
          pendingHide = true;
          video.setAttribute(PLAYING_TARGET_ATTR, '1');
          event.stopImmediatePropagation();
          globalScope.clearTimeout(pendingHideTimer);
          pendingHideTimer = globalScope.setTimeout(endPendingHide, 700);
        }
      } else if (pendingHide) {
        // Came straight back before anything opened: Instagram saw neither change.
        pendingHide = false;
        globalScope.clearTimeout(pendingHideTimer);
        doc.querySelectorAll(`[${PLAYING_TARGET_ATTR}="1"]`).forEach((v) => v.removeAttribute(PLAYING_TARGET_ATTR));
        event.stopImmediatePropagation();
      }
    },
    true
  );

  globalScope.addEventListener(
    'blur',
    (event) => {
      if (isShielded() && event.target === globalScope) {
        event.stopImmediatePropagation();
      }
    },
    true
  );

  // Prevent Instagram's background player loop from pausing the active PiP video
  const MediaProto = globalScope.HTMLMediaElement && globalScope.HTMLMediaElement.prototype;
  if (MediaProto && typeof MediaProto.pause === 'function') {
    const origPause = MediaProto.pause;
    MediaProto.pause = function patchedPause() {
      if (
        isShielded() &&
        this &&
        typeof this.getAttribute === 'function' &&
        this.getAttribute(PLAYING_TARGET_ATTR) === '1' &&
        docEl()?.getAttribute(ALLOW_PAUSE_ATTR) !== '1'
      ) {
        return;
      }
      return origPause.apply(this, arguments);
    };
  }

  // -------------------------------------------------------------------------
  // 2. MAIN-World Automatic Picture-in-Picture ('enterpictureinpicture')
  // -------------------------------------------------------------------------
  const origSetActionHandler =
    globalScope.MediaSession &&
    globalScope.MediaSession.prototype &&
    globalScope.MediaSession.prototype.setActionHandler;

  function findBestPlayingVideoSync() {
    const videos = Array.from(doc.querySelectorAll('video'));
    let best = null;
    let bestScore = -Infinity;
    const vh = globalScope.innerHeight || 800;
    for (const v of videos) {
      if (!v.isConnected) continue;
      const r = v.getBoundingClientRect();
      if (r.width < 100 || r.height < 100) continue;
      // An ended-but-not-paused video is a Reel between two loops: still "playing".
      if (v.paused) continue;
      let score = 0;
      if (!v.muted && v.volume > 0) score += 200;
      const center = (r.top + r.bottom) / 2;
      score += Math.max(0, 1 - Math.abs(center - vh / 2) / vh) * 300;
      if (score > bestScore) {
        bestScore = score;
        best = v;
      }
    }
    return best;
  }

  function computePipSizeForVideo(video) {
    let width = 364;
    let height = 628;
    const raw = docEl()?.getAttribute(PIP_SIZE_ATTR);
    if (raw) {
      const parts = raw.split('x').map(Number);
      if (parts[0] >= 280 && parts[1] >= 360) {
        width = parts[0];
        height = parts[1];
      }
    }
    if (video && video.videoWidth > 0 && video.videoHeight > 0) {
      const ratio = video.videoWidth / video.videoHeight;
      if (ratio >= 0.9) return { width: 420, height: 480 };
    }
    return { width, height };
  }

  function registerMainAutoPipHandler(enable) {
    if (!globalScope.navigator?.mediaSession || typeof origSetActionHandler !== 'function') return;
    if (!globalScope.documentPictureInPicture?.requestWindow) return;

    const el = docEl();
    if (el) {
      el.setAttribute(AUTO_ENABLED_ATTR, enable ? '1' : '0');
      el.setAttribute(SETTING_MS_ATTR, '1');
    }
    try {
      if (enable) {
        origSetActionHandler.call(globalScope.navigator.mediaSession, 'enterpictureinpicture', () => {
          // Must invoke requestWindow synchronously inside Chrome's Auto-PiP callback!
          if (globalScope.documentPictureInPicture.window) return;
          const video = doc.querySelector(`video[${PLAYING_TARGET_ATTR}="1"]`) || findBestPlayingVideoSync();
          if (!video) return;
          pendingHide = false;
          globalScope.clearTimeout(pendingHideTimer);

          // Immediately engage visibility + pause shield BEFORE Instagram sees tab hide!
          if (docEl()) docEl().setAttribute(ACTIVE_ATTR, '1');
          video.setAttribute(PLAYING_TARGET_ATTR, '1');

          const { width, height } = computePipSizeForVideo(video);
          const release = () => {
            if (docEl()) docEl().removeAttribute(ACTIVE_ATTR);
            video.removeAttribute(PLAYING_TARGET_ATTR);
            // Instagram was never told the tab went away; tell it now.
            pendingHide = true;
            endPendingHide();
          };
          globalScope.documentPictureInPicture
            .requestWindow({ width, height, disallowReturnToOpener: false })
            .then((win) => {
              if (docEl()) docEl().removeAttribute(MOUNTED_ATTR);
              globalScope.dispatchEvent(new CustomEvent('igpip:auto-pip-opened'));
              // If the content script is gone (extension reloaded without refreshing this tab)
              // nobody fills the window: close it rather than leave an empty black popup.
              globalScope.setTimeout(() => {
                if (docEl() && docEl().getAttribute(MOUNTED_ATTR) === '1') return;
                try {
                  if (win && !win.closed) win.close();
                } catch {
                  // Ignore
                }
                release();
              }, 1500);
            })
            .catch(release);
        });
      } else {
        origSetActionHandler.call(globalScope.navigator.mediaSession, 'enterpictureinpicture', null);
      }
    } catch {
      // Ignore if browser does not support enterpictureinpicture action.
    } finally {
      if (el) el.removeAttribute(SETTING_MS_ATTR);
    }
  }

  if (typeof origSetActionHandler === 'function') {
    globalScope.MediaSession.prototype.setActionHandler = function patchedSetActionHandler(
      action,
      handler
    ) {
      const el = docEl();
      const autoEnabled = el && el.getAttribute(AUTO_ENABLED_ATTR) === '1';
      const isOurCall = el && el.getAttribute(SETTING_MS_ATTR) === '1';
      if (action === 'enterpictureinpicture' && autoEnabled && !isOurCall) {
        return;
      }
      return origSetActionHandler.call(this, action, handler);
    };
  }

  globalScope.addEventListener('igpip:sync-auto-pip', (event) => {
    const enable = Boolean(event?.detail?.enabled);
    registerMainAutoPipHandler(enable);
  });

  // Register right away on document_start (content script will adjust if user disabled it)
  registerMainAutoPipHandler(true);

  // Re-assert MediaSession playbackState when audible video plays
  doc.addEventListener(
    'play',
    (e) => {
      const target = e.target;
      if (!target || target.tagName !== 'VIDEO') return;
      if (docEl()?.getAttribute(AUTO_ENABLED_ATTR) !== '0') {
        registerMainAutoPipHandler(true);
      }
      try {
        if (globalScope.navigator?.mediaSession) {
          globalScope.navigator.mediaSession.playbackState = 'playing';
        }
      } catch {
        // Ignore
      }
    },
    true
  );

  // -------------------------------------------------------------------------
  // 3. React 18 & Meta Lexical Controlled-Input Writer
  // -------------------------------------------------------------------------
  function setElementText(el, text) {
    if (!el) return false;
    const value = typeof text === 'string' ? text : '';
    const tag = (el.tagName || '').toUpperCase();

    if (tag === 'INPUT' || tag === 'TEXTAREA') {
      const proto =
        tag === 'TEXTAREA'
          ? globalScope.HTMLTextAreaElement?.prototype
          : globalScope.HTMLInputElement?.prototype;
      const descriptor = proto && Object.getOwnPropertyDescriptor(proto, 'value');
      const prevValue = el.value;

      if (descriptor && typeof descriptor.set === 'function') {
        descriptor.set.call(el, value);
      } else {
        el.value = value;
      }

      if (el._valueTracker && typeof el._valueTracker.setValue === 'function') {
        el._valueTracker.setValue(prevValue === value ? `${value}\u200b` : prevValue);
      }

      try {
        el.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            cancelable: true,
            inputType: value.length > 0 ? 'insertText' : 'deleteContentBackward',
            data: value.length > 0 ? value : null,
          })
        );
      } catch {
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') {
      try {
        el.focus({ preventScroll: true });
      } catch {
        el.focus();
      }

      const sel = globalScope.getSelection?.();
      if (sel) {
        const range = doc.createRange();
        range.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(range);
      }

      let inserted = false;
      try {
        inserted =
          value.length === 0
            ? doc.execCommand('delete', false)
            : doc.execCommand('insertText', false, value);
      } catch {
        inserted = false;
      }

      if (!inserted) {
        try {
          el.dispatchEvent(
            new InputEvent('beforeinput', {
              bubbles: true,
              cancelable: true,
              inputType: value.length > 0 ? 'insertText' : 'deleteContentBackward',
              data: value.length > 0 ? value : null,
            })
          );
        } catch {
          // Ignore
        }
        el.textContent = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return true;
    }

    return false;
  }

  globalScope.addEventListener('igpip:set-input', (event) => {
    const detail = event && event.detail;
    if (!detail || !detail.token) return;
    let target = null;
    try {
      target = doc.querySelector(`[${INPUT_TARGET_ATTR}="${CSS.escape(detail.token)}"]`);
    } catch {
      target = doc.querySelector(`[${INPUT_TARGET_ATTR}="${detail.token}"]`);
    }
    if (!target) return;
    const ok = setElementText(target, detail.text);
    target.removeAttribute(INPUT_TARGET_ATTR);
    target.setAttribute('data-igpip-input-result', ok ? 'ok' : 'fail');
  });

  globalScope.__igPipPageBridge = {
    setElementText,
    registerMainAutoPipHandler,
    getRealHidden,
    getRealVisibilityState,
  };
})(typeof window !== 'undefined' ? window : globalThis);
