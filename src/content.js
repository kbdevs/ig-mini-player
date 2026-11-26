/**
 * Content-script orchestrator for IG Mini Player.
 *
 * How it fits together:
 * - page-bridge.js (MAIN world) registers Chrome's Automatic Picture-in-Picture handler, so the
 *   mini player opens by itself when the Instagram tab is hidden. background.js triggers the
 *   same path when the browser window loses focus (it briefly parks a placeholder tab).
 * - The Instagram <video> never leaves Instagram's DOM: the mini player shows a live
 *   captureStream() mirror, and sound keeps coming from the original element.
 * - Scrolling, likes, mute and sharing go through Instagram's own controls so its state never
 *   drifts from ours. Comments are loaded from Instagram's own API (DOM fallback when logged out).
 */
(function initIGPipContent() {
  if (window.__igPipContentLoaded) return;
  window.__igPipContentLoaded = true;

  const adapter = window.__IGPipAdapter;
  const uiModule = window.__IGPipUI;
  if (!adapter || !uiModule) return;

  const ACTIVE_ATTR = 'data-igpip-active';
  const MOUNTED_ATTR = 'data-igpip-mounted';
  const PLAYING_TARGET_ATTR = 'data-igpip-playing-target';
  const ALLOW_PAUSE_ATTR = 'data-igpip-allow-pause';
  const PIP_SIZE_ATTR = 'data-igpip-size';

  const DEFAULT_SETTINGS = {
    autoPipOnTabSwitch: true,
    autoPipOnWindowBlur: true,
    autoPipMuted: true,
    pipWidth: 364,
    pipHeight: 628,
  };

  let settings = { ...DEFAULT_SETTINGS };

  let pipWindow = null;
  let pipUI = null;
  let openedAutomatically = false;
  /** The video being mirrored: Instagram's element, our <video> in the popup, and the track joining them. */
  let activeSession = null;
  let activePostContainer = null;
  let postObserver = null;
  let progressInterval = null;
  let isSwitchingVideo = false;
  let userPaused = false;
  let pausedByClose = null;

  const commentsBridge = adapter.createCommentsBridge(document);
  const shareBridge = adapter.createShareBridge(document);
  const api = adapter.createInstagramApi(document, window);

  const sleep = adapter.sleep;
  // The content script's world is not patched by page-bridge.js, so this is the real state.
  const isReallyHidden = () => document.visibilityState === 'hidden';
  const isPipOpen = () => Boolean(pipWindow && !pipWindow.closed);

  function hasDocPipSupport() {
    return Boolean(window.documentPictureInPicture && typeof window.documentPictureInPicture.requestWindow === 'function');
  }

  function hasAutoPipSupport() {
    return Boolean(navigator.mediaSession && typeof navigator.mediaSession.setActionHandler === 'function');
  }

  // =========================================================================
  // Page-bridge flags (visibility + pause protection live in the MAIN world)
  // =========================================================================
  function setPageBridgeActive(active) {
    const docEl = document.documentElement;
    if (!docEl) return;
    if (active) {
      docEl.setAttribute(ACTIVE_ATTR, '1');
    } else {
      docEl.removeAttribute(ACTIVE_ATTR);
      docEl.removeAttribute(ALLOW_PAUSE_ATTR);
      docEl.removeAttribute(MOUNTED_ATTR);
      setProtectedVideo(null);
    }
  }

  function setProtectedVideo(video) {
    document.querySelectorAll(`[${PLAYING_TARGET_ATTR}="1"]`).forEach((el) => {
      if (el !== video) el.removeAttribute(PLAYING_TARGET_ATTR);
    });
    if (video) video.setAttribute(PLAYING_TARGET_ATTR, '1');
  }

  function pauseVideoAllowed(video) {
    if (!video) return;
    const docEl = document.documentElement;
    docEl.setAttribute(ALLOW_PAUSE_ATTR, '1');
    try {
      video.pause();
    } catch {
      // Ignore
    } finally {
      docEl.removeAttribute(ALLOW_PAUSE_ATTR);
    }
  }

  function syncAutoPipRegistration() {
    document.documentElement.setAttribute(
      PIP_SIZE_ATTR,
      `${settings.pipWidth || 364}x${settings.pipHeight || 628}`
    );
    window.dispatchEvent(
      new CustomEvent('igpip:sync-auto-pip', {
        detail: { enabled: Boolean(settings.autoPipOnTabSwitch || settings.autoPipOnWindowBlur) },
      })
    );
  }

  function loadSettings() {
    if (!chrome?.storage?.local) return;
    chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS), (stored) => {
      settings = { ...DEFAULT_SETTINGS, ...(stored || {}) };
      syncAutoPipRegistration();
      updateKeepAlive();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      for (const [key, change] of Object.entries(changes)) {
        if (key in DEFAULT_SETTINGS) settings[key] = change.newValue;
      }
      syncAutoPipRegistration();
      updateKeepAlive();
    });
  }

  function sendToBackground(message) {
    try {
      chrome.runtime?.sendMessage?.(message, () => {
        void chrome.runtime?.lastError;
      });
    } catch {
      // Extension was reloaded; this content script is orphaned.
    }
  }

  // =========================================================================
  // Silent keep-alive so muted videos can pop out too
  // =========================================================================
  // Chrome only auto-opens Picture-in-Picture for a tab that is playing audible media, and
  // Instagram starts every Reel muted. While a muted video plays we loop a 20 Hz tone ~58 dB
  // below full scale: far below what speakers or ears reproduce, but enough for Chrome to treat
  // the tab as playing. It stops the moment the mini player opens or the video is unmuted.
  let keepAliveAudio = null;
  let keepAliveUrl = '';

  function buildSilentToneUrl() {
    const sampleRate = 8000;
    const samples = sampleRate * 2;
    const buf = new ArrayBuffer(44 + samples * 2);
    const dv = new DataView(buf);
    const writeText = (offset, text) => {
      for (let i = 0; i < text.length; i++) dv.setUint8(offset + i, text.charCodeAt(i));
    };
    writeText(0, 'RIFF');
    dv.setUint32(4, 36 + samples * 2, true);
    writeText(8, 'WAVE');
    writeText(12, 'fmt ');
    dv.setUint32(16, 16, true);
    dv.setUint16(20, 1, true);
    dv.setUint16(22, 1, true);
    dv.setUint32(24, sampleRate, true);
    dv.setUint32(28, sampleRate * 2, true);
    dv.setUint16(32, 2, true);
    dv.setUint16(34, 16, true);
    writeText(36, 'data');
    dv.setUint32(40, samples * 2, true);
    for (let i = 0; i < samples; i++) {
      dv.setInt16(44 + i * 2, Math.round(Math.sin((2 * Math.PI * 20 * i) / sampleRate) * 40), true);
    }
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  }

  function findPlayingVideo() {
    const v = adapter.findActiveVideo(document);
    // "ended" without "paused" is a Reel between two loops, so it still counts as playing.
    return v && !v.paused ? v : null;
  }

  function isAudible(video) {
    return Boolean(video && !video.muted && video.volume > 0);
  }

  function keepAliveRunning() {
    return Boolean(keepAliveAudio && !keepAliveAudio.paused);
  }

  let keepAliveStopTimer = 0;

  function keepAliveWanted() {
    const autoOn = settings.autoPipOnTabSwitch || settings.autoPipOnWindowBlur;
    const playing = findPlayingVideo();
    return Boolean(
      autoOn && settings.autoPipMuted && hasDocPipSupport() && !isPipOpen() && !isReallyHidden() && playing && !isAudible(playing)
    );
  }

  function updateKeepAlive() {
    const want = keepAliveWanted();

    if (!want) {
      // Stop a little late rather than at once, so a gap between two loops does not interrupt it.
      if (keepAliveRunning() && !keepAliveStopTimer) {
        keepAliveStopTimer = setTimeout(() => {
          keepAliveStopTimer = 0;
          if (keepAliveAudio && !keepAliveWanted()) keepAliveAudio.pause();
        }, isPipOpen() || isReallyHidden() ? 0 : 1500);
      }
      return;
    }
    clearTimeout(keepAliveStopTimer);
    keepAliveStopTimer = 0;
    if (!keepAliveAudio) {
      keepAliveUrl = buildSilentToneUrl();
      keepAliveAudio = new Audio(keepAliveUrl);
      keepAliveAudio.loop = true;
    }
    if (keepAliveAudio.paused) {
      // Rejected until the user has interacted with the page once; retried on the next input.
      keepAliveAudio.play().catch(() => {});
    }
  }

  for (const type of ['play', 'playing', 'pause', 'volumechange', 'ended']) {
    document.addEventListener(
      type,
      (e) => {
        if (e.target instanceof HTMLVideoElement) updateKeepAlive();
      },
      true
    );
  }
  for (const type of ['pointerdown', 'keydown']) {
    window.addEventListener(type, () => setTimeout(updateKeepAlive, 0), true);
  }
  setInterval(updateKeepAlive, 2000);

  function updateMediaSessionMetadata(state) {
    if (!navigator.mediaSession || typeof MediaMetadata !== 'function' || !state) return;
    try {
      const cleanAuthor = (state.authorName || 'instagram').replace(/^@+/, '');
      navigator.mediaSession.metadata = new MediaMetadata({
        title: state.caption ? state.caption.slice(0, 80) : `Reel by @${cleanAuthor}`,
        artist: `@${cleanAuthor}`,
        album: 'Instagram',
        artwork: state.authorAvatar ? [{ src: state.authorAvatar, sizes: '96x96', type: 'image/jpeg' }] : [],
      });
    } catch {
      // Ignore
    }
  }

  // =========================================================================
  // Video attachment: live captureStream() mirror
  // =========================================================================
  const liveVideoTracks = (stream) =>
    stream ? stream.getVideoTracks().filter((t) => t.readyState === 'live') : [];

  /**
   * Point the mini player's <video> at the source video's current live track.
   *
   * A captured track ENDS whenever the source ends — and Instagram loops Reels by letting them
   * end and starting again — so this must be re-run for every loop, not just once per video.
   */
  function bindMirrorStream({ force = false } = {}) {
    const session = activeSession;
    if (!session) return false;

    let stream = force ? null : session.captureStream;
    if (liveVideoTracks(stream).length === 0) {
      try {
        stream = session.sourceVideo.captureStream();
      } catch {
        stream = null;
      }
      if (!stream) return false;
      session.captureStream = stream;
      stream.addEventListener('addtrack', () => {
        if (activeSession === session) bindMirrorStream();
      });
    }

    const tracks = liveVideoTracks(stream);
    if (tracks.length === 0) return true; // Nothing decoded yet: 'addtrack' or the poll rebinds.
    const track = tracks[tracks.length - 1];
    if (!force && session.mirrorTrack === track) return true;

    session.mirrorTrack = track;
    session.lastFrameCount = -1;
    session.lastFrameAt = Date.now();
    track.addEventListener(
      'ended',
      () => {
        if (activeSession === session && session.mirrorTrack === track) bindMirrorStream();
      },
      { once: true }
    );
    // Video only: sound keeps playing from Instagram's own element.
    session.mirrorVideo.srcObject = new MediaStream([track]);
    session.mirrorVideo.play().catch(() => {});
    return true;
  }

  /** Called a few times a second: rebinds when the track died, and un-sticks a frozen picture. */
  function refreshMirrorStreamIfNeeded() {
    const session = activeSession;
    if (!session || !session.sourceVideo.isConnected) return;
    const { sourceVideo, mirrorVideo } = session;

    if (!session.mirrorTrack || session.mirrorTrack.readyState !== 'live') {
      bindMirrorStream();
      return;
    }
    if (mirrorVideo.paused && !sourceVideo.paused) mirrorVideo.play().catch(() => {});

    // Watchdog: the source is playing but the mini player has not painted a new frame for a while.
    const frames = mirrorVideo.getVideoPlaybackQuality?.().totalVideoFrames ?? 0;
    const now = Date.now();
    const sourcePlaying = !sourceVideo.paused && !sourceVideo.ended && sourceVideo.readyState >= 3;
    if (frames !== session.lastFrameCount || !sourcePlaying) {
      session.lastFrameCount = frames;
      session.lastFrameAt = now;
    } else if (now - session.lastFrameAt > 1500) {
      bindMirrorStream({ force: true });
    }
  }

  function attachVideoToPiP(video) {
    if (!video || !isPipOpen() || !pipUI) return false;
    if (activeSession && activeSession.sourceVideo === video) return true;

    detachActiveVideo();
    setPageBridgeActive(true);
    setProtectedVideo(video);

    const mirrorVideo = pipUI.createMirrorVideoElement();
    pipUI.mountVideoElement(mirrorVideo);
    activeSession = {
      sourceVideo: video,
      mirrorVideo,
      captureStream: null,
      mirrorTrack: null,
      lastFrameCount: -1,
      lastFrameAt: Date.now(),
    };
    if (!bindMirrorStream()) {
      pipUI.showToast('This video cannot be shown in the mini player');
    }

    if (!userPaused && video.paused) video.play().catch(() => {});

    activePostContainer = adapter.findPostContainer(video);
    refreshPostUI();
    attachPostObserver();
    attachVideoListeners(video);
    return true;
  }

  function detachActiveVideo() {
    detachPostObserver();
    if (!activeSession) return;
    const session = activeSession;
    activeSession = null;
    detachVideoListeners(session.sourceVideo);
    session.sourceVideo.removeAttribute(PLAYING_TARGET_ATTR);
    try {
      session.mirrorVideo.pause();
      session.mirrorVideo.srcObject = null;
    } catch {
      // Ignore
    }
  }

  // =========================================================================
  // Video & post state sync
  // =========================================================================
  function onVideoProgress() {
    if (!activeSession || !pipUI) return;
    const v = activeSession.sourceVideo;
    if (!v.isConnected && !isSwitchingVideo) {
      // Instagram recycled the element (feed virtualisation): follow whatever is playing now.
      const next = adapter.findCenteredVideo(document, window) || adapter.findActiveVideo(document);
      if (next && next !== v) attachVideoToPiP(next);
      return;
    }
    pipUI.updateProgress(v.currentTime || 0, Number.isFinite(v.duration) ? v.duration : 0);
    pipUI.setPlaying(!v.paused && !v.ended);
    refreshMirrorStreamIfNeeded();
  }

  function onVideoStateChange() {
    if (!activeSession) return;
    refreshMirrorStreamIfNeeded();
    refreshPostUI();
  }

  const VIDEO_EVENTS = ['volumechange', 'play', 'playing', 'pause', 'loadeddata'];

  function attachVideoListeners(video) {
    video.addEventListener('timeupdate', onVideoProgress);
    for (const type of VIDEO_EVENTS) video.addEventListener(type, onVideoStateChange);
    clearInterval(progressInterval);
    progressInterval = setInterval(onVideoProgress, 250);
  }

  function detachVideoListeners(video) {
    clearInterval(progressInterval);
    progressInterval = null;
    if (!video) return;
    video.removeEventListener('timeupdate', onVideoProgress);
    for (const type of VIDEO_EVENTS) video.removeEventListener(type, onVideoStateChange);
  }

  function currentPostState() {
    if (!activeSession) return null;
    if (!activePostContainer || !activePostContainer.isConnected) {
      activePostContainer = adapter.findPostContainer(activeSession.sourceVideo);
    }
    return adapter.extractPostState(activePostContainer, activeSession.sourceVideo, document);
  }

  function refreshPostUI() {
    if (!pipUI || !activeSession) return;
    const state = currentPostState();
    pipUI.updatePostState(state);
    updateMediaSessionMetadata(state);
  }

  let postMutTimer = null;
  function attachPostObserver() {
    detachPostObserver();
    if (!activePostContainer) return;
    postObserver = new MutationObserver(() => {
      clearTimeout(postMutTimer);
      postMutTimer = setTimeout(refreshPostUI, 80);
    });
    postObserver.observe(activePostContainer, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['aria-label', 'fill', 'color', 'class'],
    });
  }

  function detachPostObserver() {
    clearTimeout(postMutTimer);
    if (postObserver) {
      postObserver.disconnect();
      postObserver = null;
    }
  }

  /** Instagram answers logged-out actions with a "Sign up / Log in" dialog: surface it, then clear it. */
  function reportLoginWallSoon(message) {
    setTimeout(() => {
      if (adapter.dismissLoginWall(document)) pipUI?.showToast(message, 2600);
    }, 450);
  }

  // =========================================================================
  // Comments & share panes
  // =========================================================================
  let paneSyncTimer = null;
  let panePollInterval = null;
  let paneObserver = null;
  /** Active comments provider: the API source, or the DOM bridge wrapped to the same surface. */
  let commentsSource = null;
  let commentsToken = 0;

  function stopPaneSync() {
    clearTimeout(paneSyncTimer);
    clearInterval(panePollInterval);
    panePollInterval = null;
    if (paneObserver) {
      paneObserver.disconnect();
      paneObserver = null;
    }
  }

  function closeCommentsSource() {
    commentsToken += 1;
    if (commentsSource) commentsSource.close();
    commentsSource = null;
  }

  function closeActivePane() {
    stopPaneSync();
    closeCommentsSource();
    shareBridge.close();
    if (pipUI) pipUI.setActivePane(null);
  }

  function renderCommentsNow() {
    if (!pipUI || pipUI.getActivePane() !== 'comments' || !commentsSource) return;
    pipUI.renderComments(commentsSource.getView());
  }

  function makeDomCommentsSource() {
    return {
      getView: () => commentsBridge.getView(),
      loadMore: () => commentsBridge.scrollMore(),
      toggleLike: async (id) => {
        commentsBridge.clickCommentLike(id);
        setTimeout(renderCommentsNow, 160);
        return { ok: true };
      },
      toggleReplies: (id) => {
        commentsBridge.clickViewReplies(id);
        setTimeout(renderCommentsNow, 300);
      },
      setReplyTarget: (id) => (id ? commentsBridge.clickCommentReply(id) : null),
      post: async (text) => {
        const res = await commentsBridge.postComment(text);
        if (res.ok) setTimeout(renderCommentsNow, 350);
        return res;
      },
      close: () => commentsBridge.close(),
    };
  }

  async function openCommentsPane() {
    if (!pipUI || !activeSession) return;
    stopPaneSync();
    shareBridge.close();
    closeCommentsSource();
    const token = commentsToken;
    pipUI.setActivePane('comments');

    const stillWanted = () => isPipOpen() && pipUI && pipUI.getActivePane() === 'comments' && token === commentsToken;
    const state = currentPostState();

    // 1. Instagram's API (logged in): complete, fast and independent of how the page is rendered.
    const mediaId = adapter.shortcodeToMediaId(state?.shortcode || '');
    if (mediaId && api.isLoggedIn()) {
      const source = adapter.createApiCommentsSource(api, mediaId, () => {
        if (commentsSource === source) renderCommentsNow();
      });
      const res = await source.load();
      if (!stillWanted()) {
        source.close();
        return;
      }
      if (res.ok) {
        commentsSource = source;
        renderCommentsNow();
        return;
      }
      source.close();
    }

    // 2. Fallback: drive Instagram's own comments panel and mirror it.
    const res = await commentsBridge.open(activePostContainer);
    if (!stillWanted()) {
      commentsBridge.close();
      return;
    }
    if (!res.ok) {
      pipUI.renderComments({
        comments: [],
        total: 0,
        hasComposer: false,
        isLoading: false,
        emptyMessage: res.error || 'Comments are unavailable for this video.',
      });
      return;
    }

    commentsSource = makeDomCommentsSource();
    renderCommentsNow();
    const root = commentsBridge.getRoot();
    if (root) {
      paneObserver = new MutationObserver(() => {
        clearTimeout(paneSyncTimer);
        paneSyncTimer = setTimeout(renderCommentsNow, 90);
      });
      paneObserver.observe(root, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['aria-label', 'fill', 'disabled', 'aria-disabled'],
      });
    }
    panePollInterval = setInterval(renderCommentsNow, 1100);
  }

  async function openSharePane() {
    if (!pipUI || !activeSession) return;
    stopPaneSync();
    closeCommentsSource();
    pipUI.setActivePane('share');

    const res = await shareBridge.open(activePostContainer);
    if (!isPipOpen() || !pipUI || pipUI.getActivePane() !== 'share') return;

    if (!res.ok) {
      pipUI.renderShare({
        recipients: [],
        selectedCount: 0,
        sendLabel: 'Send',
        canSend: false,
        hasMessageInput: false,
        isLoading: false,
        query: '',
        emptyMessage: res.error || 'Could not open Instagram\'s share sheet.',
      });
      return;
    }

    const sync = () => {
      if (!pipUI || pipUI.getActivePane() !== 'share') return;
      pipUI.renderShare(shareBridge.scrape());
    };
    sync();
    const dialog = shareBridge.getDialog();
    if (dialog) {
      paneObserver = new MutationObserver(() => {
        clearTimeout(paneSyncTimer);
        paneSyncTimer = setTimeout(sync, 90);
      });
      paneObserver.observe(dialog, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['aria-checked', 'aria-selected', 'aria-disabled', 'disabled', 'checked', 'class'],
      });
    }
    panePollInterval = setInterval(sync, 1000);
  }

  // =========================================================================
  // Scrolling to the next / previous video
  // =========================================================================
  /**
   * Wait until Instagram has settled on a different video than `prevVideo`.
   * Resolves with that video, or `prevVideo` itself if Instagram reused the element for the
   * next Reel, or null if nothing changed.
   */
  async function waitForVideoChange(prevVideo, prevSrc, timeoutMs, hintContainer = null) {
    const startedAt = Date.now();
    const deadline = startedAt + timeoutMs;
    const wallBefore = Boolean(adapter.findLoginWall(document));
    const topBefore = prevVideo.getBoundingClientRect().top;
    let moved = false;
    let candidate = null;
    let stableTicks = 0;
    while (Date.now() < deadline) {
      if (!isPipOpen()) return null;
      if (!wallBefore && adapter.findLoginWall(document)) return null;
      // Nothing is scrolling at all (first / last video): don't keep the user waiting.
      if (!moved && Math.abs(prevVideo.getBoundingClientRect().top - topBefore) > 4) moved = true;
      if (!moved && !candidate && Date.now() - startedAt > 900) return null;

      let current = hintContainer && hintContainer.isConnected ? hintContainer.querySelector('video') : null;
      if (!current) current = adapter.findCenteredVideo(document, window);

      const changed =
        current && (current !== prevVideo || ((current.currentSrc || current.src) && (current.currentSrc || current.src) !== prevSrc));
      if (changed) {
        if (current === candidate) stableTicks += 1;
        else {
          candidate = current;
          stableTicks = 1;
        }
        if (stableTicks >= 3) return candidate;
      } else {
        candidate = null;
        stableTicks = 0;
      }
      await sleep(60);
    }
    return candidate;
  }

  async function handleScrollVideo(direction) {
    if (!isPipOpen() || !activeSession || isSwitchingVideo) return;
    isSwitchingVideo = true;

    try {
      closeActivePane();
      adapter.closeOpenDialogs(document);

      const prevVideo = activeSession.sourceVideo;
      const prevSrc = prevVideo.currentSrc || prevVideo.src;
      const prevContainer = activePostContainer;
      const wantMuted = prevVideo.muted;
      const wantVolume = prevVideo.volume;

      pipUI.showTransition(direction);
      // Stop shielding the old video so Instagram can pause it as part of its own navigation.
      setProtectedVideo(null);

      const wallBefore = Boolean(adapter.findLoginWall(document));
      let next = null;
      let usedNativeNav = false;
      if (adapter.clickNativeReelNav(direction, document)) {
        usedNativeNav = true;
        next = await waitForVideoChange(prevVideo, prevSrc, 3500);
      } else {
        const res = adapter.scrollToAdjacentVideo(prevContainer, prevVideo, direction, document, window);
        if (res.scrolled) next = await waitForVideoChange(prevVideo, prevSrc, 2600, res.targetContainer || null);
      }
      if (!isPipOpen()) return;

      if (!next) {
        const hitLoginWall = !wallBefore && Boolean(adapter.findLoginWall(document));
        if (hitLoginWall) {
          adapter.dismissLoginWall(document);
          // Instagram already moved on to the walled video: step back so it stays on ours.
          if (usedNativeNav) adapter.clickNativeReelNav(-direction, document);
        }
        setProtectedVideo(prevVideo);
        if (!userPaused && prevVideo.paused) prevVideo.play().catch(() => {});
        pipUI.showToast(
          hitLoginWall
            ? 'Log in to Instagram to keep scrolling'
            : direction < 0
              ? "You're at the first video"
              : 'No more videos here',
          2600
        );
        return;
      }

      userPaused = false;
      if (next !== prevVideo) {
        // Never leave two videos playing over each other.
        if (!prevVideo.paused) pauseVideoAllowed(prevVideo);
      } else {
        detachActiveVideo();
      }
      if (next.muted !== wantMuted) next.muted = wantMuted;
      if (!wantMuted && next.volume === 0) next.volume = wantVolume || 1;
      attachVideoToPiP(next);
    } finally {
      isSwitchingVideo = false;
    }
  }

  // =========================================================================
  // Mini player window
  // =========================================================================
  function toggleMute() {
    if (!activeSession) return;
    const v = activeSession.sourceVideo;
    const wantMuted = !(v.muted || v.volume === 0);

    // Prefer Instagram's own toggle so its sound preference carries over to the next Reel.
    adapter.clickMuteToggle(activePostContainer);
    setTimeout(() => {
      if (!activeSession || activeSession.sourceVideo !== v) return;
      if (v.muted !== wantMuted) v.muted = wantMuted;
      if (!wantMuted && v.volume === 0) v.volume = 1;
      refreshPostUI();
      if (!wantMuted) {
        // Chrome pauses a video that is unmuted before the user ever interacted with the page.
        setTimeout(() => {
          if (!activeSession || activeSession.sourceVideo !== v || userPaused || !v.paused) return;
          v.play().catch(() => {
            v.muted = true;
            v.play().catch(() => {});
            pipUI?.showToast('Click the Instagram page once to allow sound', 2800);
            refreshPostUI();
          });
        }, 220);
      }
    }, 70);
  }

  function mountIntoPipWindow(win, { auto = false, targetVideo = null } = {}) {
    if (!win || win.closed) return false;
    if (pipWindow === win && pipUI) return true;

    const video =
      targetVideo || document.querySelector(`video[${PLAYING_TARGET_ATTR}="1"]`) || adapter.findActiveVideo(document);
    if (!video) {
      try {
        win.close();
      } catch {
        // Ignore
      }
      setPageBridgeActive(false);
      return false;
    }

    pipWindow = win;
    openedAutomatically = Boolean(auto);
    userPaused = false;
    pausedByClose = null;
    document.documentElement.setAttribute(MOUNTED_ATTR, '1');

    pipUI = uiModule.createPipUI(pipWindow, {
      onTogglePlayPause() {
        if (!activeSession) return false;
        const v = activeSession.sourceVideo;
        if (v.paused) {
          userPaused = false;
          v.play().catch(() => {});
          activeSession.mirrorVideo.play().catch(() => {});
          return true;
        }
        userPaused = true;
        pauseVideoAllowed(v);
        return false;
      },
      onDoubleTapLike() {
        if (!activePostContainer) return;
        adapter.ensureLiked(activePostContainer);
        setTimeout(refreshPostUI, 120);
        reportLoginWallSoon('Log in to Instagram to like videos');
      },
      onToggleLike() {
        if (!activePostContainer) return;
        const res = adapter.toggleLike(activePostContainer);
        if (!res.ok) {
          pipUI.showToast('Like button not found on this post');
          return;
        }
        if (res.isLiked) pipUI.triggerHeartBurst();
        setTimeout(refreshPostUI, 120);
        reportLoginWallSoon('Log in to Instagram to like videos');
      },
      onToggleSave() {
        if (!activePostContainer) return;
        const res = adapter.toggleSave(activePostContainer);
        if (res.ok) pipUI.showToast(res.isSaved ? 'Saved' : 'Removed from saved');
        setTimeout(refreshPostUI, 120);
        reportLoginWallSoon('Log in to Instagram to save videos');
      },
      onToggleMute: toggleMute,
      onSeek(ratio) {
        if (!activeSession) return;
        const v = activeSession.sourceVideo;
        if (Number.isFinite(v.duration) && v.duration > 0) {
          v.currentTime = ratio * v.duration;
          pipUI.updateProgress(v.currentTime, v.duration);
        }
      },
      onScrollVideo(dir) {
        handleScrollVideo(dir);
      },
      onCarouselStep(dir) {
        if (activePostContainer) adapter.stepCarousel(activePostContainer, dir);
      },
      onOpenComments() {
        openCommentsPane();
      },
      onOpenShare() {
        openSharePane();
      },
      onClosePane() {
        closeActivePane();
      },
      onRefreshPane(pane) {
        if (pane === 'comments') openCommentsPane();
        if (pane === 'share') openSharePane();
      },
      onCommentsScrollMore() {
        commentsSource?.loadMore();
      },
      async onCommentLike(id) {
        const res = await commentsSource?.toggleLike(id);
        if (res && !res.ok) pipUI?.showToast(res.error || 'Could not like that comment');
      },
      onCommentReply(id) {
        return commentsSource ? commentsSource.setReplyTarget(id) : null;
      },
      onCommentReplyCancel() {
        commentsSource?.setReplyTarget(null);
      },
      onCommentViewReplies(id) {
        commentsSource?.toggleReplies(id);
      },
      async onPostComment(text) {
        if (!commentsSource) return { ok: false, error: 'Comments are not loaded yet.' };
        return commentsSource.post(text);
      },
      onShareSearch(query) {
        shareBridge.setSearchQuery(query);
        setTimeout(() => pipUI?.renderShare(shareBridge.scrape()), 260);
      },
      onShareToggleRecipient(id) {
        shareBridge.toggleRecipient(id);
        setTimeout(() => pipUI?.renderShare(shareBridge.scrape()), 90);
      },
      async onShareSend(message) {
        return shareBridge.clickSend(message);
      },
      async onCopyLink() {
        const url = currentPostState()?.postUrl || window.location.href;
        try {
          await pipWindow.navigator.clipboard.writeText(url);
          return true;
        } catch {
          try {
            await navigator.clipboard.writeText(url);
            return true;
          } catch {
            return false;
          }
        }
      },
      onReturnToTab() {
        sendToBackground({ type: 'igpip:focus-opener-tab' });
        closePiP();
      },
    });

    attachVideoToPiP(video);
    sendToBackground({ type: 'igpip:pip-state', isOpen: true });
    updateKeepAlive();
    pipWindow.addEventListener('pagehide', cleanupAfterPiPClose, { once: true });
    return true;
  }

  function computeInitialWindowSize(video) {
    if (video && video.videoWidth > 0 && video.videoHeight > 0 && video.videoWidth / video.videoHeight >= 0.9) {
      return { width: 420, height: 480 };
    }
    return { width: Number(settings.pipWidth) || 364, height: Number(settings.pipHeight) || 628 };
  }

  /** Manual open (Alt+P / toolbar): needs a user gesture, unlike Chrome's automatic path. */
  function openPiP() {
    if (!hasDocPipSupport()) {
      return Promise.resolve({ ok: false, error: 'Document Picture-in-Picture requires Chrome 116+.' });
    }
    if (isPipOpen()) return Promise.resolve({ ok: true, alreadyOpen: true });

    const video = adapter.findActiveVideo(document);
    if (!video) {
      return Promise.resolve({ ok: false, error: 'No Instagram video found on this page.' });
    }

    const { width, height } = computeInitialWindowSize(video);
    setPageBridgeActive(true);
    setProtectedVideo(video);

    let request;
    try {
      request = window.documentPictureInPicture.requestWindow({ width, height, disallowReturnToOpener: false });
    } catch (err) {
      setPageBridgeActive(false);
      return Promise.resolve({ ok: false, error: String(err?.message || err) });
    }
    return request
      .then((win) => ({ ok: mountIntoPipWindow(win, { auto: false, targetVideo: video }) }))
      .catch((err) => {
        setPageBridgeActive(false);
        return { ok: false, error: String(err?.message || err) };
      });
  }

  function cleanupAfterPiPClose() {
    const session = activeSession;
    stopPaneSync();
    closeCommentsSource();
    shareBridge.close();
    detachActiveVideo();
    setPageBridgeActive(false);

    // Closed while the Instagram tab is still in the background: stop the sound instead of
    // letting a hidden tab keep playing. It resumes when the user comes back.
    if (session && isReallyHidden() && !session.sourceVideo.paused) {
      session.sourceVideo.pause();
      pausedByClose = session.sourceVideo;
    }

    pipWindow = null;
    pipUI = null;
    openedAutomatically = false;
    activePostContainer = null;
    isSwitchingVideo = false;
    sendToBackground({ type: 'igpip:pip-state', isOpen: false });
    updateKeepAlive();
  }

  function closePiP() {
    if (isPipOpen()) pipWindow.close();
    else if (pipUI) cleanupAfterPiPClose();
  }

  // Chrome's Automatic PiP (page-bridge.js) opened a window for us.
  window.addEventListener('igpip:auto-pip-opened', () => {
    const win = window.documentPictureInPicture?.window;
    if (win && !win.closed) mountIntoPipWindow(win, { auto: true });
  });

  if (window.documentPictureInPicture && typeof window.documentPictureInPicture.addEventListener === 'function') {
    window.documentPictureInPicture.addEventListener('enter', (e) => {
      const win = e?.window || window.documentPictureInPicture.window;
      if (win && !win.closed && pipWindow !== win) mountIntoPipWindow(win, { auto: true });
    });
  }

  // Real visibility, forwarded by page-bridge.js (Instagram itself is told the tab stays visible).
  window.addEventListener('igpip:real-visibilitychange', (e) => {
    if (!e?.detail?.hidden) {
      // Back on the Instagram tab: the video belongs here again.
      if (isPipOpen() && openedAutomatically) closePiP();
      if (pausedByClose) {
        const v = pausedByClose;
        pausedByClose = null;
        if (v.isConnected && v.paused) v.play().catch(() => {});
      }
    } else if (isPipOpen() && activeSession && !userPaused) {
      const v = activeSession.sourceVideo;
      if (v.paused) v.play().catch(() => {});
    }
    updateKeepAlive();
  });

  // The window lost focus while this tab is on screen (another app or window came forward):
  // ask the background to pop the video out. It checks that the window really is unfocused.
  let blurTimer = 0;
  window.addEventListener(
    'blur',
    (e) => {
      if (e.target !== window) return;
      clearTimeout(blurTimer);
      blurTimer = setTimeout(() => {
        if (document.hasFocus() || isReallyHidden() || isPipOpen()) return;
        if (!settings.autoPipOnWindowBlur) return;
        sendToBackground({ type: 'igpip:page-blur' });
      }, 120);
    },
    true
  );

  // Manual shortcut (Alt+P) while the Instagram tab is focused.
  window.addEventListener('keydown', (e) => {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.code !== 'KeyP') return;
    const tag = (e.target?.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
    e.preventDefault();
    if (isPipOpen()) closePiP();
    else openPiP();
  });

  function getStatus() {
    const playing = findPlayingVideo();
    const anyVideo = activeSession?.sourceVideo || adapter.findActiveVideo(document);
    const audible = isAudible(playing) || keepAliveRunning();
    return {
      ok: true,
      isOpen: isPipOpen(),
      hasDocPip: hasDocPipSupport(),
      hasAutoPip: hasAutoPipSupport(),
      hasVideo: Boolean(anyVideo),
      isPlaying: Boolean(playing),
      isMuted: Boolean(playing && !isAudible(playing)),
      // Chrome only fires Automatic PiP for a tab that is playing audible media.
      autoPipReady: Boolean(playing && audible && hasDocPipSupport() && hasAutoPipSupport()),
      loggedIn: api.isLoggedIn(),
      settings,
    };
  }

  chrome.runtime?.onMessage?.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== 'object') return false;

    if (message.type === 'igpip:get-status') {
      sendResponse(getStatus());
      return false;
    }

    // background.js: the browser window lost focus — may it pop this tab's video out?
    if (message.type === 'igpip:should-pop') {
      updateKeepAlive();
      const status = getStatus();
      sendResponse({
        eligible: Boolean(settings.autoPipOnWindowBlur && !status.isOpen && status.autoPipReady && !isReallyHidden()),
      });
      return false;
    }

    if (message.type === 'igpip:open-pip') {
      openPiP().then((res) => sendResponse(res));
      return true;
    }

    if (message.type === 'igpip:close-pip') {
      closePiP();
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === 'igpip:command-toggle') {
      if (isPipOpen()) {
        closePiP();
        sendResponse({ ok: true, isOpen: false });
        return false;
      }
      openPiP().then((res) => sendResponse(res));
      return true;
    }

    return false;
  });

  loadSettings();
  syncAutoPipRegistration();
  updateKeepAlive();
})();
