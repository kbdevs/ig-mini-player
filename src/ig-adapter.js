/**
 * Instagram DOM Adapter for IG Mini Player.
 *
 * Uses semantic DOM structure, ARIA labels, SVG dimensions, and DOM-diff MutationObservers
 * rather than obfuscated Instagram CSS class names.
 */
(function initIGPipAdapter(globalScope) {
  const RESERVED_PATH_SEGMENTS = new Set([
    'reels',
    'reel',
    'p',
    'explore',
    'direct',
    'stories',
    'accounts',
    'audio',
    'tags',
    'locations',
    'about',
    'legal',
    'developer',
    'api',
    'static',
    'tv',
    'live',
    'c',
  ]);

  const EXTERNAL_SHARE_LABELS = new Set([
    'copy link',
    'facebook',
    'messenger',
    'whatsapp',
    'email',
    'threads',
    'x',
    'twitter',
    'telegram',
    'sms',
    'see all',
    'more',
    'share',
    'embed',
  ]);

  let inputTokenCounter = 0;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function isElementVisible(el, win = globalScope) {
    if (!el || !el.isConnected) return false;
    const style = win.getComputedStyle ? win.getComputedStyle(el) : null;
    if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) {
      return false;
    }
    const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    if (!rect) return true;
    return rect.width > 0 && rect.height > 0;
  }

  function getSvgLabel(svg) {
    if (!svg) return '';
    const aria = svg.getAttribute('aria-label');
    if (aria) return aria.trim();
    const title = svg.querySelector('title');
    if (title && title.textContent) return title.textContent.trim();
    return '';
  }

  function getSvgDimension(svg) {
    if (!svg) return 0;
    const wAttr = parseFloat(svg.getAttribute('width') || '0');
    const hAttr = parseFloat(svg.getAttribute('height') || '0');
    if (wAttr > 0 || hAttr > 0) return Math.max(wAttr, hAttr);
    const rect = svg.getBoundingClientRect ? svg.getBoundingClientRect() : null;
    return rect ? Math.max(rect.width, rect.height) : 0;
  }

  function findClickableParent(el, stopAt) {
    let cur = el;
    while (cur && cur !== stopAt && cur !== cur.ownerDocument?.body) {
      const tag = (cur.tagName || '').toUpperCase();
      if (tag === 'BUTTON' || tag === 'A' || cur.getAttribute('role') === 'button') {
        return cur;
      }
      cur = cur.parentElement;
    }
    return el?.parentElement || el || null;
  }

  function isCompactCount(text) {
    if (!text) return false;
    const t = text.trim();
    return /^\d[\d.,\s]*[KMBkmb]?$/.test(t);
  }

  function extractNearbyCount(buttonEl, container, kind = '') {
    if (!buttonEl) return '';

    // 1. Check leaf text spans INSIDE the button first!
    // On Instagram Reels, the <div role="button"> wraps BOTH <svg><title>Like</title></svg> AND <span>84.6K</span>.
    const innerNodes = buttonEl.querySelectorAll('span, div');
    for (const node of innerNodes) {
      if (node.querySelector('svg')) continue;
      if (node.children.length > 0 && node.querySelector('span')) continue;
      const txt = (node.textContent || '').trim();
      if (isCompactCount(txt)) return txt;
    }

    const directText = (buttonEl.textContent || '').trim();
    if (isCompactCount(directText)) return directText;

    // 2. Count rendered beside the button: the next sibling of the button, or of a wrapper that
    //    holds nothing but the button (post pages nest it two levels deep).
    let node = buttonEl;
    for (let depth = 0; depth < 4 && node && node !== container; depth++) {
      const sib = node.nextElementSibling;
      if (sib) {
        const txt = (sib.textContent || '').trim();
        if (!sib.querySelector('svg') && isCompactCount(txt)) return txt;
        break; // Reached the row of action buttons: anything further belongs to another button.
      }
      node = node.parentElement;
    }

    // 3. Sibling / parent spans (outside the button itself)
    const parent = buttonEl.parentElement;
    if (parent && parent !== container) {
      const nextSib = buttonEl.nextElementSibling;
      if (nextSib) {
        const txt = (nextSib.textContent || '').trim();
        if (isCompactCount(txt)) return txt;
      }
      const candidates = parent.querySelectorAll('span, div, a');
      for (const node of candidates) {
        if (node.contains(buttonEl) || buttonEl.contains(node)) continue;
        if (node.querySelector('svg')) continue;
        const txt = (node.textContent || '').trim();
        if (isCompactCount(txt)) return txt;
      }
    }

    // 4. Home feed "1,234 likes" (only for like count)
    if (kind === 'like' && container) {
      const likedLink = container.querySelector('a[href*="/liked_by/"]');
      if (likedLink) {
        const match = (likedLink.textContent || '').match(/([\d.,]+[KMBkmb]?)\s*likes?/i);
        if (match) return match[1];
      }
    }
    return '';
  }

  function setReactInputValue(inputEl, text, doc = document) {
    if (!inputEl) return false;
    const token = `igpip-in-${Date.now()}-${++inputTokenCounter}`;
    inputEl.setAttribute('data-igpip-input-target', token);
    inputEl.removeAttribute('data-igpip-input-result');

    try {
      const win = doc.defaultView || globalScope;
      win.dispatchEvent(new CustomEvent('igpip:set-input', { detail: { token, text } }));
    } catch {
      // Fallback below
    }

    if (inputEl.getAttribute('data-igpip-input-result') === 'ok') {
      inputEl.removeAttribute('data-igpip-input-result');
      return true;
    }

    // Direct fallback (for unit tests without MAIN bridge)
    inputEl.removeAttribute('data-igpip-input-target');
    const tag = (inputEl.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA') {
      const win = doc.defaultView || globalScope;
      const proto =
        tag === 'TEXTAREA'
          ? win.HTMLTextAreaElement?.prototype
          : win.HTMLInputElement?.prototype;
      const setter = proto && Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(inputEl, text);
      else inputEl.value = text;
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    if (inputEl.isContentEditable || inputEl.getAttribute('contenteditable') === 'true') {
      inputEl.textContent = text;
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
    return false;
  }

  function safeClick(el) {
    if (!el) return false;
    try {
      el.click();
      return true;
    } catch {
      try {
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        return true;
      } catch {
        return false;
      }
    }
  }

  function findAllVideos(doc = document) {
    const videos = Array.from(doc.querySelectorAll('video'));
    return videos.filter((v) => {
      if (!v.isConnected) return false;
      const rect = v.getBoundingClientRect ? v.getBoundingClientRect() : { width: 300, height: 300 };
      if (rect.width > 0 && rect.height > 0 && (rect.width < 100 || rect.height < 100)) {
        return false;
      }
      return true;
    });
  }

  function scoreVideo(video, win = globalScope) {
    if (!video) return -Infinity;
    let score = 0;
    if (!video.paused && !video.ended && video.readyState >= 2) {
      score += 1200;
    } else if (!video.paused) {
      score += 600;
    }
    if (!video.muted && video.volume > 0) {
      score += 120;
    }
    if (video.currentSrc || video.src || video.querySelector('source')) {
      score += 80;
    }
    const rect = video.getBoundingClientRect ? video.getBoundingClientRect() : null;
    if (rect && rect.width > 0 && rect.height > 0) {
      const vh = win.innerHeight || 800;
      const vw = win.innerWidth || 1200;
      const visTop = Math.max(0, rect.top);
      const visBottom = Math.min(vh, rect.bottom);
      const visLeft = Math.max(0, rect.left);
      const visRight = Math.min(vw, rect.right);
      const visArea = Math.max(0, visBottom - visTop) * Math.max(0, visRight - visLeft);
      const totalArea = rect.width * rect.height;
      const visibleRatio = totalArea > 0 ? visArea / totalArea : 0;
      score += visibleRatio * 550;

      const centerY = (rect.top + rect.bottom) / 2;
      const distFromCenter = Math.abs(centerY - vh / 2) / vh;
      score += Math.max(0, 1 - distFromCenter) * 250;
    }
    return score;
  }

  function findActiveVideo(doc = document, excludeVideo = null, win = globalScope) {
    const videos = findAllVideos(doc).filter((v) => v !== excludeVideo);
    if (videos.length === 0) return null;
    let best = null;
    let bestScore = -Infinity;
    for (const v of videos) {
      const s = scoreVideo(v, win);
      if (s > bestScore) {
        bestScore = s;
        best = v;
      }
    }
    return best;
  }

  function hasActionControls(el) {
    if (!el || !el.querySelectorAll) return false;
    const svgs = el.querySelectorAll('svg');
    let hasLike = false;
    let hasCommentOrShare = false;
    for (const svg of svgs) {
      const label = getSvgLabel(svg).toLowerCase();
      if ((label === 'like' || label === 'unlike') && getSvgDimension(svg) >= 18) {
        hasLike = true;
      } else if (
        label === 'comment' ||
        label === 'comments' ||
        label === 'share' ||
        label === 'share post' ||
        label === 'share reel' ||
        label === 'send' ||
        label === 'direct'
      ) {
        hasCommentOrShare = true;
      }
      if (hasLike && hasCommentOrShare) return true;
    }
    if (!hasLike) {
      hasLike = Boolean(
        el.querySelector(
          'button[aria-label="Like" i], button[aria-label="Unlike" i], [role="button"][aria-label="Like" i], [role="button"][aria-label="Unlike" i]'
        )
      );
    }
    if (!hasCommentOrShare) {
      hasCommentOrShare = Boolean(
        el.querySelector(
          'button[aria-label="Comment" i], [role="button"][aria-label="Comment" i], button[aria-label*="Share" i], [role="button"][aria-label*="Share" i]'
        )
      );
    }
    return hasLike && hasCommentOrShare;
  }


  function findPostContainer(anchorEl) {
    if (!anchorEl || !anchorEl.isConnected) return null;

    const article = anchorEl.closest('article');
    if (article && hasActionControls(article)) {
      return article;
    }

    let cur = anchorEl.parentElement;
    let bestFallback = article || null;
    while (cur && cur !== anchorEl.ownerDocument.body && cur !== anchorEl.ownerDocument.documentElement) {
      const slotCount = cur.querySelectorAll('video').length;
      if (slotCount > 1 && !cur.matches('article, [role="dialog"]')) {
        break;
      }
      if (hasActionControls(cur)) {
        return cur;
      }
      if (!bestFallback && cur.getAttribute('role') === 'presentation') {
        bestFallback = cur;
      }
      cur = cur.parentElement;
    }

    return bestFallback || anchorEl.parentElement;
  }

  function isHeartRed(svg) {
    if (!svg) return false;
    const fill = (svg.getAttribute('fill') || '').toLowerCase();
    const color = (svg.getAttribute('color') || '').toLowerCase();
    if (fill === '#ff3040' || fill === '#ed4956' || color === '#ff3040' || color === '#ed4956') {
      return true;
    }
    try {
      const computed = globalScope.getComputedStyle?.(svg);
      const c = (computed?.color || computed?.fill || '').toLowerCase();
      if (c.includes('255, 48, 64') || c.includes('237, 73, 86')) return true;
    } catch {
      // Ignore
    }
    return false;
  }

  function findActionButtons(container) {
    const result = {
      likeBtn: null,
      likeSvg: null,
      isLiked: false,
      commentBtn: null,
      shareBtn: null,
      saveBtn: null,
      isSaved: false,
      carouselNextBtn: null,
      carouselPrevBtn: null,
    };
    if (!container) return result;

    const svgs = Array.from(container.querySelectorAll('svg'));
    for (const svg of svgs) {
      const label = getSvgLabel(svg).toLowerCase();
      const dim = getSvgDimension(svg);

      if (!result.likeBtn && (label === 'like' || label === 'unlike') && (dim === 0 || dim >= 18)) {
        result.likeSvg = svg;
        result.likeBtn = findClickableParent(svg, container);
        result.isLiked = label === 'unlike' || isHeartRed(svg);
      } else if (!result.commentBtn && (label === 'comment' || label === 'comments') && (dim === 0 || dim >= 18)) {
        result.commentBtn = findClickableParent(svg, container);
      } else if (
        !result.shareBtn &&
        (label === 'share' || label === 'share post' || label === 'share reel' || label === 'send' || label === 'direct') &&
        (dim === 0 || dim >= 18)
      ) {
        result.shareBtn = findClickableParent(svg, container);
      } else if (!result.saveBtn && (label === 'save' || label === 'remove') && (dim === 0 || dim >= 18)) {
        result.saveBtn = findClickableParent(svg, container);
        result.isSaved = label === 'remove';
      }
    }

    if (!result.likeBtn) {
      const btn = container.querySelector(
        'button[aria-label="Like" i], button[aria-label="Unlike" i], [role="button"][aria-label="Like" i], [role="button"][aria-label="Unlike" i]'
      );
      if (btn) {
        result.likeBtn = btn;
        const lbl = (btn.getAttribute('aria-label') || '').toLowerCase();
        result.isLiked = lbl === 'unlike' || isHeartRed(btn.querySelector('svg'));
      }
    }
    if (!result.commentBtn) {
      result.commentBtn = container.querySelector(
        'button[aria-label="Comment" i], [role="button"][aria-label="Comment" i]'
      );
    }
    if (!result.shareBtn) {
      result.shareBtn = container.querySelector(
        'button[aria-label="Share" i], button[aria-label="Share Post" i], button[aria-label="Send" i], [role="button"][aria-label="Share" i]'
      );
    }
    if (!result.saveBtn) {
      const btn = container.querySelector(
        'button[aria-label="Save" i], button[aria-label="Remove" i], [role="button"][aria-label="Save" i], [role="button"][aria-label="Remove" i]'
      );
      if (btn) {
        result.saveBtn = btn;
        result.isSaved = (btn.getAttribute('aria-label') || '').toLowerCase() === 'remove';
      }
    }

    result.carouselNextBtn = container.querySelector('button[aria-label="Next" i]');
    result.carouselPrevBtn = container.querySelector('button[aria-label="Go back" i], button[aria-label="Previous" i]');

    return result;
  }

  /**
   * Matches both "/<username>/" and "/<username>/reels/" (used on Instagram Reels author links!).
   */
  function isProfileHref(href) {
    if (!href) return false;
    try {
      const url = new URL(href, 'https://www.instagram.com');
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length === 0 || parts.length > 2) return false;
      if (parts.length === 2 && parts[1].toLowerCase() !== 'reels') return false;
      const seg = parts[0].toLowerCase();
      if (RESERVED_PATH_SEGMENTS.has(seg)) return false;
      return /^[a-z0-9._]{1,40}$/i.test(seg);
    } catch {
      return false;
    }
  }

  function extractProfileUsername(href) {
    try {
      const url = new URL(href, 'https://www.instagram.com');
      const uname = url.pathname.split('/').filter(Boolean)[0] || '';
      return uname.replace(/^@+/, '');
    } catch {
      return '';
    }
  }

  function sanitizeHandle(raw) {
    return (raw || '').trim().replace(/^@+/, '');
  }

  /**
   * Shortcode of a post/reel permalink ("/reel/<code>/", "/reels/<code>/", "/p/<code>/",
   * "/<user>/reel/<code>/"). Returns '' for non-post links such as "/reels/audio/<id>/".
   */
  function extractShortcode(href) {
    if (!href) return '';
    try {
      const url = new URL(href, 'https://www.instagram.com');
      const m = url.pathname.match(/^\/(?:[A-Za-z0-9._]+\/)?(?:reel|reels|p|tv)\/([A-Za-z0-9_-]{5,})(?:\/|$)/);
      if (!m) return '';
      if (m[1] === 'audio' || m[1] === 'videos') return '';
      return m[1];
    } catch {
      return '';
    }
  }

  /** Clean permalink for a post link, dropping extras such as "/c/<comment id>/" or query strings. */
  function canonicalPostUrl(href) {
    const code = extractShortcode(href);
    if (!code) return '';
    const kind = /\/p\//.test(href) ? 'p' : 'reel';
    return `https://www.instagram.com/${kind}/${code}/`;
  }

  const SHORTCODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

  /** Instagram media pk (decimal string) for a shortcode; '' if it cannot be decoded. */
  function shortcodeToMediaId(shortcode) {
    if (!shortcode || typeof BigInt !== 'function') return '';
    // Private-account shortcodes carry a 28-char suffix after the 11-char public part.
    const code = shortcode.length > 28 ? shortcode.slice(0, shortcode.length - 28) : shortcode;
    let id = 0n;
    for (const ch of code) {
      const idx = SHORTCODE_ALPHABET.indexOf(ch);
      if (idx < 0) return '';
      id = id * 64n + BigInt(idx);
    }
    return id > 0n ? id.toString() : '';
  }

  /** Shortcode of the post shown in `container` (falls back to the page URL on Reels / post pages). */
  function resolvePostShortcode(container, doc = document) {
    if (container) {
      for (const a of container.querySelectorAll('a[href]')) {
        const code = extractShortcode(a.getAttribute('href') || '');
        if (code) return code;
      }
    }
    const loc = doc.location || globalScope.location;
    return loc ? extractShortcode(loc.pathname) : '';
  }

  function extractPostState(container, video = null, doc = document) {
    const actions = findActionButtons(container);
    let authorName = '';
    let authorAvatar = '';
    let authorAvatarCrossOrigin = '';
    let authorUrl = '';
    let caption = '';
    let audioLabel = '';
    let postUrl = '';

    if (container) {
      const links = Array.from(container.querySelectorAll('a[href]'));
      // Prefer "/<username>/reels/" (Reels header link) over caption @mentions!
      const orderedLinks = [...links].sort((a, b) => {
        const aReels = /\/reels\/?$/.test(a.getAttribute('href') || '') ? 0 : 1;
        const bReels = /\/reels\/?$/.test(b.getAttribute('href') || '') ? 0 : 1;
        return aReels - bReels;
      });

      for (const a of orderedLinks) {
        const href = a.getAttribute('href') || '';
        if (!postUrl) postUrl = canonicalPostUrl(href);
        if (!authorName && isProfileHref(href)) {
          const uname = extractProfileUsername(href);
          if (uname) {
            authorName = sanitizeHandle(uname);
            authorUrl = new URL(`/${authorName}/`, 'https://www.instagram.com').href;
          }
        }
        if (!audioLabel && /\/audio\//.test(href)) {
          audioLabel = (a.textContent || '').trim();
        }
      }

      // Author avatar
      const imgs = Array.from(container.querySelectorAll('img[src]'));
      for (const img of imgs) {
        const alt = (img.getAttribute('alt') || '').toLowerCase();
        if (
          alt.includes('profile picture') ||
          alt.includes('avatar') ||
          (authorName && alt.includes(authorName.toLowerCase()))
        ) {
          authorAvatar = img.src;
          authorAvatarCrossOrigin = img.getAttribute('crossorigin') || '';
          break;
        }
      }
      if (!authorAvatar) {
        const smallImg = imgs.find((i) => {
          const r = i.getBoundingClientRect?.();
          return r && r.width >= 20 && r.width <= 64 && Math.abs(r.width - r.height) < 8;
        });
        if (smallImg) {
          authorAvatar = smallImg.src;
          authorAvatarCrossOrigin = smallImg.getAttribute('crossorigin') || '';
        }
      }

      // Caption extraction:
      // Note: Instagram Reels wraps the caption inside a clickable <div role="button"> ("... more"),
      // so we exclude our placeholder + action buttons (like/comment/share/save), NOT caption containers!
      const actionBtnEls = [actions.likeBtn, actions.commentBtn, actions.shareBtn, actions.saveBtn].filter(Boolean);
      const isActionUi = (el) => actionBtnEls.some((b) => b === el || b.contains(el) || el.contains(b));

      const h1 = container.querySelector('h1');
      if (h1 && h1.textContent?.trim()) {
        caption = h1.textContent.trim();
      } else {
        // Post pages and modals list comments in the same container; there the caption is the
        // first text block, while on Reels (no comment list) it is the longest one.
        const hasCommentList = container.querySelectorAll('time').length >= 2;
        const ownTextLength = (el) => {
          let n = 0;
          for (const child of el.childNodes) {
            if (child.nodeType === 3) n += child.nodeValue.trim().length;
          }
          return n;
        };
        const candidates = Array.from(container.querySelectorAll('span[dir="auto"], div[dir="auto"], span, div'));
        let bestCaption = '';
        for (const el of candidates) {
          if (el.closest('nav, header, time, a[href*="/audio/"]')) continue;
          // Reels wrap the caption in a plain role="button" ("… more"). Real controls are short
          // or carry an icon (the audio row has artwork), so those are skipped.
          const ctl = el.closest('button, [role="button"]');
          if (ctl && (isActionUi(ctl) || ctl.querySelector('svg, img') || (ctl.textContent || '').trim().length < 12)) {
            continue;
          }
          if (isActionUi(el)) continue;
          if (el.querySelector('video, svg, img')) continue;
          // Only elements that carry text themselves (skips layout wrappers and duplicated copies).
          if (ownTextLength(el) < 3) continue;
          if (el.closest('a[href]') && isProfileHref(el.closest('a[href]').getAttribute('href'))) continue;
          const txt = (el.textContent || '').trim();
          if (txt.length < 3 || txt.length > 2200) continue;
          const cleanLower = txt.toLowerCase();
          if (
            sanitizeHandle(txt).toLowerCase() === authorName.toLowerCase() ||
            ['follow', 'following', 'original audio', 'more', '… more', 'permalink', 'verified', 'like', 'reply', 'see translation', 'log in'].includes(cleanLower)
          ) {
            continue;
          }
          if (isCompactCount(txt) || /^\d[\d.,]*[KMBkmb]?\s*(likes?|comments?|views?|plays?)$/i.test(txt)) continue;
          if (/^\d+\s*(s|m|h|d|w|y|days?|hours?|minutes?|weeks?)(\s+ago)?$/i.test(txt)) continue;
          if (audioLabel && txt === audioLabel) continue;
          const cleaned = txt.replace(/[…\.]{1,3}\s*more$/i, '').trim();
          if (hasCommentList) {
            bestCaption = cleaned;
            break;
          }
          if (cleaned.length > bestCaption.length) bestCaption = cleaned;
        }
        caption = bestCaption;
      }
    }

    const shortcode = resolvePostShortcode(container, doc);
    if (!postUrl) {
      const loc = doc.location || globalScope.location;
      postUrl = shortcode
        ? `https://www.instagram.com/reel/${shortcode}/`
        : loc
          ? loc.href
          : 'https://www.instagram.com/';
    }

    const likeCount = extractNearbyCount(actions.likeBtn, container, 'like');
    let commentCount = extractNearbyCount(actions.commentBtn, container, 'comment');
    if (!commentCount && container) {
      const viewAll = Array.from(container.querySelectorAll('a, span, button')).find((el) =>
        /view all\s+[\d.,]+[KMBkmb]?\s+comments?/i.test(el.textContent || '')
      );
      if (viewAll) {
        const m = (viewAll.textContent || '').match(/([\d.,]+[KMBkmb]?)/);
        if (m) commentCount = m[1];
      }
    }

    return {
      isLiked: actions.isLiked,
      likeCount,
      likeBtn: actions.likeBtn,
      commentCount,
      commentBtn: actions.commentBtn,
      shareBtn: actions.shareBtn,
      isSaved: actions.isSaved,
      saveBtn: actions.saveBtn,
      authorName: sanitizeHandle(authorName) || 'instagram',
      authorAvatar,
      authorAvatarCrossOrigin,
      shortcode,
      authorUrl,
      caption,
      audioLabel,
      postUrl,
      hasCarouselNext: Boolean(actions.carouselNextBtn),
      hasCarouselPrev: Boolean(actions.carouselPrevBtn),
      carouselNextBtn: actions.carouselNextBtn,
      carouselPrevBtn: actions.carouselPrevBtn,
      isPlaying: video ? !video.paused && !video.ended : false,
      isMuted: video ? video.muted || video.volume === 0 : false,
      volume: video ? video.volume : 1,
      currentTime: video ? video.currentTime || 0 : 0,
      duration: video && Number.isFinite(video.duration) ? video.duration : 0,
    };
  }

  function toggleLike(container) {
    const actions = findActionButtons(container);
    if (!actions.likeBtn) return { ok: false, isLiked: false };
    safeClick(actions.likeBtn);
    return { ok: true, isLiked: !actions.isLiked };
  }

  function ensureLiked(container) {
    const actions = findActionButtons(container);
    if (!actions.likeBtn) return { ok: false, isLiked: false };
    if (!actions.isLiked) {
      safeClick(actions.likeBtn);
      return { ok: true, isLiked: true, changed: true };
    }
    return { ok: true, isLiked: true, changed: false };
  }

  function toggleSave(container) {
    const actions = findActionButtons(container);
    if (!actions.saveBtn) return { ok: false, isSaved: false };
    safeClick(actions.saveBtn);
    return { ok: true, isSaved: !actions.isSaved };
  }

  function stepCarousel(container, direction) {
    const actions = findActionButtons(container);
    const btn = direction > 0 ? actions.carouselNextBtn : actions.carouselPrevBtn;
    if (!btn) return false;
    return safeClick(btn);
  }

  function findScrollContainer(el, doc = document, win = globalScope) {
    let cur = el?.parentElement;
    while (cur && cur !== doc.body && cur !== doc.documentElement) {
      const style = win.getComputedStyle ? win.getComputedStyle(cur) : null;
      const overflowY = style ? style.overflowY : '';
      if (
        (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') &&
        cur.scrollHeight > cur.clientHeight + 40
      ) {
        return cur;
      }
      cur = cur.parentElement;
    }
    return doc.scrollingElement || doc.documentElement || doc.body;
  }

  function getFeedContainers(doc = document) {
    const anchors = findAllVideos(doc);
    const seen = new Set();
    const containers = [];
    for (const anchor of anchors) {
      const c = findPostContainer(anchor);
      if (c && !seen.has(c)) {
        seen.add(c);
        containers.push(c);
      }
    }
    containers.sort((a, b) => {
      const ra = a.getBoundingClientRect ? a.getBoundingClientRect().top : 0;
      const rb = b.getBoundingClientRect ? b.getBoundingClientRect().top : 0;
      if (Math.abs(ra - rb) > 4) return ra - rb;
      const pos = a.compareDocumentPosition(b);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
    return containers;
  }

  function findDialogCloseButton(dialog) {
    if (!dialog) return null;
    const svgs = dialog.querySelectorAll('svg');
    for (const svg of svgs) {
      const lbl = getSvgLabel(svg).toLowerCase();
      if (lbl === 'close') {
        return findClickableParent(svg, dialog);
      }
    }
    return dialog.querySelector('button[aria-label="Close" i], [role="button"][aria-label="Close" i]');
  }

  function closeOpenDialogs(doc = document) {
    let closedAny = false;
    const dialogs = Array.from(doc.querySelectorAll('[role="dialog"]'));
    for (const dialog of dialogs) {
      if (dialog.querySelector('video')) continue;
      const closeBtn = findDialogCloseButton(dialog);
      if (closeBtn) {
        safeClick(closeBtn);
        closedAny = true;
      }
    }
    return closedAny;
  }

  function scrollToAdjacentVideo(currentContainer, currentVideo, direction, doc = document, win = globalScope) {
    const dir = direction >= 0 ? 1 : -1;

    const outerDialog = currentContainer?.closest('[role="dialog"]');
    if (outerDialog) {
      const label = dir > 0 ? 'Next' : 'Go back';
      const navSvgs = Array.from(doc.querySelectorAll('svg'));
      for (const svg of navSvgs) {
        if (getSvgLabel(svg).toLowerCase() === label.toLowerCase() && !currentContainer.contains(svg)) {
          const btn = findClickableParent(svg, doc.body);
          if (btn) {
            safeClick(btn);
            return { scrolled: true, method: 'modal-nav' };
          }
        }
      }
    }

    const containers = getFeedContainers(doc);
    const currentIdx = containers.indexOf(currentContainer);
    const scrollContainer = findScrollContainer(currentContainer || currentVideo, doc, win);

    if (currentIdx !== -1) {
      const targetIdx = currentIdx + dir;
      if (targetIdx >= 0 && targetIdx < containers.length) {
        const target = containers[targetIdx];
        const targetVideo = target.querySelector('video') || target;
        if (typeof targetVideo.scrollIntoView === 'function') {
          try {
            targetVideo.scrollIntoView({ behavior: 'instant', block: 'center' });
          } catch {
            targetVideo.scrollIntoView(true);
          }
        }
        if (scrollContainer && target.getBoundingClientRect && scrollContainer.getBoundingClientRect) {
          const isRoot =
            scrollContainer === doc.scrollingElement ||
            scrollContainer === doc.documentElement ||
            scrollContainer === doc.body;
          const targetRect = target.getBoundingClientRect();
          if (isRoot) {
            const delta = targetRect.top - (win.innerHeight - targetRect.height) / 2;
            if (Math.abs(delta) > 20) {
              win.scrollBy({ top: delta, behavior: 'instant' });
            }
          } else {
            const scRect = scrollContainer.getBoundingClientRect();
            const delta = targetRect.top - scRect.top - (scRect.height - targetRect.height) / 2;
            if (Math.abs(delta) > 20) {
              scrollContainer.scrollTop += delta;
            }
          }
        }
        return { scrolled: true, method: 'container-jump', targetContainer: target };
      }
    }

    const chevronLabels = dir > 0 ? ['down chevron', 'next reel', 'next'] : ['up chevron', 'previous reel', 'previous'];
    const allSvgs = Array.from(doc.querySelectorAll('svg'));
    for (const svg of allSvgs) {
      const lbl = getSvgLabel(svg).toLowerCase();
      if (chevronLabels.includes(lbl) && (!currentContainer || !currentContainer.contains(svg))) {
        const btn = findClickableParent(svg, doc.body);
        if (btn) {
          safeClick(btn);
          return { scrolled: true, method: 'chevron-button' };
        }
      }
    }

    if (scrollContainer) {
      const isRoot =
        scrollContainer === doc.scrollingElement ||
        scrollContainer === doc.documentElement ||
        scrollContainer === doc.body;
      const step = Math.max(
        currentContainer?.getBoundingClientRect?.().height || 0,
        isRoot ? (win.innerHeight || 800) * 0.92 : scrollContainer.clientHeight * 0.92,
        520
      );
      const prevTop = isRoot ? (win.scrollY || scrollContainer.scrollTop) : scrollContainer.scrollTop;
      if (dir < 0 && prevTop <= 4) {
        return { scrolled: false, method: 'at-top' };
      }
      if (isRoot) {
        win.scrollBy({ top: dir * step, behavior: 'instant' });
      } else {
        scrollContainer.scrollTop += dir * step;
      }
      return { scrolled: true, method: 'scroll-step' };
    }

    return { scrolled: false, method: 'none' };
  }

  // =========================================================================
  // Native Reels navigation, mute toggle & login wall
  // =========================================================================
  function findByAriaLabel(doc, labels) {
    for (const label of labels) {
      const el = doc.querySelector(`[aria-label="${label}" i]`);
      if (el) return el.closest('button, [role="button"]') || el;
    }
    return null;
  }

  /** Instagram's own "next / previous Reel" buttons (present on /reels/). */
  function findNativeReelNav(doc = document) {
    return {
      next: findByAriaLabel(doc, ['Navigate to next Reel', 'Next Reel', 'Next reel']),
      prev: findByAriaLabel(doc, ['Navigate to previous Reel', 'Previous Reel', 'Previous reel']),
    };
  }

  /**
   * Ask Instagram itself to move to the adjacent Reel. Its own handler scrolls, plays the next
   * video, pauses the old one, updates the URL and loads more Reels — none of which we can do
   * reliably from outside.
   */
  function clickNativeReelNav(direction, doc = document) {
    const nav = findNativeReelNav(doc);
    const btn = direction >= 0 ? nav.next : nav.prev;
    if (!btn || btn.getAttribute('aria-disabled') === 'true' || btn.disabled) return false;
    return safeClick(btn);
  }

  /** The video nearest the middle of the viewport (the Reel the user is "on"). */
  function findCenteredVideo(doc = document, win = globalScope) {
    const vh = win.innerHeight || 800;
    let best = null;
    let bestDist = Infinity;
    for (const v of findAllVideos(doc)) {
      const r = v.getBoundingClientRect();
      if (r.height <= 0) continue;
      const dist = Math.abs((r.top + r.bottom) / 2 - vh / 2);
      if (dist < bestDist) {
        bestDist = dist;
        best = v;
      }
    }
    return best && bestDist < vh * 0.3 ? best : null;
  }

  /** Instagram's own sound toggle for a post, so its "muted" preference stays in sync with ours. */
  function findMuteToggle(container) {
    if (!container) return null;
    const svg = container.querySelector(
      'svg[aria-label="Audio is muted" i], svg[aria-label="Audio is playing" i], svg[aria-label="Toggle audio" i]'
    );
    if (svg) return findClickableParent(svg, container);
    return container.querySelector('button[aria-label="Toggle audio" i], [role="button"][aria-label="Toggle audio" i]');
  }

  function clickMuteToggle(container) {
    const btn = findMuteToggle(container);
    return btn ? safeClick(btn) : false;
  }

  /** Logged-out "Sign up / Log in" interstitial Instagram shows instead of performing an action. */
  function findLoginWall(doc = document) {
    for (const d of doc.querySelectorAll('[role="dialog"]')) {
      if (d.querySelector('video')) continue;
      const txt = (d.textContent || '').toLowerCase();
      const hasLogin = txt.includes('log in') || Boolean(d.querySelector('a[href*="/accounts/login"]'));
      const hasSignup = txt.includes('sign up') || Boolean(d.querySelector('a[href*="/accounts/emailsignup"]'));
      if (hasLogin && hasSignup && txt.length < 600) return d;
    }
    return null;
  }

  function dismissLoginWall(doc = document) {
    const wall = findLoginWall(doc);
    if (!wall) return false;
    const closeBtn = findDialogCloseButton(wall);
    if (closeBtn) safeClick(closeBtn);
    else {
      // Some variants have no close button and only go away with Escape.
      for (const type of ['keydown', 'keyup']) {
        doc.dispatchEvent(new KeyboardEvent(type, { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
      }
    }
    return true;
  }

  // =========================================================================
  // Instagram web API client (comments). Same-origin requests with the user's own session,
  // exactly what instagram.com sends itself — no DOM scraping, works while the tab is hidden.
  // =========================================================================
  const IG_WEB_APP_ID = '936619743392459';

  function readCookie(doc, name) {
    const m = (doc.cookie || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
    return m ? decodeURIComponent(m[1]) : '';
  }

  function createInstagramApi(doc = document, win = globalScope) {
    function isLoggedIn() {
      return Boolean(readCookie(doc, 'ds_user_id'));
    }

    async function request(path, { method = 'GET', form = null } = {}) {
      const headers = {
        'X-IG-App-ID': IG_WEB_APP_ID,
        'X-Requested-With': 'XMLHttpRequest',
      };
      const csrf = readCookie(doc, 'csrftoken');
      if (csrf) headers['X-CSRFToken'] = csrf;
      try {
        headers['X-IG-WWW-Claim'] = win.sessionStorage?.getItem('www-claim-v2') || '0';
      } catch {
        headers['X-IG-WWW-Claim'] = '0';
      }
      let body;
      if (form) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        body = new URLSearchParams(form).toString();
      }
      const res = await win.fetch(path, { method, headers, body, credentials: 'include' });
      const type = res.headers.get('content-type') || '';
      if (!type.includes('json')) {
        const err = new Error(res.status === 200 ? 'Not logged in to Instagram.' : `Instagram returned ${res.status}.`);
        err.loginRequired = true;
        throw err;
      }
      const data = await res.json();
      if (!res.ok || (data && data.status && data.status !== 'ok')) {
        const err = new Error((data && data.message) || `Instagram returned ${res.status}.`);
        err.loginRequired = Boolean(data && data.require_login) || res.status === 401 || res.status === 403;
        throw err;
      }
      return data;
    }

    return {
      isLoggedIn,
      fetchComments(mediaId, cursor) {
        let path = `/api/v1/media/${mediaId}/comments/?can_support_threading=true&permalink_enabled=false`;
        if (cursor && cursor.key && cursor.value) {
          path += `&${cursor.key}=${encodeURIComponent(cursor.value)}`;
        }
        return request(path);
      },
      fetchReplies(mediaId, commentId, cursor) {
        let path = `/api/v1/media/${mediaId}/comments/${commentId}/child_comments/`;
        if (cursor) path += `?max_id=${encodeURIComponent(cursor)}`;
        return request(path);
      },
      setCommentLiked(commentId, liked) {
        return request(`/api/v1/web/comments/${liked ? 'like' : 'unlike'}/${commentId}/`, { method: 'POST', form: {} });
      },
      addComment(mediaId, text, replyToCommentId) {
        const form = { comment_text: text };
        if (replyToCommentId) form.replied_to_comment_id = replyToCommentId;
        return request(`/api/v1/web/comments/${mediaId}/add/`, { method: 'POST', form });
      },
    };
  }

  function formatCompact(n) {
    const num = Number(n) || 0;
    if (num < 1000) return String(num);
    if (num < 10000) return `${(num / 1000).toFixed(1).replace(/\.0$/, '')}K`;
    if (num < 1000000) return `${Math.round(num / 1000)}K`;
    return `${(num / 1000000).toFixed(1).replace(/\.0$/, '')}M`;
  }

  function formatAge(unixSeconds, nowMs = Date.now()) {
    const ts = Number(unixSeconds);
    if (!ts) return '';
    const secs = Math.max(0, Math.floor(nowMs / 1000 - ts));
    if (secs < 60) return 'now';
    if (secs < 3600) return `${Math.floor(secs / 60)}m`;
    if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
    if (secs < 604800) return `${Math.floor(secs / 86400)}d`;
    return `${Math.floor(secs / 604800)}w`;
  }

  const MEDIA_ONLY_COMMENT = 'GIF or sticker';

  function normalizeApiComment(raw) {
    const user = raw.user || raw.from || {};
    return {
      id: String(raw.pk ?? raw.id ?? ''),
      author: user.username || 'user',
      avatar: user.profile_pic_url || user.profile_picture || '',
      createdAt: Number(raw.created_at ?? raw.created_at_utc ?? raw.created_time) || 0,
      // Comments can be a GIF or sticker with no text at all.
      text: raw.text || MEDIA_ONLY_COMMENT,
      likeCount: Number(raw.comment_like_count) || 0,
      isLiked: Boolean(raw.has_liked_comment),
      childCount: Number(raw.child_comment_count) || 0,
      replies: [],
      repliesShown: false,
      repliesCursor: null,
      repliesExhausted: false,
      repliesLoading: false,
    };
  }

  /**
   * Comments for one post, loaded through Instagram's API.
   * Same surface as the DOM bridge: load / getView / loadMore / toggleLike / toggleReplies /
   * setReplyTarget / post / close.
   */
  function createApiCommentsSource(api, mediaId, onChange = () => {}) {
    let items = [];
    const byId = new Map();
    let cursor = null;
    let hasMore = false;
    let total = 0;
    let loading = false;
    let loaded = false;
    let commentsDisabled = false;
    let replyTarget = null;
    let closed = false;

    const emit = () => {
      if (!closed) onChange();
    };

    function index(item, parent = null) {
      item.parentId = parent ? parent.id : null;
      byId.set(item.id, item);
      return item;
    }

    function applyPage(data) {
      const list = Array.isArray(data.comments) ? data.comments : [];
      for (const raw of list) {
        const item = normalizeApiComment(raw);
        if (!item.id || byId.has(item.id)) continue;
        index(item);
        const preview = Array.isArray(raw.preview_child_comments) ? raw.preview_child_comments : [];
        for (const child of preview) {
          const c = normalizeApiComment(child);
          if (c.id && !byId.has(c.id)) item.replies.push(index(c, item));
        }
        items.push(item);
      }
      if (typeof data.comment_count === 'number') total = data.comment_count;
      commentsDisabled = Boolean(data.comments_disabled);
      if (data.next_min_id) cursor = { key: 'min_id', value: data.next_min_id };
      else if (data.next_max_id) cursor = { key: 'max_id', value: data.next_max_id };
      else cursor = null;
      hasMore = Boolean(cursor) && (data.has_more_headload_comments || data.has_more_comments || list.length > 0);
      if (list.length === 0) hasMore = false;
    }

    async function load() {
      loading = true;
      try {
        applyPage(await api.fetchComments(mediaId, null));
        loaded = true;
        return { ok: true };
      } catch (err) {
        return { ok: false, error: String(err?.message || err), loginRequired: Boolean(err?.loginRequired) };
      } finally {
        loading = false;
        emit();
      }
    }

    async function loadMore() {
      if (loading || !hasMore || closed) return false;
      loading = true;
      emit();
      try {
        applyPage(await api.fetchComments(mediaId, cursor));
      } catch {
        hasMore = false;
      } finally {
        loading = false;
        emit();
      }
      return true;
    }

    async function toggleReplies(id) {
      const item = byId.get(id);
      if (!item || item.repliesLoading) return;
      const needsFetch = !item.repliesExhausted && item.replies.length < item.childCount;
      if (item.repliesShown && !needsFetch) {
        item.repliesShown = false;
        emit();
        return;
      }
      item.repliesShown = true;
      if (!needsFetch) {
        emit();
        return;
      }
      item.repliesLoading = true;
      emit();
      try {
        const data = await api.fetchReplies(mediaId, item.id, item.repliesCursor);
        const list = Array.isArray(data.child_comments) ? data.child_comments : [];
        const fresh = [];
        for (const raw of list) {
          const c = normalizeApiComment(raw);
          if (c.id && !byId.has(c.id)) fresh.push(index(c, item));
        }
        // Replies come oldest-first; previews are the newest ones, so new pages go in front.
        item.replies = [...fresh, ...item.replies].sort((a, b) => a.createdAt - b.createdAt);
        item.repliesCursor = data.next_max_child_cursor || null;
        item.repliesExhausted = !item.repliesCursor || !data.has_more_tail_child_comments || fresh.length === 0;
      } catch {
        item.repliesExhausted = true;
      } finally {
        item.repliesLoading = false;
        emit();
      }
    }

    async function toggleLike(id) {
      const item = byId.get(id);
      if (!item) return { ok: false };
      const want = !item.isLiked;
      item.isLiked = want;
      item.likeCount = Math.max(0, item.likeCount + (want ? 1 : -1));
      emit();
      try {
        await api.setCommentLiked(item.id, want);
        return { ok: true };
      } catch (err) {
        item.isLiked = !want;
        item.likeCount = Math.max(0, item.likeCount + (want ? -1 : 1));
        emit();
        return { ok: false, error: String(err?.message || err) };
      }
    }

    function setReplyTarget(id) {
      const item = id ? byId.get(id) : null;
      replyTarget = item || null;
      return item ? item.author : null;
    }

    async function post(text) {
      const trimmed = (text || '').trim();
      if (!trimmed) return { ok: false, error: 'Empty comment.' };
      const target = replyTarget;
      try {
        const data = await api.addComment(mediaId, trimmed, target ? target.id : null);
        const item = normalizeApiComment({ ...data, text: data.text || trimmed });
        if (!item.createdAt) item.createdAt = Math.floor(Date.now() / 1000);
        if (!item.id) item.id = `local-${Date.now()}`;
        const parent = target ? byId.get(target.parentId || target.id) : null;
        if (parent) {
          parent.replies.push(index(item, parent));
          parent.childCount += 1;
          parent.repliesShown = true;
        } else {
          index(item);
          items.unshift(item);
        }
        total += 1;
        replyTarget = null;
        emit();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: String(err?.message || err) };
      }
    }

    function toView(item, depth) {
      let repliesLabel = '';
      if (depth === 0 && item.childCount > 0) {
        const more = !item.repliesExhausted && item.replies.length < item.childCount;
        if (item.repliesLoading) repliesLabel = 'Loading replies…';
        else if (!item.repliesShown) repliesLabel = `View replies (${item.childCount})`;
        else if (more) repliesLabel = `View more replies (${item.childCount - item.replies.length})`;
        else repliesLabel = 'Hide replies';
      }
      return {
        id: item.id,
        author: item.author,
        avatar: item.avatar,
        time: formatAge(item.createdAt),
        text: item.text,
        likesText: item.likeCount > 0 ? formatCompact(item.likeCount) : '',
        isLiked: item.isLiked,
        canLike: !item.id.startsWith('local-'),
        canReply: true,
        repliesLabel,
        depth,
      };
    }

    function getView() {
      const comments = [];
      for (const item of items) {
        comments.push(toView(item, 0));
        if (item.repliesShown) {
          for (const child of item.replies) comments.push(toView(child, 1));
        }
      }
      return {
        open: true,
        source: 'api',
        comments,
        total: Math.max(total, comments.length),
        hasComposer: !commentsDisabled,
        isLoading: !loaded && loading,
        isLoadingMore: loaded && loading,
        hasMore,
        emptyMessage: commentsDisabled ? 'Comments are turned off for this post.' : '',
      };
    }

    function close() {
      closed = true;
    }

    return { load, loadMore, toggleReplies, toggleLike, setReplyTarget, post, getView, close };
  }

  // =========================================================================
  // Live Comments Bridge (supports Reels popovers, Feed modals, & Single Post pages)
  // =========================================================================
  function findCommentComposer(root) {
    if (!root) return null;
    const selectors = [
      'textarea[placeholder*="comment" i]',
      'input[placeholder*="comment" i]',
      'textarea[aria-label*="comment" i]',
      'input[aria-label*="comment" i]',
      '[aria-placeholder*="comment" i]',
      '[contenteditable="true"][aria-label*="comment" i]',
      '[contenteditable="true"][role="textbox"]',
    ];
    for (const sel of selectors) {
      const el = root.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function findCommentPostButton(root, composer) {
    const scope = composer?.closest('form') || composer?.parentElement?.parentElement || root;
    if (!scope) return null;
    const buttons = Array.from(scope.querySelectorAll('button, [role="button"]'));
    for (const btn of buttons) {
      const txt = (btn.textContent || '').trim().toLowerCase();
      if (txt === 'post' || btn.getAttribute('type') === 'submit') {
        return btn;
      }
    }
    return null;
  }

  function looksLikeCommentsPanel(el) {
    if (!el || !el.isConnected) return false;
    if (findCommentComposer(el)) return true;
    const textEls = Array.from(el.querySelectorAll('h1, h2, h3, h4, span, div')).slice(0, 40);
    if (textEls.some((h) => (h.textContent || '').trim().toLowerCase() === 'comments')) {
      return true;
    }
    if (el.querySelector('a[href*="/c/"] time') || el.querySelectorAll('time').length >= 2) {
      return true;
    }
    return false;
  }

  function findInlineCommentsContainer(doc = document, postContainer = null) {
    // On /reel/<id>/ and /p/<id>/ pages, comments are rendered inline with <a href=".../c/..."><time>
    const commentTimeLinks = Array.from(doc.querySelectorAll('a[href*="/c/"] time'));
    const timeNodes =
      commentTimeLinks.length > 0
        ? commentTimeLinks
        : postContainer
          ? Array.from(postContainer.querySelectorAll('time'))
          : Array.from(doc.querySelectorAll('time'));

    if (timeNodes.length === 0) return null;
    // Find lowest common ancestor of comment <time> nodes that does NOT swallow the <video> if possible
    let common = timeNodes[0].parentElement;
    while (common && common !== doc.body) {
      if (timeNodes.every((t) => common.contains(t))) {
        // Climb up slightly if composer sits in a sibling right beside the list
        let withComposer = common;
        for (let i = 0; i < 4 && withComposer.parentElement && withComposer.parentElement !== doc.body; i++) {
          if (findCommentComposer(withComposer)) break;
          if (withComposer.parentElement.querySelector('video')) break;
          withComposer = withComposer.parentElement;
        }
        return withComposer;
      }
      common = common.parentElement;
    }
    return postContainer || null;
  }

  function findCommentsScrollList(root, composer) {
    if (!root) return null;
    const candidates = Array.from(root.querySelectorAll('ul, div'));
    let best = null;
    let bestScore = -1;
    for (const el of candidates) {
      if (composer && el.contains(composer) && el === root) continue;
      if (el.querySelector('video')) continue;
      const style = globalScope.getComputedStyle ? globalScope.getComputedStyle(el) : null;
      const overflowY = style ? style.overflowY : '';
      const scrollable = overflowY === 'auto' || overflowY === 'scroll' || el.scrollHeight > el.clientHeight + 16;
      const timeCount = el.querySelectorAll('time').length;
      if (!scrollable && timeCount === 0) continue;
      const score = (scrollable ? 100 : 0) + timeCount * 10 - (composer && el.contains(composer) ? 60 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }
    return best || root;
  }

  function createCommentsBridge(doc = document) {
    let activeRoot = null;
    let isOverlay = false;
    let openedByUs = false;
    let commentIdMap = new WeakMap();
    let commentSeq = 0;
    let lastItemsById = new Map();

    function getStableId(el) {
      if (!commentIdMap.has(el)) {
        commentIdMap.set(el, `c-${++commentSeq}`);
      }
      return commentIdMap.get(el);
    }

    const COMPOSER_SELECTOR =
      'textarea[placeholder*="comment" i], input[placeholder*="comment" i], textarea[aria-label*="comment" i], ' +
      'input[aria-label*="comment" i], [aria-placeholder*="comment" i], [contenteditable="true"][role="textbox"]';

    /** Largest ancestor of `el` that still holds no <video> — i.e. the whole comments column / popover. */
    function climbVideoFree(el) {
      const dialog = el.closest('[role="dialog"]');
      if (dialog && !dialog.querySelector('video')) return dialog;
      let cur = el;
      while (cur.parentElement && cur.parentElement !== doc.body && !cur.parentElement.querySelector('video')) {
        cur = cur.parentElement;
      }
      return cur;
    }

    /**
     * Locate the comments panel Instagram rendered. Never trusts a single freshly-added node
     * (React inserts the header, list and composer separately); always resolves the whole panel.
     */
    function resolveOverlayRoot(known) {
      const dialogs = Array.from(doc.querySelectorAll('[role="dialog"]'));
      for (let i = dialogs.length - 1; i >= 0; i--) {
        const d = dialogs[i];
        if (known.dialogs.has(d)) continue;
        if (looksLikeCommentsPanel(d) || d.querySelector('[role="progressbar"]')) return d;
      }
      const composers = Array.from(doc.querySelectorAll(COMPOSER_SELECTOR)).filter((c) => !known.composers.has(c));
      if (composers.length > 0) return climbVideoFree(composers[composers.length - 1]);

      const headings = Array.from(doc.querySelectorAll('h1, h2, h3, span, div')).filter(
        (el) =>
          !known.headings.has(el) &&
          el.children.length === 0 &&
          (el.textContent || '').trim().toLowerCase() === 'comments'
      );
      if (headings.length > 0) {
        const root = climbVideoFree(headings[headings.length - 1]);
        if (root !== headings[headings.length - 1]) return root;
      }
      return null;
    }

    function snapshotKnown() {
      return {
        dialogs: new Set(doc.querySelectorAll('[role="dialog"]')),
        composers: new Set(doc.querySelectorAll(COMPOSER_SELECTOR)),
        headings: new Set(
          Array.from(doc.querySelectorAll('h1, h2, h3, span, div')).filter(
            (el) => el.children.length === 0 && (el.textContent || '').trim().toLowerCase() === 'comments'
          )
        ),
      };
    }

    let lastPostContainer = null;
    const EMPTY_KNOWN = { dialogs: new Set(), composers: new Set(), headings: new Set() };

    async function open(postContainer) {
      lastPostContainer = postContainer || null;

      // 1. Comments already rendered inline (single /reel/<id>/ or /p/<id>/ page).
      const isSinglePostPage = /^\/(?:[A-Za-z0-9._]+\/)?(reel|p|tv)\/[A-Za-z0-9_-]+/.test(doc.location?.pathname || '');
      if (isSinglePostPage) {
        const inlineRoot = findInlineCommentsContainer(doc, postContainer);
        if (inlineRoot && inlineRoot.querySelectorAll('time').length > 0) {
          activeRoot = inlineRoot;
          isOverlay = false;
          openedByUs = false;
          return { ok: true, root: activeRoot };
        }
      }

      // 2. A comments panel that is already open (the user opened it before popping out).
      const already = resolveOverlayRoot(EMPTY_KNOWN);
      if (
        already &&
        !(postContainer && (already.contains(postContainer) || postContainer.contains(already))) &&
        already.querySelectorAll('time').length > 0
      ) {
        activeRoot = already;
        isOverlay = true;
        openedByUs = false;
        return { ok: true, root: activeRoot };
      }

      // 3. Click Instagram's own Comment button and wait for the panel it renders.
      const known = snapshotKnown();
      const actions = findActionButtons(postContainer);
      if (!actions.commentBtn) {
        return { ok: false, error: 'This post has no comment button (comments may be turned off).' };
      }
      safeClick(actions.commentBtn);
      openedByUs = true;

      const startedAt = Date.now();
      const deadline = startedAt + 4200;
      let retried = false;
      while (Date.now() < deadline) {
        if (findLoginWall(doc)) {
          dismissLoginWall(doc);
          openedByUs = false;
          return { ok: false, loginRequired: true, error: 'Log in to Instagram to view and post comments.' };
        }
        if (!retried && Date.now() - startedAt > 1600) {
          // Nothing appeared: the first click may have closed a panel that was already open.
          retried = true;
          const again = findActionButtons(postContainer).commentBtn;
          if (again) safeClick(again);
        }
        const root = resolveOverlayRoot(known);
        if (root) {
          activeRoot = root;
          isOverlay = true;
          return { ok: true, root: activeRoot };
        }
        await sleep(80);
      }

      const fallbackInline = findInlineCommentsContainer(doc, postContainer);
      if (fallbackInline && fallbackInline.querySelectorAll('time').length > 0) {
        activeRoot = fallbackInline;
        isOverlay = false;
        openedByUs = false;
        return { ok: true, root: activeRoot };
      }

      openedByUs = false;
      return { ok: false, error: 'Instagram did not open the comments for this video.' };
    }

    function close() {
      if (activeRoot && isOverlay && openedByUs && activeRoot.isConnected) {
        const closeBtn = findDialogCloseButton(activeRoot);
        if (closeBtn) {
          safeClick(closeBtn);
        }
      }
      activeRoot = null;
      isOverlay = false;
      openedByUs = false;
      lastItemsById.clear();
    }

    function scrape() {
      if (activeRoot && !activeRoot.isConnected && isOverlay) {
        const again = resolveOverlayRoot(EMPTY_KNOWN);
        if (again && !(lastPostContainer && again.contains(lastPostContainer))) activeRoot = again;
      }
      if (!activeRoot || !activeRoot.isConnected) {
        return {
          open: false,
          comments: [],
          hasComposer: false,
          isLoading: false,
          scrollEl: null,
        };
      }

      const composer = findCommentComposer(activeRoot);
      const scrollEl = findCommentsScrollList(activeRoot, composer);
      const searchScope = scrollEl || activeRoot;
      const items = [];
      const seenRows = new Set();
      lastItemsById.clear();

      // Collect anchors: <time> elements first; fallback to Reply buttons or relative age spans
      const anchorSet = new Set(searchScope.querySelectorAll('time'));
      let anchorMode = 'time';
      if (anchorSet.size === 0) {
        anchorMode = 'reply';
        const replyBtns = Array.from(searchScope.querySelectorAll('button, [role="button"]')).filter(
          (b) => (b.textContent || '').trim().toLowerCase() === 'reply'
        );
        for (const b of replyBtns) anchorSet.add(b);
      }

      const countPeers = (el) => {
        if (anchorMode === 'time') return el.querySelectorAll('time').length;
        return Array.from(el.querySelectorAll('button, [role="button"]')).filter(
          (b) => (b.textContent || '').trim().toLowerCase() === 'reply'
        ).length;
      };

      const anchors = Array.from(anchorSet);
      for (const anchorEl of anchors) {
        if (composer && composer.contains(anchorEl)) continue;

        // Climb ALL THE WAY UP to the HIGHEST ancestor that still owns ONLY THIS comment
        // (countPeers === 1, no video, no composer, no dialog header "Comments").
        // On real Instagram 2026 DOM, author+time are at depth 3, text at depth 4,
        // Like+Reply at depth 6, and avatar at depth 8-9!
        let cur = anchorEl.parentElement;
        let bestRow = null;
        while (cur && cur !== searchScope && cur !== activeRoot && cur !== doc.body) {
          if (countPeers(cur) > 1) break;
          if (composer && cur.contains(composer)) break;
          if (cur.querySelector('video')) break;
          // Stop before swallowing the Comments drawer header close button
          if (cur.querySelector('svg[aria-label="Close" i]')) break;

          const hasProfile = Boolean(
            Array.from(cur.querySelectorAll('a[href]')).some((a) => isProfileHref(a.getAttribute('href')))
          );
          if (hasProfile) {
            bestRow = cur;
          }
          cur = cur.parentElement;
        }

        if (!bestRow || seenRows.has(bestRow)) continue;
        seenRows.add(bestRow);

        // Extract author
        let author = '';
        let authorUrl = '';
        let avatar = '';
        const links = Array.from(bestRow.querySelectorAll('a[href]'));
        for (const a of links) {
          const href = a.getAttribute('href') || '';
          if (isProfileHref(href)) {
            const uname = extractProfileUsername(href);
            if (uname) {
              author = uname;
              authorUrl = new URL(`/${uname}/`, 'https://www.instagram.com').href;
              break;
            }
          }
        }
        const avatarImg = bestRow.querySelector('img[src]');
        if (avatarImg) avatar = avatarImg.src;

        let timeText = anchorMode === 'time' ? (anchorEl.textContent || '').trim() : '';
        if (!timeText) {
          const ageSpan = Array.from(bestRow.querySelectorAll('time, span')).find((s) =>
            /^(\d+[smhdwy]|just now)$/i.test((s.textContent || '').trim())
          );
          if (ageSpan) timeText = (ageSpan.textContent || '').trim();
        }

        // Comment Like button: supports BOTH small heart SVG AND Instagram 2026 text <button>Like</button>!
        let likeBtnEl = null;
        let isLiked = false;
        const svgs = Array.from(bestRow.querySelectorAll('svg'));
        for (const svg of svgs) {
          const lbl = getSvgLabel(svg).toLowerCase();
          if (lbl === 'like' || lbl === 'unlike') {
            likeBtnEl = findClickableParent(svg, bestRow);
            isLiked = lbl === 'unlike' || isHeartRed(svg);
            break;
          }
        }

        let replyBtnEl = null;
        let likesText = '';
        let viewRepliesBtnEl = null;
        let repliesLabel = '';
        const buttons = Array.from(bestRow.querySelectorAll('button, [role="button"]'));
        for (const b of buttons) {
          const txt = (b.textContent || '').trim();
          const lower = txt.toLowerCase();
          if (lower === 'reply') {
            replyBtnEl = b;
          } else if (!likeBtnEl && (lower === 'like' || lower === 'unlike')) {
            likeBtnEl = b;
            isLiked = lower === 'unlike';
          } else if (/^\d[\d.,]*[KMBkmb]?\s*likes?$/i.test(txt) || isCompactCount(txt)) {
            if (!likesText && b !== likeBtnEl) likesText = txt;
          } else if (/^(view|hide)\s+(all\s+)?(\d+\s+)?(more\s+)?repl/i.test(lower)) {
            viewRepliesBtnEl = b;
            repliesLabel = txt;
          }
        }
        if (!likesText && likeBtnEl) {
          likesText = extractNearbyCount(likeBtnEl, bestRow);
        }

        // Check next sibling of bestRow for a "View replies (N)" button
        if (!viewRepliesBtnEl && bestRow.nextElementSibling) {
          const sibButtons = Array.from(bestRow.nextElementSibling.querySelectorAll('button, [role="button"]'));
          for (const b of sibButtons) {
            const txt = (b.textContent || '').trim();
            if (/^(view|hide)\s+(all\s+)?(\d+\s+)?(more\s+)?repl/i.test(txt)) {
              viewRepliesBtnEl = b;
              repliesLabel = txt;
              break;
            }
          }
        }

        // Extract comment body text cleanly
        const bodyCandidates = [];
        const textEls = Array.from(bestRow.querySelectorAll('span[dir="auto"], span, div[dir="auto"]'));
        for (const el of textEls) {
          if (el.closest('button, [role="button"], time')) continue;
          if (el.querySelector('time, button, [role="button"], img, svg')) continue;
          if (el.querySelector('span[dir="auto"]')) continue;
          // Skip links that only wrap the author username
          const parentLink = el.closest('a[href]');
          if (parentLink && isProfileHref(parentLink.getAttribute('href')) && sanitizeHandle(el.textContent) === author) {
            continue;
          }
          const txt = (el.textContent || '').trim();
          if (!txt) continue;
          if (
            txt === author ||
            txt === `@${author}` ||
            txt === timeText ||
            txt === likesText ||
            txt === '·' ||
            txt === '•'
          ) {
            continue;
          }
          if (/^(like|unlike|reply|see translation|view replies|hide replies|\d[\d.,]*[KMBkmb]?\s*likes?)$/i.test(txt)) {
            continue;
          }
          if (!bodyCandidates.includes(txt)) {
            bodyCandidates.push(txt);
          }
        }
        const filtered = bodyCandidates.filter(
          (t) => !bodyCandidates.some((other) => other !== t && other.includes(t))
        );
        let text = filtered.join(' ').trim();
        if (!text && !author) continue;
        // No text but more than the avatar: a GIF or sticker comment.
        if (!text) {
          if (bestRow.querySelectorAll('img, video, canvas').length < 2) continue;
          text = MEDIA_ONLY_COMMENT;
        }

        const id = getStableId(bestRow);
        const item = {
          id,
          author: author || 'user',
          authorUrl,
          avatar,
          time: timeText,
          text,
          likesText,
          isLiked,
          hasReplyBtn: Boolean(replyBtnEl),
          repliesLabel,
          hasViewReplies: Boolean(viewRepliesBtnEl),
          likeBtnEl,
          replyBtnEl,
          viewRepliesBtnEl,
          rowEl: bestRow,
        };
        items.push(item);
        lastItemsById.set(id, item);
      }

      const isLoading = Boolean(
        activeRoot.querySelector('[role="progressbar"], [aria-label*="Loading" i]')
      );

      return {
        open: true,
        comments: items,
        hasComposer: Boolean(composer),
        isLoading: isLoading && items.length === 0,
        scrollEl,
      };
    }

    function scrollMore() {
      if (!activeRoot || !activeRoot.isConnected) return false;
      // Also click Instagram's "Load more comments" button if present!
      const loadMoreSvg = activeRoot.querySelector('svg[aria-label*="Load more comments" i]');
      if (loadMoreSvg) {
        const btn = findClickableParent(loadMoreSvg, activeRoot);
        if (btn) safeClick(btn);
      }
      const composer = findCommentComposer(activeRoot);
      const scrollEl = findCommentsScrollList(activeRoot, composer);
      if (!scrollEl) return false;
      const before = scrollEl.scrollTop;
      scrollEl.scrollTop += Math.max(scrollEl.clientHeight * 0.85, 360);
      return scrollEl.scrollTop !== before;
    }

    function clickCommentLike(id) {
      const item = lastItemsById.get(id);
      if (!item || !item.likeBtnEl) return false;
      return safeClick(item.likeBtnEl);
    }

    function clickCommentReply(id) {
      const item = lastItemsById.get(id);
      if (!item || !item.replyBtnEl) return null;
      safeClick(item.replyBtnEl);
      return item.author;
    }

    function clickViewReplies(id) {
      const item = lastItemsById.get(id);
      if (!item || !item.viewRepliesBtnEl) return false;
      return safeClick(item.viewRepliesBtnEl);
    }

    async function postComment(text) {
      if (!activeRoot || !activeRoot.isConnected) {
        return { ok: false, error: 'Comments panel is closed.' };
      }
      const trimmed = (text || '').trim();
      if (!trimmed) return { ok: false, error: 'Empty comment.' };

      const composer = findCommentComposer(activeRoot);
      if (!composer) {
        return { ok: false, error: 'Comment box not found (comments may be restricted or logged out).' };
      }

      setReactInputValue(composer, trimmed, doc);
      await sleep(120);

      const deadline = Date.now() + 900;
      let postBtn = null;
      while (Date.now() < deadline) {
        postBtn = findCommentPostButton(activeRoot, composer);
        if (postBtn && !postBtn.disabled && postBtn.getAttribute('aria-disabled') !== 'true') {
          break;
        }
        await sleep(60);
      }

      if (postBtn && !postBtn.disabled && postBtn.getAttribute('aria-disabled') !== 'true') {
        safeClick(postBtn);
        return { ok: true };
      }

      try {
        composer.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true })
        );
        const form = composer.closest('form');
        if (form && typeof form.requestSubmit === 'function') {
          form.requestSubmit();
        }
        return { ok: true };
      } catch (err) {
        return { ok: false, error: String(err?.message || err) };
      }
    }

    function getRoot() {
      return activeRoot;
    }

    /** Same shape as createApiCommentsSource().getView(). */
    function getView() {
      const data = scrape();
      return {
        open: data.open,
        source: 'dom',
        comments: data.comments.map((c) => ({
          id: c.id,
          author: c.author,
          avatar: c.avatar,
          time: c.time,
          text: c.text,
          likesText: (c.likesText || '').replace(/\s*likes?$/i, ''),
          isLiked: c.isLiked,
          canLike: Boolean(c.likeBtnEl),
          canReply: Boolean(c.replyBtnEl),
          repliesLabel: c.viewRepliesBtnEl ? c.repliesLabel || 'View replies' : '',
          depth: 0,
        })),
        total: data.comments.length,
        hasComposer: data.hasComposer,
        isLoading: data.isLoading,
        isLoadingMore: false,
        hasMore: data.open,
        emptyMessage: '',
      };
    }

    return {
      open,
      close,
      scrape,
      getView,
      scrollMore,
      clickCommentLike,
      clickCommentReply,
      clickViewReplies,
      postComment,
      getRoot,
    };
  }

  // =========================================================================
  // Live Share / Send to People Bridge
  // =========================================================================
  function findShareSearchInput(dialog) {
    if (!dialog) return null;
    return (
      dialog.querySelector('input[name="queryBox"]') ||
      dialog.querySelector('input[placeholder*="Search" i]') ||
      dialog.querySelector('input[aria-label*="Search" i]') ||
      dialog.querySelector('input[type="search"]') ||
      dialog.querySelector('input[type="text"]')
    );
  }

  function findShareMessageInput(dialog, searchInput) {
    if (!dialog) return null;
    const candidates = [
      dialog.querySelector('input[name="shareCommentText"]'),
      dialog.querySelector('input[placeholder*="message" i]'),
      dialog.querySelector('textarea[placeholder*="message" i]'),
      dialog.querySelector('input[aria-label*="message" i]'),
    ].filter(Boolean);
    for (const el of candidates) {
      if (el !== searchInput) return el;
    }
    return null;
  }

  function findShareSendButton(dialog) {
    if (!dialog) return null;
    const buttons = Array.from(dialog.querySelectorAll('button, [role="button"]'));
    for (const btn of buttons) {
      const txt = (btn.textContent || '').trim();
      if (/^(send|send separately|send to group)$/i.test(txt)) {
        return btn;
      }
    }
    return null;
  }

  function looksLikeShareDialog(dialog) {
    if (!dialog || !dialog.isConnected) return false;
    if (dialog.querySelector('video')) return false;
    if (findShareSearchInput(dialog)) return true;
    const heading = Array.from(dialog.querySelectorAll('h1, h2, h3, span')).slice(0, 14);
    return heading.some((el) => /^(share|send to|new message)$/i.test((el.textContent || '').trim()));
  }

  /** Logged-out "Share to…" sheet: only external targets (Threads, Facebook, copy link), no people. */
  function isExternalOnlyShareSheet(dialog) {
    if (!dialog || !dialog.isConnected || dialog.querySelector('video, input, textarea')) return false;
    const text = (dialog.textContent || '').trim().toLowerCase();
    return text.startsWith('share to') || Boolean(dialog.querySelector('[aria-label="Copy link" i]'));
  }

  function isRecipientSelected(row) {
    if (!row) return false;
    const cb = row.querySelector('input[type="checkbox"], input[type="radio"]');
    if (cb && cb.checked) return true;
    if (row.getAttribute('aria-checked') === 'true' || row.getAttribute('aria-selected') === 'true') {
      return true;
    }
    if (row.querySelector('[aria-checked="true"], [aria-selected="true"], [data-selected="true"]')) {
      return true;
    }
    const svgs = Array.from(row.querySelectorAll('svg'));
    for (const svg of svgs) {
      const lbl = getSvgLabel(svg).toLowerCase();
      if (lbl.includes('check') || lbl.includes('selected') || lbl.includes('toggle')) {
        return true;
      }
      const fill = (svg.getAttribute('fill') || '').toLowerCase();
      if (fill === '#0095f6' || fill === 'rgb(0, 149, 246)') return true;
    }
    return false;
  }

  function createShareBridge(doc = document) {
    let activeDialog = null;
    let openedByUs = false;
    let recipientIdMap = new WeakMap();
    let recipientSeq = 0;
    let lastRecipientsById = new Map();

    function getStableId(el) {
      if (!recipientIdMap.has(el)) {
        recipientIdMap.set(el, `r-${++recipientSeq}`);
      }
      return recipientIdMap.get(el);
    }

    async function open(postContainer) {
      const addedNodes = new Set();
      const existingDialogs = new Set(doc.querySelectorAll('[role="dialog"]'));
      const mutObs = new MutationObserver((records) => {
        for (const rec of records) {
          for (const node of rec.addedNodes) {
            if (node && node.nodeType === 1) addedNodes.add(node);
          }
        }
      });
      mutObs.observe(doc.body, { childList: true, subtree: true });

      const actions = findActionButtons(postContainer);
      if (!actions.shareBtn) {
        mutObs.disconnect();
        return { ok: false, error: 'Share button not found on this post.' };
      }
      safeClick(actions.shareBtn);
      openedByUs = true;

      try {
        const deadline = Date.now() + 3500;
        while (Date.now() < deadline) {
          if (findLoginWall(doc)) {
            dismissLoginWall(doc);
            openedByUs = false;
            return { ok: false, loginRequired: true, error: 'Log in to Instagram to send this to people.' };
          }
          const dialogs = Array.from(doc.querySelectorAll('[role="dialog"]'));
          for (let i = dialogs.length - 1; i >= 0; i--) {
            const d = dialogs[i];
            if (existingDialogs.has(d)) continue;
            if (looksLikeShareDialog(d)) {
              activeDialog = d;
              return { ok: true, dialog: activeDialog };
            }
            if (isExternalOnlyShareSheet(d)) {
              const closeBtn = findDialogCloseButton(d);
              if (closeBtn) safeClick(closeBtn);
              openedByUs = false;
              return {
                ok: false,
                loginRequired: true,
                error: 'Log in to Instagram to send this to people. You can still copy the link below.',
              };
            }
          }
          for (const node of Array.from(addedNodes).reverse()) {
            if (!node.isConnected) continue;
            if (looksLikeShareDialog(node)) {
              activeDialog = node;
              return { ok: true, dialog: activeDialog };
            }
          }
          await sleep(90);
        }
      } finally {
        mutObs.disconnect();
      }

      const dialogs = Array.from(doc.querySelectorAll('[role="dialog"]'));
      const found = dialogs.reverse().find((d) => looksLikeShareDialog(d));
      if (found) {
        activeDialog = found;
        return { ok: true, dialog: activeDialog };
      }

      return { ok: false, error: 'Could not open Instagram Share dialog.' };
    }

    function close() {
      if (activeDialog && openedByUs && activeDialog.isConnected) {
        const closeBtn = findDialogCloseButton(activeDialog);
        if (closeBtn) safeClick(closeBtn);
      }
      activeDialog = null;
      openedByUs = false;
      lastRecipientsById.clear();
    }

    function scrape() {
      if (!activeDialog || !activeDialog.isConnected) {
        return {
          open: false,
          recipients: [],
          selectedCount: 0,
          sendLabel: 'Send',
          canSend: false,
          hasMessageInput: false,
          isLoading: false,
          query: '',
        };
      }

      const searchInput = findShareSearchInput(activeDialog);
      const messageInput = findShareMessageInput(activeDialog, searchInput);
      const sendBtn = findShareSendButton(activeDialog);
      const closeBtn = findDialogCloseButton(activeDialog);

      const recipients = [];
      const seen = new Set();
      lastRecipientsById.clear();

      const clickables = Array.from(
        activeDialog.querySelectorAll('[role="button"], button, label, [role="checkbox"], [role="option"]')
      );

      for (const el of clickables) {
        if (el === sendBtn || el === closeBtn) continue;
        if (searchInput && el.contains(searchInput)) continue;
        if (messageInput && el.contains(messageInput)) continue;
        if (sendBtn && (el.contains(sendBtn) || sendBtn.contains(el))) continue;
        if (closeBtn && (el.contains(closeBtn) || closeBtn.contains(el))) continue;

        const imgs = Array.from(el.querySelectorAll('img[src]'));
        const hasCheckbox = Boolean(el.querySelector('input[type="checkbox"], input[type="radio"]'));
        if (imgs.length === 0 && !hasCheckbox) continue;

        const innerCheckboxes = el.querySelectorAll('input[type="checkbox"], input[type="radio"]').length;
        if (innerCheckboxes > 1) continue;
        if (imgs.length > 3) continue;

        if (Array.from(seen).some((prev) => prev.contains(el) || el.contains(prev))) continue;

        const textLines = (el.innerText || el.textContent || '')
          .split(/\n+/)
          .map((s) => s.trim())
          .filter(Boolean);

        const primaryLabel = textLines[0] || '';
        const secondaryLabel = textLines[1] || '';
        if (!primaryLabel) continue;
        if (EXTERNAL_SHARE_LABELS.has(primaryLabel.toLowerCase())) continue;

        seen.add(el);
        const id = getStableId(el);
        const isSelected = isRecipientSelected(el);
        const rec = {
          id,
          name: primaryLabel,
          username: secondaryLabel && secondaryLabel !== primaryLabel ? secondaryLabel : '',
          avatar: imgs[0]?.src || '',
          isSelected,
          rowEl: el,
        };
        recipients.push(rec);
        lastRecipientsById.set(id, rec);
      }

      const selectedCount = recipients.filter((r) => r.isSelected).length;
      const sendLabel = sendBtn ? (sendBtn.textContent || 'Send').trim() : 'Send';
      const canSend = Boolean(
        sendBtn &&
          !sendBtn.disabled &&
          sendBtn.getAttribute('aria-disabled') !== 'true' &&
          (selectedCount > 0 || Boolean(messageInput))
      );
      const isLoading = Boolean(
        activeDialog.querySelector('[role="progressbar"], [aria-label*="Loading" i]')
      );

      return {
        open: true,
        recipients,
        selectedCount,
        sendLabel,
        canSend,
        hasMessageInput: Boolean(messageInput),
        isLoading: isLoading && recipients.length === 0,
        query: searchInput ? searchInput.value || '' : '',
      };
    }

    function setSearchQuery(query) {
      if (!activeDialog || !activeDialog.isConnected) return false;
      const searchInput = findShareSearchInput(activeDialog);
      if (!searchInput) return false;
      return setReactInputValue(searchInput, query, doc);
    }

    function toggleRecipient(id) {
      const rec = lastRecipientsById.get(id);
      if (!rec || !rec.rowEl) return false;
      const cb = rec.rowEl.querySelector('input[type="checkbox"], input[type="radio"]');
      if (cb) safeClick(cb);
      else safeClick(rec.rowEl);
      return true;
    }

    function setMessage(text) {
      if (!activeDialog || !activeDialog.isConnected) return false;
      const searchInput = findShareSearchInput(activeDialog);
      const msgInput = findShareMessageInput(activeDialog, searchInput);
      if (!msgInput) return false;
      return setReactInputValue(msgInput, text, doc);
    }

    async function clickSend(optionalMessage = '') {
      if (!activeDialog || !activeDialog.isConnected) {
        return { ok: false, error: 'Share dialog is closed.' };
      }
      if (optionalMessage && optionalMessage.trim()) {
        setMessage(optionalMessage.trim());
        await sleep(80);
      }
      const sendBtn = findShareSendButton(activeDialog);
      if (!sendBtn || sendBtn.disabled || sendBtn.getAttribute('aria-disabled') === 'true') {
        return { ok: false, error: 'Select at least one person first.' };
      }
      safeClick(sendBtn);
      const waitDeadline = Date.now() + 450;
      while (Date.now() < waitDeadline && activeDialog && activeDialog.isConnected) {
        await sleep(50);
      }
      openedByUs = false;
      return { ok: true };
    }

    function getDialog() {
      return activeDialog;
    }

    return {
      open,
      close,
      scrape,
      setSearchQuery,
      toggleRecipient,
      setMessage,
      clickSend,
      getDialog,
    };
  }

  const adapter = {
    sleep,
    isElementVisible,
    getSvgLabel,
    findAllVideos,
    findActiveVideo,
    findPostContainer,
    findActionButtons,
    extractPostState,
    toggleLike,
    ensureLiked,
    toggleSave,
    stepCarousel,
    findScrollContainer,
    getFeedContainers,
    closeOpenDialogs,
    scrollToAdjacentVideo,
    setReactInputValue,
    createCommentsBridge,
    createShareBridge,
    isProfileHref,
    extractProfileUsername,
    sanitizeHandle,
    extractShortcode,
    shortcodeToMediaId,
    resolvePostShortcode,
    findNativeReelNav,
    clickNativeReelNav,
    findCenteredVideo,
    findMuteToggle,
    clickMuteToggle,
    findLoginWall,
    dismissLoginWall,
    createInstagramApi,
    createApiCommentsSource,
    formatAge,
    formatCompact,
  };

  globalScope.__IGPipAdapter = adapter;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = adapter;
  }
})(typeof window !== 'undefined' ? window : globalThis);
