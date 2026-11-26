/**
 * Document Picture-in-Picture UI for IG Mini Player.
 *
 * Clean, distraction-free Instagram dark mini player:
 * - Video stage with live mirror / native playback, single-click play/pause, double-click heart burst, scrubber
 * - Minimal top-right Back to Tab control
 * - Right action rail: Like, Comments, Send, Save, Mute (no bulky up/down buttons — scroll normally!)
 * - Trackpad inertia-safe vertical scroll gesture recognizer
 * - Responsive Comments drawer (bottom sheet in compact mode, side-by-side when widened)
 * - Responsive Send / Share to People drawer (live search, multi-select, message, Send, Copy link)
 */
(function initIGPipUI(globalScope) {
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const PIP_STYLES = `
    :root {
      color-scheme: dark;
      --bg: #000000;
      --surface: #121215;
      --surface-2: #1c1c21;
      --surface-3: #27272e;
      --border: rgba(255, 255, 255, 0.11);
      --text: #f5f5f7;
      --muted: #a1a1aa;
      --red: #ff3040;
      --blue: #0095f6;
      --blue-hover: #1877f2;
      --grad: linear-gradient(135deg, #f58529 0%, #dd2a7b 52%, #8134af 100%);
    }

    * {
      box-sizing: border-box;
      -webkit-font-smoothing: antialiased;
    }

    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      user-select: none;
    }

    .igpip-app {
      position: relative;
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      background: #000;
      overflow: hidden;
    }

    @media (min-width: 580px) {
      .igpip-app.has-pane {
        flex-direction: row;
      }
      .igpip-app.has-pane .igpip-stage {
        flex: 1 1 52%;
        height: 100%;
      }
      .igpip-app.has-pane .igpip-drawer {
        position: relative;
        flex: 0 0 48%;
        max-width: 380px;
        min-width: 280px;
        height: 100%;
        border-top: none;
        border-left: 1px solid var(--border);
        border-radius: 0;
      }
    }

    /* Top Right Controls */
    .igpip-topbar {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      z-index: 20;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 6px;
      padding: 10px 10px 22px;
      background: linear-gradient(to bottom, rgba(0, 0, 0, 0.56), rgba(0, 0, 0, 0));
      pointer-events: none;
      transition: opacity 0.2s ease;
    }

    .igpip-topbar-right {
      display: flex;
      align-items: center;
      gap: 6px;
      pointer-events: auto;
    }

    .igpip-top-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      height: 28px;
      min-width: 28px;
      padding: 0 8px;
      border-radius: 999px;
      border: 1px solid rgba(255, 255, 255, 0.14);
      background: rgba(18, 18, 22, 0.68);
      backdrop-filter: blur(10px);
      color: #f5f5f7;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.14s ease, transform 0.12s ease, border-color 0.14s ease;
    }

    .igpip-top-btn:hover {
      background: rgba(40, 40, 48, 0.92);
      transform: scale(1.03);
    }

    .igpip-top-btn.active {
      background: rgba(225, 48, 108, 0.28);
      border-color: rgba(225, 48, 108, 0.7);
      color: #ff85ad;
    }

    .igpip-top-btn svg {
      width: 14px;
      height: 14px;
    }

    /* Main Video Stage */
    .igpip-stage {
      position: relative;
      flex: 1 1 auto;
      min-height: 0;
      width: 100%;
      background: #000;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }

    .igpip-app.has-pane .igpip-stage {
      flex: 0 0 38%;
    }

    .igpip-video-slot {
      position: relative;
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.22s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.2s ease;
    }

    .igpip-video-slot.slide-up {
      transform: translateY(-18px);
      opacity: 0.45;
    }

    .igpip-video-slot.slide-down {
      transform: translateY(18px);
      opacity: 0.45;
    }

    .igpip-video-slot video {
      width: 100% !important;
      height: 100% !important;
      max-width: 100% !important;
      max-height: 100% !important;
      object-fit: contain !important;
      background: #000 !important;
      display: block !important;
      position: static !important;
      transform: none !important;
      pointer-events: none;
    }

    .igpip-gesture-layer {
      position: absolute;
      inset: 0;
      z-index: 6;
      cursor: pointer;
    }

    .igpip-center-badge {
      position: absolute;
      z-index: 12;
      pointer-events: none;
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: rgba(0, 0, 0, 0.56);
      backdrop-filter: blur(8px);
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      opacity: 0;
      transform: scale(0.82);
      transition: opacity 0.16s ease, transform 0.16s ease;
    }

    .igpip-center-badge.visible,
    .igpip-center-badge.paused {
      opacity: 1;
      transform: scale(1);
    }

    .igpip-center-badge svg {
      width: 26px;
      height: 26px;
    }

    .igpip-heart-burst {
      position: absolute;
      z-index: 15;
      pointer-events: none;
      width: 82px;
      height: 82px;
      color: var(--red);
      filter: drop-shadow(0 6px 22px rgba(255, 48, 64, 0.55));
      opacity: 0;
      transform: translate(-50%, -50%) scale(0.25);
    }

    .igpip-heart-burst.pop {
      animation: igpip-heart-pop 0.72s cubic-bezier(0.18, 0.89, 0.32, 1.28) forwards;
    }

    @keyframes igpip-heart-pop {
      0% { opacity: 0; transform: translate(-50%, -50%) scale(0.25) rotate(-10deg); }
      25% { opacity: 1; transform: translate(-50%, -50%) scale(1.18) rotate(6deg); }
      45% { opacity: 1; transform: translate(-50%, -50%) scale(0.96) rotate(0deg); }
      78% { opacity: 0.95; transform: translate(-50%, -50%) scale(1.02) rotate(0deg); }
      100% { opacity: 0; transform: translate(-50%, -50%) scale(1.25) translateY(-16px); }
    }

    /* Right-side Reels Action Rail */
    .igpip-rail {
      position: absolute;
      right: 10px;
      bottom: 24px;
      z-index: 16;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 11px;
      transition: opacity 0.18s ease;
    }

    .igpip-app.has-pane .igpip-rail {
      bottom: 12px;
      gap: 6px;
    }

    .igpip-rail-btn {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      background: transparent;
      border: none;
      color: #fff;
      cursor: pointer;
      padding: 0;
    }

    .igpip-rail-circle {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: rgba(18, 18, 22, 0.68);
      border: 1px solid rgba(255, 255, 255, 0.14);
      backdrop-filter: blur(10px);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.14s ease, background 0.14s ease, border-color 0.14s ease;
    }

    .igpip-app.has-pane .igpip-rail-circle {
      width: 34px;
      height: 34px;
    }

    .igpip-rail-btn:hover .igpip-rail-circle {
      background: rgba(38, 38, 46, 0.9);
      transform: scale(1.07);
    }

    .igpip-rail-btn:active .igpip-rail-circle {
      transform: scale(0.92);
    }

    .igpip-rail-btn.liked .igpip-rail-circle {
      color: var(--red);
      border-color: rgba(255, 48, 64, 0.45);
      background: rgba(255, 48, 64, 0.16);
    }

    .igpip-rail-btn.active-pane .igpip-rail-circle {
      background: rgba(0, 149, 246, 0.28);
      border-color: rgba(0, 149, 246, 0.8);
      color: #66c2ff;
    }

    .igpip-rail-btn.saved .igpip-rail-circle {
      color: #ffd166;
      border-color: rgba(255, 209, 102, 0.45);
    }

    .igpip-rail-circle svg {
      width: 20px;
      height: 20px;
    }

    .igpip-app.has-pane .igpip-rail-circle svg {
      width: 17px;
      height: 17px;
    }

    .igpip-rail-count {
      font-variant-numeric: tabular-nums;
      font-size: 11px;
      font-weight: 600;
      color: #f5f5f7;
      text-shadow: 0 1px 4px rgba(0, 0, 0, 0.9);
      min-height: 13px;
    }

    .igpip-app.has-pane .igpip-rail-count {
      display: none;
    }

    /* Bottom-Left Author + Caption Overlay */
    .igpip-meta {
      position: absolute;
      left: 12px;
      right: 64px;
      bottom: 18px;
      z-index: 14;
      pointer-events: none;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .igpip-app.has-pane .igpip-meta {
      bottom: 10px;
    }

    .igpip-meta-bg {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      height: 130px;
      background: linear-gradient(to top, rgba(0, 0, 0, 0.82), rgba(0, 0, 0, 0));
      z-index: 8;
      pointer-events: none;
    }

    .igpip-author-row {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      pointer-events: auto;
      max-width: 100%;
    }

    .igpip-avatar-wrap {
      display: inline-flex;
      flex: none;
    }

    .igpip-avatar {
      display: block;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      object-fit: cover;
      background: var(--surface-3);
      border: 1.5px solid rgba(255, 255, 255, 0.35);
      flex: none;
    }

    .igpip-avatar-fallback {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: var(--grad);
      color: #fff;
      font-size: 12px;
      font-weight: 700;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .igpip-author-name {
      font-size: 13px;
      font-weight: 700;
      color: #fff;
      text-shadow: 0 1px 4px rgba(0, 0, 0, 0.8);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .igpip-caption {
      pointer-events: auto;
      font-size: 12px;
      line-height: 1.35;
      color: rgba(245, 245, 247, 0.92);
      text-shadow: 0 1px 4px rgba(0, 0, 0, 0.85);
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      cursor: pointer;
    }

    .igpip-caption.expanded {
      -webkit-line-clamp: 8;
      background: rgba(12, 12, 15, 0.78);
      backdrop-filter: blur(8px);
      padding: 6px 8px;
      border-radius: 8px;
    }

    .igpip-app.has-pane .igpip-caption {
      display: none;
    }

    /* Progress Scrubber */
    .igpip-scrubber {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      height: 12px;
      z-index: 18;
      display: flex;
      align-items: flex-end;
      cursor: pointer;
    }

    .igpip-scrubber-track {
      width: 100%;
      height: 3px;
      background: rgba(255, 255, 255, 0.22);
      transition: height 0.14s ease;
      overflow: hidden;
    }

    .igpip-scrubber:hover .igpip-scrubber-track {
      height: 6px;
    }

    .igpip-scrubber-fill {
      height: 100%;
      width: 0%;
      background: var(--grad);
      transition: width 0.08s linear;
    }

    /* Slide-up / Side-by-Side Drawer (Comments & Send) */
    .igpip-drawer {
      display: none;
      flex-direction: column;
      flex: 1 1 62%;
      min-height: 0;
      width: 100%;
      background: var(--surface);
      border-top: 1px solid var(--border);
      border-radius: 16px 16px 0 0;
      z-index: 25;
      overflow: hidden;
      user-select: text;
    }

    .igpip-app.has-pane .igpip-drawer {
      display: flex;
    }

    .igpip-drawer-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--border);
      background: var(--surface);
      flex-shrink: 0;
    }

    .igpip-drawer-title {
      font-size: 14px;
      font-weight: 700;
      color: var(--text);
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .igpip-drawer-count {
      font-size: 12px;
      font-weight: 500;
      color: var(--muted);
    }

    .igpip-drawer-actions {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .igpip-icon-btn {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      border: none;
      background: transparent;
      color: var(--muted);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: background 0.12s ease, color 0.12s ease;
    }

    .igpip-icon-btn:hover {
      background: var(--surface-3);
      color: var(--text);
    }

    .igpip-icon-btn svg {
      width: 16px;
      height: 16px;
    }

    .igpip-pane-body {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      overscroll-behavior: contain;
      padding: 10px 12px;
    }

    .igpip-pane-body::-webkit-scrollbar {
      width: 5px;
    }

    .igpip-pane-body::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.18);
      border-radius: 999px;
    }

    /* Comments List */
    .igpip-comment-item {
      display: flex;
      align-items: flex-start;
      gap: 9px;
      padding: 8px 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    }

    .igpip-comment-item:last-child {
      border-bottom: none;
    }

    .igpip-comment-item.reply {
      margin-left: 37px;
      padding: 6px 0;
    }

    .igpip-comment-item.reply .igpip-comment-avatar,
    .igpip-comment-item.reply .igpip-avatar-fallback {
      width: 22px;
      height: 22px;
      font-size: 10px;
    }

    .igpip-list-foot {
      display: flex;
      justify-content: center;
      padding: 12px 0 4px;
      min-height: 34px;
    }

    .igpip-comment-avatar {
      display: block;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      object-fit: cover;
      background: var(--surface-3);
      flex: none;
    }

    .igpip-comment-main {
      flex: 1 1 auto;
      min-width: 0;
    }

    .igpip-comment-head {
      display: flex;
      align-items: baseline;
      gap: 6px;
      margin-bottom: 2px;
    }

    .igpip-comment-author {
      font-size: 12.5px;
      font-weight: 700;
      color: var(--text);
    }

    .igpip-comment-time {
      font-size: 11px;
      color: var(--muted);
    }

    .igpip-comment-text {
      font-size: 13px;
      line-height: 1.38;
      color: rgba(245, 245, 247, 0.94);
      overflow-wrap: anywhere;
      white-space: pre-wrap;
    }

    .igpip-comment-foot {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-top: 5px;
    }

    .igpip-comment-meta-btn {
      background: none;
      border: none;
      padding: 0;
      color: var(--muted);
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
    }

    .igpip-comment-meta-btn:hover {
      color: var(--text);
    }

    .igpip-comment-like-btn {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      background: none;
      border: none;
      color: var(--muted);
      cursor: pointer;
      padding: 4px;
      flex-shrink: 0;
    }

    .igpip-comment-like-btn:hover {
      color: var(--text);
    }

    .igpip-comment-like-btn.liked {
      color: var(--red);
    }

    .igpip-comment-like-btn svg {
      width: 14px;
      height: 14px;
    }

    .igpip-comment-like-count {
      font-size: 10px;
      color: var(--muted);
      font-variant-numeric: tabular-nums;
    }

    /* Composer Footer */
    .igpip-drawer-footer {
      flex-shrink: 0;
      padding: 8px 10px 10px;
      border-top: 1px solid var(--border);
      background: var(--surface);
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .igpip-reply-chip {
      display: none;
      align-items: center;
      justify-content: space-between;
      padding: 4px 8px;
      border-radius: 6px;
      background: var(--surface-2);
      font-size: 11px;
      color: var(--muted);
    }

    .igpip-reply-chip.visible {
      display: flex;
    }

    .igpip-reply-chip button {
      background: none;
      border: none;
      color: var(--muted);
      cursor: pointer;
      font-size: 13px;
      padding: 0 2px;
    }

    .igpip-input-row {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .igpip-text-input {
      flex: 1 1 auto;
      min-width: 0;
      height: 36px;
      padding: 0 12px;
      border-radius: 999px;
      border: 1px solid var(--border);
      background: var(--surface-2);
      color: var(--text);
      font-size: 13px;
      outline: none;
      transition: border-color 0.14s ease;
    }

    .igpip-text-input:focus {
      border-color: rgba(255, 255, 255, 0.34);
    }

    .igpip-text-input::placeholder {
      color: var(--muted);
    }

    .igpip-primary-btn {
      height: 36px;
      padding: 0 14px;
      border-radius: 999px;
      border: none;
      background: var(--blue);
      color: #fff;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      flex-shrink: 0;
      transition: background 0.14s ease, opacity 0.14s ease;
    }

    .igpip-primary-btn:hover:not(:disabled) {
      background: var(--blue-hover);
    }

    .igpip-primary-btn:disabled {
      opacity: 0.42;
      cursor: default;
    }

    .igpip-secondary-btn {
      height: 34px;
      padding: 0 12px;
      border-radius: 999px;
      border: 1px solid var(--border);
      background: var(--surface-2);
      color: var(--text);
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      transition: background 0.14s ease;
    }

    .igpip-secondary-btn:hover {
      background: var(--surface-3);
    }

    /* Send / Share Recipients */
    .igpip-share-search-wrap {
      padding: 8px 12px 4px;
      flex-shrink: 0;
    }

    .igpip-recipient-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
      gap: 10px;
    }

    .igpip-recipient-card {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      padding: 8px 6px;
      border-radius: 12px;
      border: 1px solid transparent;
      background: var(--surface-2);
      color: var(--text);
      cursor: pointer;
      text-align: center;
      transition: background 0.14s ease, border-color 0.14s ease, transform 0.12s ease;
    }

    .igpip-recipient-card:hover {
      background: var(--surface-3);
      transform: translateY(-1px);
    }

    .igpip-recipient-card.selected {
      border-color: var(--blue);
      background: rgba(0, 149, 246, 0.16);
    }

    .igpip-recipient-avatar-wrap {
      position: relative;
      width: 46px;
      height: 46px;
    }

    .igpip-recipient-avatar {
      width: 46px;
      height: 46px;
      border-radius: 50%;
      object-fit: cover;
      background: var(--surface-3);
    }

    .igpip-recipient-check {
      position: absolute;
      right: -2px;
      bottom: -2px;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: var(--blue);
      border: 2px solid var(--surface);
      color: #fff;
      display: none;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: 800;
    }

    .igpip-recipient-card.selected .igpip-recipient-check {
      display: flex;
    }

    .igpip-recipient-name {
      font-size: 11.5px;
      font-weight: 600;
      color: var(--text);
      width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .igpip-recipient-sub {
      font-size: 10px;
      color: var(--muted);
      width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      margin-top: -4px;
    }

    .igpip-share-actions-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .igpip-share-actions-row .igpip-primary-btn {
      flex: 1 1 auto;
    }

    .igpip-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 28px 16px;
      color: var(--muted);
      font-size: 13px;
      text-align: center;
      line-height: 1.4;
    }

    .igpip-spinner {
      width: 22px;
      height: 22px;
      border-radius: 50%;
      border: 2.5px solid rgba(255, 255, 255, 0.14);
      border-top-color: #fff;
      animation: igpip-spin 0.75s linear infinite;
    }

    @keyframes igpip-spin {
      to { transform: rotate(360deg); }
    }

    .igpip-toast {
      position: absolute;
      left: 50%;
      top: 48px;
      transform: translateX(-50%) translateY(-8px);
      z-index: 40;
      padding: 7px 14px;
      border-radius: 999px;
      background: rgba(20, 20, 26, 0.92);
      border: 1px solid rgba(255, 255, 255, 0.16);
      backdrop-filter: blur(10px);
      color: #fff;
      font-size: 12px;
      font-weight: 600;
      white-space: nowrap;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.18s ease, transform 0.18s ease;
    }

    .igpip-toast.visible {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
  `;

  function makeSvg(doc, paths, { viewBox = '0 0 24 24', fill = 'none', stroke = 'currentColor', strokeWidth = '2' } = {}) {
    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', viewBox);
    svg.setAttribute('fill', fill);
    svg.setAttribute('stroke', stroke);
    svg.setAttribute('stroke-width', strokeWidth);
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    for (const def of paths) {
      const el = doc.createElementNS(SVG_NS, def.tag || 'path');
      for (const [k, v] of Object.entries(def)) {
        if (k === 'tag') continue;
        el.setAttribute(k, v);
      }
      svg.appendChild(el);
    }
    return svg;
  }

  const ICONS = {
    heartOutline: (doc) =>
      makeSvg(doc, [
        { d: 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z' },
      ]),
    heartFilled: (doc) =>
      makeSvg(
        doc,
        [
          { d: 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z' },
        ],
        { fill: 'currentColor', stroke: 'none' }
      ),
    comment: (doc) =>
      makeSvg(doc, [
        { d: 'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z' },
      ]),
    send: (doc) =>
      makeSvg(doc, [
        { d: 'M22 2L11 13' },
        { d: 'M22 2L15 22L11 13L2 9L22 2Z' },
      ]),
    saveOutline: (doc) =>
      makeSvg(doc, [{ d: 'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z' }]),
    saveFilled: (doc) =>
      makeSvg(doc, [{ d: 'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z' }], {
        fill: 'currentColor',
      }),
    volumeOn: (doc) =>
      makeSvg(doc, [
        { d: 'M11 5L6 9H2v6h4l5 4V5z' },
        { d: 'M15.54 8.46a5 5 0 0 1 0 7.07' },
        { d: 'M19.07 4.93a10 10 0 0 1 0 14.14' },
      ]),
    volumeOff: (doc) =>
      makeSvg(doc, [
        { d: 'M11 5L6 9H2v6h4l5 4V5z' },
        { tag: 'line', x1: '23', y1: '9', x2: '17', y2: '15' },
        { tag: 'line', x1: '17', y1: '9', x2: '23', y2: '15' },
      ]),
    play: (doc) =>
      makeSvg(doc, [{ tag: 'polygon', points: '6 3 20 12 6 21 6 3' }], {
        fill: 'currentColor',
        stroke: 'none',
      }),
    pause: (doc) =>
      makeSvg(
        doc,
        [
          { tag: 'rect', x: '6', y: '4', width: '4', height: '16', rx: '1' },
          { tag: 'rect', x: '14', y: '4', width: '4', height: '16', rx: '1' },
        ],
        { fill: 'currentColor', stroke: 'none' }
      ),
    returnTab: (doc) =>
      makeSvg(doc, [
        { d: 'M15 3h6v6' },
        { d: 'M10 14L21 3' },
        { d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' },
      ]),
    splitView: (doc) =>
      makeSvg(doc, [
        { tag: 'rect', x: '3', y: '4', width: '18', height: '16', rx: '2' },
        { tag: 'line', x1: '12', y1: '4', x2: '12', y2: '20' },
      ]),
    close: (doc) =>
      makeSvg(doc, [
        { tag: 'line', x1: '18', y1: '6', x2: '6', y2: '18' },
        { tag: 'line', x1: '6', y1: '6', x2: '18', y2: '18' },
      ]),
    refresh: (doc) =>
      makeSvg(doc, [
        { d: 'M21 12a9 9 0 1 1-2.64-6.36' },
        { d: 'M21 3v6h-6' },
      ]),
    link: (doc) =>
      makeSvg(doc, [
        { d: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71' },
        { d: 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71' },
      ]),
  };

  /**
   * <img> that degrades to an initial instead of a broken-image box. Instagram serves avatars
   * from CDNs that sometimes only answer CORS requests, so the first attempt mirrors the request
   * mode Instagram itself used and the second tries the other one.
   */
  function createAvatar(doc, { src, name, className, crossOrigin = '', size = 0 }) {
    const makeFallback = () => {
      const fb = doc.createElement('span');
      fb.className = 'igpip-avatar-fallback';
      if (size) {
        fb.style.width = `${size}px`;
        fb.style.height = `${size}px`;
        fb.style.fontSize = `${Math.round(size * 0.42)}px`;
      }
      fb.textContent = ((name || '?').replace(/^@+/, '')[0] || '?').toUpperCase();
      return fb;
    };
    if (!src) return makeFallback();

    const img = doc.createElement('img');
    img.className = className;
    img.alt = '';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    if (crossOrigin) img.crossOrigin = crossOrigin;
    let retried = false;
    img.addEventListener('error', () => {
      if (!retried) {
        retried = true;
        if (img.crossOrigin) img.removeAttribute('crossorigin');
        else img.crossOrigin = 'anonymous';
        img.src = src;
        return;
      }
      img.replaceWith(makeFallback());
    });
    img.src = src;
    return img;
  }

  function createScrollGestureHandler(onStep, options = {}) {
    const threshold = options.threshold ?? 56;
    const minCooldownMs = options.minCooldownMs ?? 520;
    const inertiaQuietMs = options.inertiaQuietMs ?? 150;

    let accumY = 0;
    let lastEventTs = 0;
    let lockedUntil = 0;
    let lastTriggerDir = 0;
    let decayAbs = 0;

    return function handleWheel(event) {
      const now = typeof event.timeStamp === 'number' && event.timeStamp > 0 ? event.timeStamp : Date.now();
      let dy = event.deltaY || 0;
      if (event.deltaMode === 1) dy *= 32;
      else if (event.deltaMode === 2) dy *= 400;

      if (Math.abs(dy) < Math.abs(event.deltaX || 0) * 1.15) return false;
      if (Math.abs(dy) < 1) return false;

      const gap = now - lastEventTs;
      lastEventTs = now;
      const absDy = Math.abs(dy);
      const dir = dy > 0 ? 1 : -1;

      if (gap > inertiaQuietMs || (accumY !== 0 && Math.sign(accumY) !== dir)) {
        accumY = 0;
      }

      if (now < lockedUntil) {
        if (dir === lastTriggerDir) {
          decayAbs = Math.min(decayAbs, absDy);
          return false;
        }
      } else if (dir === lastTriggerDir && gap < inertiaQuietMs && absDy <= decayAbs * 1.35 + 4) {
        decayAbs = Math.min(decayAbs, absDy);
        return false;
      }

      accumY += dy;
      if (Math.abs(accumY) >= threshold) {
        accumY = 0;
        lastTriggerDir = dir;
        decayAbs = absDy;
        lockedUntil = now + minCooldownMs;
        onStep(dir);
        return true;
      }
      return false;
    };
  }

  function createPipUI(pipWindow, callbacks) {
    const doc = pipWindow.document;
    doc.title = 'Instagram';

    const styleEl = doc.createElement('style');
    styleEl.textContent = PIP_STYLES;
    doc.head.appendChild(styleEl);
    doc.body.textContent = '';

    const app = doc.createElement('div');
    app.className = 'igpip-app';
    doc.body.appendChild(app);

    const toastEl = doc.createElement('div');
    toastEl.className = 'igpip-toast';
    app.appendChild(toastEl);
    let toastTimer = null;

    function showToast(msg, durationMs = 1900) {
      toastEl.textContent = msg;
      toastEl.classList.add('visible');
      clearTimeout(toastTimer);
      toastTimer = pipWindow.setTimeout(() => {
        toastEl.classList.remove('visible');
      }, durationMs);
    }

    const stage = doc.createElement('div');
    stage.className = 'igpip-stage';
    app.appendChild(stage);

    // Top-right minimal controls only (no redundant top-left brand pill)
    const topbar = doc.createElement('div');
    topbar.className = 'igpip-topbar';
    stage.appendChild(topbar);

    const topRight = doc.createElement('div');
    topRight.className = 'igpip-topbar-right';
    topbar.appendChild(topRight);

    const returnBtn = doc.createElement('button');
    returnBtn.className = 'igpip-top-btn';
    returnBtn.title = 'Back to the Instagram tab';
    returnBtn.appendChild(ICONS.returnTab(doc));
    const returnTxt = doc.createElement('span');
    returnTxt.textContent = 'Tab';
    returnBtn.appendChild(returnTxt);
    topRight.appendChild(returnBtn);

    const videoSlot = doc.createElement('div');
    videoSlot.className = 'igpip-video-slot';
    stage.appendChild(videoSlot);

    const gestureLayer = doc.createElement('div');
    gestureLayer.className = 'igpip-gesture-layer';
    stage.appendChild(gestureLayer);

    const centerBadge = doc.createElement('div');
    centerBadge.className = 'igpip-center-badge';
    stage.appendChild(centerBadge);

    const heartBurst = doc.createElement('div');
    heartBurst.className = 'igpip-heart-burst';
    heartBurst.appendChild(ICONS.heartFilled(doc));
    stage.appendChild(heartBurst);

    const metaBg = doc.createElement('div');
    metaBg.className = 'igpip-meta-bg';
    stage.appendChild(metaBg);

    const metaBox = doc.createElement('div');
    metaBox.className = 'igpip-meta';
    stage.appendChild(metaBox);

    const authorRow = doc.createElement('div');
    authorRow.className = 'igpip-author-row';
    const avatarWrap = doc.createElement('span');
    avatarWrap.className = 'igpip-avatar-wrap';
    let avatarKey = null;
    const authorNameEl = doc.createElement('span');
    authorNameEl.className = 'igpip-author-name';
    authorRow.append(avatarWrap, authorNameEl);

    const captionEl = doc.createElement('div');
    captionEl.className = 'igpip-caption';
    captionEl.addEventListener('click', (e) => {
      e.stopPropagation();
      captionEl.classList.toggle('expanded');
    });
    metaBox.append(authorRow, captionEl);

    // Clean right action rail (Like, Comments, Send, Save, Mute — scroll normally without arrow buttons)
    const rail = doc.createElement('div');
    rail.className = 'igpip-rail';
    stage.appendChild(rail);

    function createRailButton(title, iconNode, withCount = false) {
      const btn = doc.createElement('button');
      btn.className = 'igpip-rail-btn';
      btn.title = title;
      const circle = doc.createElement('span');
      circle.className = 'igpip-rail-circle';
      circle.appendChild(iconNode);
      btn.appendChild(circle);
      let countEl = null;
      if (withCount) {
        countEl = doc.createElement('span');
        countEl.className = 'igpip-rail-count';
        btn.appendChild(countEl);
      }
      rail.appendChild(btn);
      return { btn, circle, countEl };
    }

    const likeCtrl = createRailButton('Like (L or double-click video)', ICONS.heartOutline(doc), true);
    const commentCtrl = createRailButton('Comments (C)', ICONS.comment(doc), true);
    const shareCtrl = createRailButton('Send to people (S)', ICONS.send(doc), false);
    const saveCtrl = createRailButton('Save', ICONS.saveOutline(doc), false);
    const muteCtrl = createRailButton('Mute / Unmute (M)', ICONS.volumeOn(doc), false);

    // Scrubber
    const scrubber = doc.createElement('div');
    scrubber.className = 'igpip-scrubber';
    const scrubberTrack = doc.createElement('div');
    scrubberTrack.className = 'igpip-scrubber-track';
    const scrubberFill = doc.createElement('div');
    scrubberFill.className = 'igpip-scrubber-fill';
    scrubberTrack.appendChild(scrubberFill);
    scrubber.appendChild(scrubberTrack);
    stage.appendChild(scrubber);

    // Drawer (Comments & Send)
    const drawer = doc.createElement('div');
    drawer.className = 'igpip-drawer';
    app.appendChild(drawer);

    const drawerHeader = doc.createElement('div');
    drawerHeader.className = 'igpip-drawer-header';
    const drawerTitleWrap = doc.createElement('div');
    drawerTitleWrap.className = 'igpip-drawer-title';
    const drawerTitleText = doc.createElement('span');
    const drawerCountEl = doc.createElement('span');
    drawerCountEl.className = 'igpip-drawer-count';
    drawerTitleWrap.append(drawerTitleText, drawerCountEl);

    const drawerActions = doc.createElement('div');
    drawerActions.className = 'igpip-drawer-actions';

    const splitBtn = doc.createElement('button');
    splitBtn.className = 'igpip-icon-btn';
    splitBtn.title = 'Toggle wide side-by-side view';
    splitBtn.appendChild(ICONS.splitView(doc));

    const refreshBtn = doc.createElement('button');
    refreshBtn.className = 'igpip-icon-btn';
    refreshBtn.title = 'Refresh';
    refreshBtn.appendChild(ICONS.refresh(doc));

    const closeDrawerBtn = doc.createElement('button');
    closeDrawerBtn.className = 'igpip-icon-btn';
    closeDrawerBtn.title = 'Close pane (Esc)';
    closeDrawerBtn.appendChild(ICONS.close(doc));

    drawerActions.append(splitBtn, refreshBtn, closeDrawerBtn);
    drawerHeader.append(drawerTitleWrap, drawerActions);
    drawer.appendChild(drawerHeader);

    const shareSearchWrap = doc.createElement('div');
    shareSearchWrap.className = 'igpip-share-search-wrap';
    shareSearchWrap.style.display = 'none';
    const shareSearchInput = doc.createElement('input');
    shareSearchInput.type = 'search';
    shareSearchInput.className = 'igpip-text-input';
    shareSearchInput.placeholder = 'Search people or groups...';
    shareSearchInput.style.width = '100%';
    shareSearchWrap.appendChild(shareSearchInput);
    drawer.appendChild(shareSearchWrap);

    const paneBody = doc.createElement('div');
    paneBody.className = 'igpip-pane-body';
    drawer.appendChild(paneBody);

    const drawerFooter = doc.createElement('div');
    drawerFooter.className = 'igpip-drawer-footer';
    drawer.appendChild(drawerFooter);

    const commentsFooter = doc.createElement('div');
    commentsFooter.style.display = 'none';
    commentsFooter.style.flexDirection = 'column';
    commentsFooter.style.gap = '6px';

    const replyChip = doc.createElement('div');
    replyChip.className = 'igpip-reply-chip';
    const replyChipLabel = doc.createElement('span');
    const replyChipClear = doc.createElement('button');
    replyChipClear.textContent = '×';
    replyChipClear.title = 'Cancel reply';
    replyChip.append(replyChipLabel, replyChipClear);

    const commentInputRow = doc.createElement('div');
    commentInputRow.className = 'igpip-input-row';
    const commentInput = doc.createElement('input');
    commentInput.type = 'text';
    commentInput.className = 'igpip-text-input';
    commentInput.placeholder = 'Add a comment...';
    const commentPostBtn = doc.createElement('button');
    commentPostBtn.className = 'igpip-primary-btn';
    commentPostBtn.textContent = 'Post';
    commentPostBtn.disabled = true;
    commentInputRow.append(commentInput, commentPostBtn);
    commentsFooter.append(replyChip, commentInputRow);

    const shareFooter = doc.createElement('div');
    shareFooter.style.display = 'none';
    shareFooter.style.flexDirection = 'column';
    shareFooter.style.gap = '8px';

    const shareMsgInput = doc.createElement('input');
    shareMsgInput.type = 'text';
    shareMsgInput.className = 'igpip-text-input';
    shareMsgInput.placeholder = 'Write a message (optional)...';
    shareMsgInput.style.display = 'none';

    const shareActionsRow = doc.createElement('div');
    shareActionsRow.className = 'igpip-share-actions-row';
    const copyLinkBtn = doc.createElement('button');
    copyLinkBtn.className = 'igpip-secondary-btn';
    copyLinkBtn.appendChild(ICONS.link(doc));
    const copyLinkTxt = doc.createElement('span');
    copyLinkTxt.textContent = 'Copy link';
    copyLinkBtn.appendChild(copyLinkTxt);

    const shareSendBtn = doc.createElement('button');
    shareSendBtn.className = 'igpip-primary-btn';
    shareSendBtn.textContent = 'Send';
    shareSendBtn.disabled = true;

    shareActionsRow.append(copyLinkBtn, shareSendBtn);
    shareFooter.append(shareMsgInput, shareActionsRow);

    drawerFooter.append(commentsFooter, shareFooter);

    // State
    let activePane = null;
    let isWide = false;
    let compactSize = { width: pipWindow.outerWidth || 364, height: pipWindow.outerHeight || 628 };
    let clickTimer = null;
    let badgeTimer = null;
    let shareSearchTimer = null;
    let isPostingComment = false;
    let isSendingShare = false;

    function flashCenterBadge(iconName) {
      // Pausing leaves the persistent play badge (setPlaying); only "play" needs a flash.
      if (iconName !== 'play') return;
      centerBadge.textContent = '';
      centerBadge.appendChild(ICONS.play(doc));
      centerBadge.classList.add('visible');
      clearTimeout(badgeTimer);
      badgeTimer = pipWindow.setTimeout(() => {
        centerBadge.classList.remove('visible');
      }, 420);
    }

    function triggerHeartBurst(clientX, clientY) {
      const rect = stage.getBoundingClientRect();
      const x = typeof clientX === 'number' ? clientX - rect.left : rect.width / 2;
      const y = typeof clientY === 'number' ? clientY - rect.top : rect.height / 2;
      heartBurst.style.left = `${x}px`;
      heartBurst.style.top = `${y}px`;
      heartBurst.classList.remove('pop');
      void heartBurst.offsetWidth;
      heartBurst.classList.add('pop');
    }

    gestureLayer.addEventListener('click', (e) => {
      if (clickTimer) {
        clearTimeout(clickTimer);
        clickTimer = null;
        triggerHeartBurst(e.clientX, e.clientY);
        callbacks.onDoubleTapLike?.();
        return;
      }
      clickTimer = pipWindow.setTimeout(() => {
        clickTimer = null;
        const playing = callbacks.onTogglePlayPause?.();
        flashCenterBadge(playing ? 'play' : 'pause');
      }, 215);
    });

    const handleStageWheel = createScrollGestureHandler((dir) => {
      callbacks.onScrollVideo?.(dir);
    });

    stage.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        handleStageWheel(e);
      },
      { passive: false }
    );

    let commentScrollThrottle = 0;
    paneBody.addEventListener('scroll', () => {
      if (activePane !== 'comments') return;
      const now = Date.now();
      if (now - commentScrollThrottle < 350) return;
      if (paneBody.scrollTop + paneBody.clientHeight >= paneBody.scrollHeight - 90) {
        commentScrollThrottle = now;
        callbacks.onCommentsScrollMore?.();
      }
    });

    function seekFromEvent(e) {
      const rect = scrubber.getBoundingClientRect();
      if (rect.width <= 0) return;
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      callbacks.onSeek?.(ratio);
    }

    let isScrubbing = false;
    scrubber.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      isScrubbing = true;
      scrubber.setPointerCapture?.(e.pointerId);
      seekFromEvent(e);
    });
    scrubber.addEventListener('pointermove', (e) => {
      if (!isScrubbing) return;
      seekFromEvent(e);
    });
    scrubber.addEventListener('pointerup', () => {
      isScrubbing = false;
    });

    returnBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      callbacks.onReturnToTab?.();
    });

    likeCtrl.btn.addEventListener('click', (e) => {
      e.stopPropagation();
      callbacks.onToggleLike?.();
    });

    commentCtrl.btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (activePane === 'comments') callbacks.onClosePane?.();
      else callbacks.onOpenComments?.();
    });

    shareCtrl.btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (activePane === 'share') callbacks.onClosePane?.();
      else callbacks.onOpenShare?.();
    });

    saveCtrl.btn.addEventListener('click', (e) => {
      e.stopPropagation();
      callbacks.onToggleSave?.();
    });

    muteCtrl.btn.addEventListener('click', (e) => {
      e.stopPropagation();
      callbacks.onToggleMute?.();
    });

    splitBtn.addEventListener('click', () => {
      try {
        if (!isWide && pipWindow.innerWidth < 580) {
          compactSize = { width: pipWindow.outerWidth || 364, height: pipWindow.outerHeight || 628 };
          pipWindow.resizeTo(700, Math.max(580, compactSize.height));
          isWide = true;
        } else {
          pipWindow.resizeTo(Math.min(compactSize.width, 400), Math.max(compactSize.height, 560));
          isWide = false;
        }
      } catch {
        // Ignore
      }
    });

    refreshBtn.addEventListener('click', () => {
      callbacks.onRefreshPane?.(activePane);
    });

    closeDrawerBtn.addEventListener('click', () => {
      callbacks.onClosePane?.();
    });

    commentInput.addEventListener('input', () => {
      commentPostBtn.disabled = isPostingComment || !commentInput.value.trim();
      if (replyTargetId !== null && !commentInput.value.trim()) clearReplyTarget();
    });

    async function submitComment() {
      const text = commentInput.value.trim();
      if (!text || isPostingComment) return;
      isPostingComment = true;
      commentPostBtn.disabled = true;
      commentPostBtn.textContent = '...';
      const res = await callbacks.onPostComment?.(text);
      isPostingComment = false;
      commentPostBtn.textContent = 'Post';
      if (res && res.ok) {
        commentInput.value = '';
        replyTargetId = null;
        replyChip.classList.remove('visible');
        showToast('Comment posted');
      } else {
        showToast(res?.error || 'Could not post comment');
      }
      commentPostBtn.disabled = !commentInput.value.trim();
    }

    commentPostBtn.addEventListener('click', submitComment);
    commentInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submitComment();
      }
    });

    function clearReplyTarget() {
      if (replyTargetId !== null) callbacks.onCommentReplyCancel?.();
      replyTargetId = null;
      replyChip.classList.remove('visible');
    }

    replyChipClear.addEventListener('click', () => {
      clearReplyTarget();
      commentInput.value = '';
      commentPostBtn.disabled = true;
    });

    shareSearchInput.addEventListener('input', () => {
      clearTimeout(shareSearchTimer);
      const q = shareSearchInput.value;
      shareSearchTimer = pipWindow.setTimeout(() => {
        callbacks.onShareSearch?.(q);
      }, 180);
    });

    copyLinkBtn.addEventListener('click', async () => {
      const ok = await callbacks.onCopyLink?.();
      if (ok) {
        copyLinkTxt.textContent = 'Copied';
        showToast('Link copied');
        pipWindow.setTimeout(() => {
          copyLinkTxt.textContent = 'Copy link';
        }, 1600);
      } else {
        showToast('Could not copy link');
      }
    });

    shareSendBtn.addEventListener('click', async () => {
      if (isSendingShare || shareSendBtn.disabled) return;
      isSendingShare = true;
      shareSendBtn.disabled = true;
      const origLabel = shareSendBtn.textContent;
      shareSendBtn.textContent = 'Sending...';
      const res = await callbacks.onShareSend?.(shareMsgInput.value);
      isSendingShare = false;
      if (res && res.ok) {
        shareMsgInput.value = '';
        shareSendBtn.textContent = 'Send';
        showToast('Sent');
        callbacks.onClosePane?.();
      } else {
        shareSendBtn.textContent = origLabel;
        shareSendBtn.disabled = false;
        showToast(res?.error || 'Could not send');
      }
    });

    pipWindow.addEventListener('keydown', (e) => {
      const tag = (e.target?.tagName || '').toUpperCase();
      const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable;
      if (e.key === 'Escape') {
        if (activePane) {
          e.preventDefault();
          callbacks.onClosePane?.();
        }
        return;
      }
      if (isTyping) return;

      if (e.key === 'ArrowDown' || e.key === 'j' || e.key === 'J') {
        e.preventDefault();
        callbacks.onScrollVideo?.(1);
      } else if (e.key === 'ArrowUp' || e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        callbacks.onScrollVideo?.(-1);
      } else if (e.key === 'ArrowRight') {
        callbacks.onCarouselStep?.(1);
      } else if (e.key === 'ArrowLeft') {
        callbacks.onCarouselStep?.(-1);
      } else if (e.key === ' ') {
        e.preventDefault();
        const playing = callbacks.onTogglePlayPause?.();
        flashCenterBadge(playing ? 'play' : 'pause');
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        callbacks.onToggleMute?.();
      } else if (e.key === 'l' || e.key === 'L') {
        e.preventDefault();
        callbacks.onToggleLike?.();
      } else if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        if (activePane === 'comments') callbacks.onClosePane?.();
        else callbacks.onOpenComments?.();
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        if (activePane === 'share') callbacks.onClosePane?.();
        else callbacks.onOpenShare?.();
      }
    });

    function mountVideoElement(videoEl) {
      videoSlot.textContent = '';
      if (videoEl) {
        videoSlot.appendChild(videoEl);
      }
    }

    function createMirrorVideoElement() {
      const v = doc.createElement('video');
      v.muted = true;
      v.autoplay = true;
      v.playsInline = true;
      v.controls = false;
      return v;
    }

    function showTransition(direction) {
      const cls = direction > 0 ? 'slide-up' : 'slide-down';
      videoSlot.classList.remove('slide-up', 'slide-down');
      videoSlot.classList.add(cls);
      pipWindow.setTimeout(() => {
        videoSlot.classList.remove('slide-up', 'slide-down');
      }, 260);
    }

    function updatePostState(state) {
      if (!state) return;

      const cleanAuthor = (state.authorName || '').trim().replace(/^@+/, '');
      doc.title = cleanAuthor ? `@${cleanAuthor} · Instagram` : 'Instagram';
      authorNameEl.textContent = cleanAuthor ? `@${cleanAuthor}` : '';

      // Only touch the avatar when it actually changed (this runs on every Instagram DOM change).
      const nextAvatarKey = `${cleanAuthor}|${state.authorAvatar || ''}`;
      if (nextAvatarKey !== avatarKey) {
        avatarKey = nextAvatarKey;
        avatarWrap.textContent = '';
        if (state.authorAvatar || cleanAuthor) {
          avatarWrap.appendChild(
            createAvatar(doc, {
              src: state.authorAvatar,
              name: cleanAuthor,
              className: 'igpip-avatar',
              crossOrigin: state.authorAvatarCrossOrigin || '',
            })
          );
        }
      }

      captionEl.textContent = state.caption || '';
      captionEl.style.display = state.caption ? '' : 'none';

      likeCtrl.btn.classList.toggle('liked', Boolean(state.isLiked));
      setIcon(likeCtrl, state.isLiked ? 'heartFilled' : 'heartOutline');
      if (likeCtrl.countEl) likeCtrl.countEl.textContent = state.likeCount || '';

      if (commentCtrl.countEl) commentCtrl.countEl.textContent = state.commentCount || '';

      saveCtrl.btn.classList.toggle('saved', Boolean(state.isSaved));
      setIcon(saveCtrl, state.isSaved ? 'saveFilled' : 'saveOutline');
      saveCtrl.btn.style.display = state.saveBtn ? '' : 'none';

      setIcon(muteCtrl, state.isMuted ? 'volumeOff' : 'volumeOn');
      muteCtrl.btn.title = state.isMuted ? 'Unmute (M)' : 'Mute (M)';

      updateProgress(state.currentTime, state.duration);
      setPlaying(Boolean(state.isPlaying));
    }

    function setIcon(ctrl, iconName) {
      if (ctrl.iconName === iconName) return;
      ctrl.iconName = iconName;
      ctrl.circle.textContent = '';
      ctrl.circle.appendChild(ICONS[iconName](doc));
    }

    /** A paused video keeps a play badge on screen so a frozen frame never looks like a hang. */
    let shownPaused = false;
    function setPlaying(isPlaying) {
      const paused = !isPlaying;
      if (paused === shownPaused) return;
      shownPaused = paused;
      if (paused) {
        centerBadge.textContent = '';
        centerBadge.appendChild(ICONS.play(doc));
      }
      centerBadge.classList.toggle('paused', paused);
    }

    function updateProgress(currentTime, duration) {
      if (!duration || duration <= 0) {
        scrubberFill.style.width = '0%';
        return;
      }
      const pct = Math.max(0, Math.min(100, (currentTime / duration) * 100));
      scrubberFill.style.width = `${pct.toFixed(2)}%`;
    }

    function setActivePane(pane) {
      activePane = pane;
      app.classList.toggle('has-pane', Boolean(pane));
      commentCtrl.btn.classList.toggle('active-pane', pane === 'comments');
      shareCtrl.btn.classList.toggle('active-pane', pane === 'share');

      drawerFooter.style.display = pane === 'share' ? '' : 'none';
      shareSearchWrap.style.display = pane === 'share' ? 'block' : 'none';
      commentsFooter.style.display = pane === 'comments' ? 'flex' : 'none';
      shareFooter.style.display = pane === 'share' ? 'flex' : 'none';

      commentsSignature = '';
      replyTargetId = null;
      replyChip.classList.remove('visible');
      if (pane === 'comments') {
        drawerTitleText.textContent = 'Comments';
        drawerCountEl.textContent = '';
        commentInput.value = '';
        commentPostBtn.disabled = true;
        commentsFooter.style.display = 'none';
        paneBody.scrollTop = 0;
        renderLoading('Loading comments...');
      } else if (pane === 'share') {
        drawerTitleText.textContent = 'Send to';
        drawerCountEl.textContent = '';
        shareSearchInput.value = '';
        shareMsgInput.value = '';
        shareMsgInput.style.display = 'none';
        shareSendBtn.textContent = 'Send';
        shareSendBtn.disabled = true;
        renderLoading('Loading contacts...');
      } else {
        paneBody.textContent = '';
        replyChip.classList.remove('visible');
      }
    }

    function renderLoading(message) {
      paneBody.textContent = '';
      const box = doc.createElement('div');
      box.className = 'igpip-empty';
      const spin = doc.createElement('div');
      spin.className = 'igpip-spinner';
      const txt = doc.createElement('span');
      txt.textContent = message;
      box.append(spin, txt);
      paneBody.appendChild(box);
    }

    let commentsSignature = '';
    let replyTargetId = null;

    function renderComments(data) {
      if (activePane !== 'comments') return;
      if (data.isLoading) {
        commentsSignature = '';
        renderLoading('Loading comments...');
        return;
      }

      const comments = data.comments || [];
      const total = Math.max(Number(data.total) || 0, comments.length);
      drawerCountEl.textContent = total > 0 ? `(${total.toLocaleString('en-US')})` : '';
      commentsFooter.style.display = data.hasComposer ? 'flex' : 'none';
      drawerFooter.style.display = data.hasComposer ? '' : 'none';

      // This is called on every change Instagram makes; skip the rebuild when nothing we show changed.
      const signature = JSON.stringify([
        comments.map((c) => [c.id, c.text, c.likesText, c.isLiked, c.repliesLabel, c.depth, c.time]),
        data.hasMore,
        data.isLoadingMore,
        data.emptyMessage,
        data.hasComposer,
      ]);
      if (signature === commentsSignature) return;
      commentsSignature = signature;

      const prevScrollTop = paneBody.scrollTop;
      paneBody.textContent = '';
      if (comments.length === 0) {
        const empty = doc.createElement('div');
        empty.className = 'igpip-empty';
        empty.textContent =
          data.emptyMessage || (data.hasComposer ? 'No comments yet. Start the conversation.' : 'No comments on this video.');
        paneBody.appendChild(empty);
        return;
      }

      const frag = doc.createDocumentFragment();
      for (const c of comments) {
        const row = doc.createElement('div');
        row.className = `igpip-comment-item${c.depth ? ' reply' : ''}`;
        row.appendChild(createAvatar(doc, { src: c.avatar, name: c.author, className: 'igpip-comment-avatar', crossOrigin: 'anonymous' }));

        const main = doc.createElement('div');
        main.className = 'igpip-comment-main';

        const head = doc.createElement('div');
        head.className = 'igpip-comment-head';
        const authorSpan = doc.createElement('span');
        authorSpan.className = 'igpip-comment-author';
        authorSpan.textContent = c.author;
        head.appendChild(authorSpan);
        if (c.time) {
          const timeSpan = doc.createElement('span');
          timeSpan.className = 'igpip-comment-time';
          timeSpan.textContent = c.time;
          head.appendChild(timeSpan);
        }
        main.appendChild(head);

        const body = doc.createElement('div');
        body.className = 'igpip-comment-text';
        body.textContent = c.text;
        main.appendChild(body);

        const foot = doc.createElement('div');
        foot.className = 'igpip-comment-foot';
        if (c.canReply && data.hasComposer) {
          const rBtn = doc.createElement('button');
          rBtn.className = 'igpip-comment-meta-btn';
          rBtn.textContent = 'Reply';
          rBtn.addEventListener('click', () => {
            const handle = callbacks.onCommentReply?.(c.id) || c.author;
            replyTargetId = c.id;
            replyChipLabel.textContent = `Replying to @${handle}`;
            replyChip.classList.add('visible');
            if (!commentInput.value.startsWith(`@${handle} `)) {
              commentInput.value = `@${handle} ${commentInput.value}`;
            }
            commentPostBtn.disabled = !commentInput.value.trim();
            commentInput.focus();
          });
          foot.appendChild(rBtn);
        }
        if (c.repliesLabel) {
          const vrBtn = doc.createElement('button');
          vrBtn.className = 'igpip-comment-meta-btn';
          vrBtn.textContent = c.repliesLabel;
          vrBtn.addEventListener('click', () => {
            callbacks.onCommentViewReplies?.(c.id);
          });
          foot.appendChild(vrBtn);
        }
        if (foot.childNodes.length > 0) main.appendChild(foot);
        row.appendChild(main);

        if (c.canLike) {
          const likeBtn = doc.createElement('button');
          likeBtn.className = `igpip-comment-like-btn${c.isLiked ? ' liked' : ''}`;
          likeBtn.title = c.isLiked ? 'Unlike comment' : 'Like comment';
          likeBtn.appendChild(c.isLiked ? ICONS.heartFilled(doc) : ICONS.heartOutline(doc));
          if (c.likesText) {
            const cnt = doc.createElement('span');
            cnt.className = 'igpip-comment-like-count';
            cnt.textContent = c.likesText;
            likeBtn.appendChild(cnt);
          }
          likeBtn.addEventListener('click', () => {
            callbacks.onCommentLike?.(c.id);
          });
          row.appendChild(likeBtn);
        }

        frag.appendChild(row);
      }

      if (data.isLoadingMore) {
        const foot = doc.createElement('div');
        foot.className = 'igpip-list-foot';
        const spin = doc.createElement('div');
        spin.className = 'igpip-spinner';
        foot.appendChild(spin);
        frag.appendChild(foot);
      }

      paneBody.appendChild(frag);
      paneBody.scrollTop = prevScrollTop;
      // A short first page may not fill the pane, in which case no scroll event would ever ask for more.
      if (data.hasMore && !data.isLoadingMore && paneBody.scrollHeight <= paneBody.clientHeight + 90) {
        callbacks.onCommentsScrollMore?.();
      }
    }

    function renderShare(data) {
      if (activePane !== 'share') return;
      if (data.isLoading) {
        renderLoading('Loading contacts...');
        return;
      }

      drawerCountEl.textContent = data.selectedCount > 0 ? `(${data.selectedCount} selected)` : '';
      shareMsgInput.style.display = data.selectedCount > 0 || data.hasMessageInput ? 'block' : 'none';
      shareSendBtn.textContent =
        data.selectedCount > 0 ? `${data.sendLabel || 'Send'} (${data.selectedCount})` : data.sendLabel || 'Send';
      shareSendBtn.disabled = isSendingShare || !data.canSend;

      const prevScrollTop = paneBody.scrollTop;
      paneBody.textContent = '';

      if (!data.recipients || data.recipients.length === 0) {
        const empty = doc.createElement('div');
        empty.className = 'igpip-empty';
        empty.textContent =
          data.emptyMessage ||
          (data.query
            ? `No people found for "${data.query}".`
            : 'No suggested people yet. Search above, or copy the link below.');
        paneBody.appendChild(empty);
        return;
      }

      const grid = doc.createElement('div');
      grid.className = 'igpip-recipient-grid';
      for (const r of data.recipients) {
        const card = doc.createElement('button');
        card.type = 'button';
        card.className = `igpip-recipient-card${r.isSelected ? ' selected' : ''}`;

        const avWrap = doc.createElement('div');
        avWrap.className = 'igpip-recipient-avatar-wrap';
        avWrap.appendChild(
          createAvatar(doc, { src: r.avatar, name: r.name, className: 'igpip-recipient-avatar', crossOrigin: 'anonymous', size: 46 })
        );
        const check = doc.createElement('span');
        check.className = 'igpip-recipient-check';
        check.textContent = '✓';
        avWrap.appendChild(check);

        const nameEl = doc.createElement('span');
        nameEl.className = 'igpip-recipient-name';
        nameEl.textContent = r.name;

        card.append(avWrap, nameEl);
        if (r.username) {
          const sub = doc.createElement('span');
          sub.className = 'igpip-recipient-sub';
          sub.textContent = r.username;
          card.appendChild(sub);
        }

        card.addEventListener('click', () => {
          callbacks.onShareToggleRecipient?.(r.id);
        });
        grid.appendChild(card);
      }

      paneBody.appendChild(grid);
      paneBody.scrollTop = prevScrollTop;
    }

    function getActivePane() {
      return activePane;
    }

    return {
      mountVideoElement,
      createMirrorVideoElement,
      showTransition,
      updatePostState,
      updateProgress,
      setActivePane,
      renderComments,
      renderShare,
      showToast,
      triggerHeartBurst,
      getActivePane,
      setPlaying,
    };
  }

  const uiModule = { createPipUI, createScrollGestureHandler, PIP_STYLES };
  globalScope.__IGPipUI = uiModule;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = uiModule;
  }
})(typeof window !== 'undefined' ? window : globalThis);
