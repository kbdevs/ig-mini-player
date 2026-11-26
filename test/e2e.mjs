/**
 * End-to-end test: real Google Chrome, the unpacked extension, live instagram.com.
 *
 *   node test/e2e.mjs
 *
 * Runs logged out, so Instagram itself limits two things: the Reels feed stops after a few
 * videos, and liking / commenting / sending answer with a login wall. Those paths are checked for
 * a clean "log in" message, and the logged-in comments flow is exercised against simulated
 * Instagram API responses (section "comments: logged in (simulated)").
 *
 * The test switches the frontmost macOS app (Finder) to exercise the leave-the-browser pop-out.
 */
import { launch, sleep, activateFinder, frontAppBundle } from './lib/harness.mjs';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}
const section = (title) => console.log(`\n# ${title}`);

const b = await launch();
let exitCode = 1;
try {
  await sleep(800);
  const ig = await b.newTab('https://www.instagram.com/reels/');
  const other = await b.newTab('https://example.com', { background: true });
  await sleep(8000);
  const sw = await b.serviceWorker();
  const tabs = await sw.eval(
    `chrome.tabs.query({}).then(ts => ts.map(t => ({id: t.id, w: t.windowId, u: t.url || ''})))`
  );
  const igTab = tabs.find((t) => t.u.includes('instagram.com'));

  // ---- helpers -----------------------------------------------------------
  const status = () => sw.eval(`chrome.tabs.sendMessage(${igTab.id}, {type: 'igpip:get-status'})`);
  const pipOpen = () => ig.eval('Boolean(window.documentPictureInPicture?.window)');
  const waitPip = async (want, ms = 4000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if ((await pipOpen()) === want) return Date.now() - t0;
      await sleep(80);
    }
    return -1;
  };
  const windowFocused = () => sw.eval(`chrome.windows.get(${igTab.w}).then(w => w.focused)`);
  /** Bring the test browser's window to the front (other apps on the machine may hold focus). */
  const focusBrowser = async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      await sw.eval(`chrome.windows.update(${igTab.w}, {focused: true})`);
      await sleep(800);
      if (await windowFocused()) return true;
    }
    return false;
  };
  const where = async () =>
    `tabs: ${(await windowTabs()).join(' | ')}; window focused: ${await windowFocused()}; front app: ${frontAppBundle().split(':').filter(Boolean).pop()}`;
  const windowTabs = () =>
    sw.eval(
      `chrome.tabs.query({windowId: ${igTab.w}}).then(ts => ts.map(t => (t.active ? '*' : '') + (t.url || '').replace('chrome-extension://' + chrome.runtime.id, 'ext').slice(0, 34)))`
    );
  const playingCount = () => ig.eval(`Array.from(document.querySelectorAll('video')).filter(v => !v.paused).length`);
  /** Run code against the popup's document from the content script's world. */
  const q = (body) =>
    ig.evalIsolated(
      `(() => { const d = window.documentPictureInPicture?.window?.document; if (!d) return null; ${body} })()`
    );
  let pip = null;
  const clickSel = async (sel) => {
    const pt = await q(
      `const el = d.querySelector(${JSON.stringify(sel)}); if (!el) return null; el.scrollIntoView({block: 'nearest'}); const r = el.getBoundingClientRect(); return {x: r.left + r.width / 2, y: r.top + r.height / 2};`
    );
    if (!pt) return false;
    await pip.click(pt.x, pt.y);
    return true;
  };
  const source = () =>
    ig.eval(`(() => { const all = Array.from(document.querySelectorAll('video')); const v = all.find(x => x.getAttribute('data-igpip-playing-target') === '1'); return v ? {idx: all.indexOf(v), paused: v.paused, muted: v.muted, t: v.currentTime, dur: v.duration} : null; })()`);
  /** Frames actually painted by the popup's <video> during `ms` (survives the track being re-bound). */
  const framesAdvance = (ms = 1500) =>
    ig.evalIsolated(
      `new Promise((resolve) => { const w = window.documentPictureInPicture?.window; if (!w) return resolve(-1); let n = 0; let stop = false; const tick = () => { if (stop) return; const v = w.document.querySelector('video'); if (!v) return resolve(-1); v.requestVideoFrameCallback(() => { n++; tick(); }); }; tick(); const again = setInterval(tick, 400); setTimeout(() => { stop = true; clearInterval(again); resolve(n); }, ${ms}); })`
    );
  /** One real click on the page: Chrome needs a user interaction before a muted tab can pop out. */
  const activatePage = async () => {
    await focusBrowser();
    await b.activate(ig.targetId);
    await waitPip(false, 3000);
    await sleep(400);
    const vp = await ig.eval('({w: innerWidth, h: innerHeight})');
    await ig.click(vp.w - 60, 200);
    await sleep(2800);
  };
  const popOutByTabSwitch = async () => {
    await b.activate(other.targetId);
    const ms = await waitPip(true);
    await sleep(700);
    pip = await b.pipTarget(3000);
    return ms;
  };
  const RAIL = 'button.igpip-rail-btn';
  /** Leave the browser for Finder once the video is ready; returns ms until the popup opened. */
  const leaveBrowser = async () => {
    for (let i = 0; i < 20 && !(await status()).autoPipReady; i++) await sleep(300);
    const info = {
      ready: (await status()).autoPipReady,
      windowFocused: await sw.eval(`chrome.windows.get(${igTab.w}).then(w => w.focused)`),
      front: frontAppBundle().split(':').filter(Boolean).pop(),
    };
    activateFinder();
    const ms = await waitPip(true, 6000);
    if (ms < 0) info.session = await sw.eval(`chrome.storage.session.get('igpipState')`);
    return { ms, info };
  };

  // ---- 1. setup ----------------------------------------------------------
  section('setup');
  check('content script attached', await ig.evalIsolated('Boolean(window.__igPipContentLoaded)'));
  const st0 = await status();
  check('a Reel is playing (muted, as Instagram starts them)', st0.isPlaying && st0.isMuted, JSON.stringify({ playing: st0.isPlaying, muted: st0.isMuted }));
  await activatePage();
  let readyAfterClick = false;
  for (let i = 0; i < 12 && !readyAfterClick; i++) {
    readyAfterClick = (await status()).autoPipReady;
    if (!readyAfterClick) await sleep(300);
  }
  check('muted Reel is ready to pop out after one click on the page', readyAfterClick);

  // ---- 2. tab switch -----------------------------------------------------
  section('pop out on tab switch (muted Reel)');
  const openMs = await popOutByTabSwitch();
  check('mini player opens when the tab is switched', openMs >= 0, `${openMs} ms`);
  const size = pip ? await pip.eval('({w: innerWidth, h: innerHeight})') : null;
  check('popup is the compact size', size && size.w === 364 && size.h === 628, JSON.stringify(size));
  const ui = await q(`return { author: d.querySelector('.igpip-author-name')?.textContent, avatar: Boolean(d.querySelector('.igpip-avatar, .igpip-avatar-fallback')), broken: Array.from(d.querySelectorAll('img')).filter(i => i.complete && i.naturalWidth === 0).length };`);
  check('author and avatar are shown, no broken images', ui && /^@\w/.test(ui.author || '') && ui.avatar && ui.broken === 0, JSON.stringify(ui));
  check('video is rendering in the popup', (await framesAdvance()) > 10);
  check('exactly one video is playing', (await playingCount()) === 1);

  // ---- 3. scrolling ------------------------------------------------------
  section('scroll inside the popup');
  const before = { url: await ig.eval('location.pathname'), src: await source() };
  await pip.wheel(size.w / 2, size.h / 2, 240);
  await sleep(2600);
  const after = { url: await ig.eval('location.pathname'), src: await source() };
  check('scrolling down moves to the next Reel', after.url !== before.url && after.src?.idx !== before.src?.idx, `${before.url} -> ${after.url}`);
  check('next Reel renders and only it plays', (await framesAdvance()) > 10 && (await playingCount()) === 1);
  await pip.wheel(size.w / 2, size.h / 2, -240);
  await sleep(2600);
  const back = { url: await ig.eval('location.pathname'), src: await source() };
  check('scrolling up returns to the previous Reel', back.src?.idx === before.src?.idx, `${after.url} -> ${back.url}`);

  // ---- 4. loop -----------------------------------------------------------
  section('Reel loops');
  await ig.eval(`(() => { const v = document.querySelector('video[data-igpip-playing-target="1"]'); v.currentTime = Math.max(0, v.duration - 1.5); })()`);
  let looped = false;
  let prevT = (await source()).t;
  for (let i = 0; i < 12 && !looped; i++) {
    await sleep(500);
    const t = (await source()).t;
    if (t < prevT - 1) looped = true;
    prevT = t;
  }
  await sleep(700);
  check('picture keeps moving after the Reel loops', looped && (await framesAdvance()) > 10, `looped=${looped}`);

  // ---- 5. controls -------------------------------------------------------
  section('popup controls');
  await clickSel(`${RAIL}[title*="ute"]`);
  await sleep(1200);
  const unmuted = await source();
  const igLabel = await ig.eval(`document.querySelector('svg[aria-label^="Audio is"]')?.getAttribute('aria-label')`);
  check('sound button unmutes the video and Instagram agrees', unmuted && !unmuted.muted && !unmuted.paused && igLabel === 'Audio is playing', `${JSON.stringify({ muted: unmuted?.muted, paused: unmuted?.paused })} ${igLabel}`);
  await clickSel(`${RAIL}[title*="ute"]`);
  await sleep(1000);
  check('sound button mutes it again', (await source())?.muted === true);
  await pip.click(size.w / 2, size.h / 2);
  await sleep(900);
  const paused = await source();
  const badge = await q(`return d.querySelector('.igpip-center-badge').classList.contains('paused');`);
  check('clicking the video pauses it and shows a play badge', paused?.paused && badge);
  await pip.click(size.w / 2, size.h / 2);
  await sleep(900);
  check('clicking again resumes', (await source())?.paused === false);

  // ---- 6. logged-out actions --------------------------------------------
  section('actions while logged out');
  await clickSel(`${RAIL}[title^="Like"]`);
  await sleep(1300);
  const likeToast = await q(`return d.querySelector('.igpip-toast')?.textContent || '';`);
  check('like explains that a login is needed', /log in/i.test(likeToast), likeToast);
  await sleep(2600);
  await clickSel(`${RAIL}[title^="Comments"]`);
  await sleep(3200);
  const loggedOutComments = await q(`return d.querySelector('.igpip-pane-body')?.textContent || '';`);
  check('comments explain that a login is needed', /log in/i.test(loggedOutComments), loggedOutComments.slice(0, 60));
  await clickSel(`${RAIL}[title^="Send"]`);
  await sleep(4200);
  const loggedOutSend = await q(`return d.querySelector('.igpip-pane-body')?.textContent || '';`);
  check('send explains that a login is needed', /log in/i.test(loggedOutSend), loggedOutSend.slice(0, 60));
  await clickSel('.igpip-drawer-actions button[title^="Close"]');
  await sleep(400);

  // ---- 7. return ---------------------------------------------------------
  section('return to the Instagram tab');
  await b.activate(ig.targetId);
  const closeMs = await waitPip(false);
  await sleep(900);
  check('popup closes when the tab is active again', closeMs >= 0, `${closeMs} ms`);
  check('video keeps playing in the tab', (await playingCount()) === 1);

  // ---- 8. leaving the browser -------------------------------------------
  section('pop out when the browser loses focus');
  await ig.send('Page.reload');
  await sleep(7500);
  await activatePage();
  const left = await leaveBrowser();
  const blurMs = left.ms;
  check('mini player opens when another app comes to the front', blurMs >= 0, blurMs >= 0 ? `${blurMs} ms` : JSON.stringify(left.info));
  await sleep(1000);
  const awayTabs = await windowTabs();
  check('a placeholder tab stands in for Instagram', awayTabs.some((t) => t.startsWith('*ext/placeholder')), awayTabs.join(' | '));
  pip = await b.pipTarget(3000);
  check('video is rendering while away', pip && (await framesAdvance()) > 10);
  await focusBrowser();
  const returnMs = await waitPip(false, 5000);
  await sleep(1200);
  const homeTabs = await windowTabs();
  check('coming back closes the popup', returnMs >= 0, `${returnMs} ms`);
  check('Instagram is the active tab again and the placeholder is gone', homeTabs.some((t) => t.startsWith('*https://www.instagram.com')) && !homeTabs.some((t) => t.includes('placeholder')), homeTabs.join(' | '));
  check('video keeps playing in the tab', (await playingCount()) === 1);

  section('closing the popup while away');
  await sleep(1500);
  const again = (await leaveBrowser()).ms;
  await sleep(900);
  await ig.evalIsolated(`window.documentPictureInPicture.window?.close()`);
  await sleep(1400);
  check('closing the popup pauses the video', again >= 0 && (await playingCount()) === 0);
  const cameBack = await focusBrowser();
  await sleep(1800);
  const resumed = (await playingCount()) === 1 && (await windowTabs()).some((t) => t.startsWith('*https://www.instagram.com'));
  check('returning resumes it in the tab', resumed, resumed ? '' : `browser regained focus: ${cameBack}; ${await where()}`);

  section('nothing playing');
  await ig.eval(`document.querySelectorAll('video').forEach(v => v.pause())`);
  await sleep(2400);
  activateFinder();
  await sleep(4200);
  const stayedPut = !(await pipOpen()) && !(await windowTabs()).some((t) => t.includes('placeholder'));
  check('a paused video does not pop out', stayedPut, stayedPut ? '' : await where());
  await focusBrowser();

  // ---- 9. comments, logged in (simulated API) ----------------------------
  section('comments: logged in (simulated Instagram API responses)');
  await ig.send('Page.reload');
  await sleep(7500);
  await ig.eval(`document.cookie = 'ds_user_id=4242; path=/; domain=.instagram.com; secure'`);
  await ig.evalIsolated(`(${installApiMock.toString()})()`);
  await activatePage();
  await popOutByTabSwitch();
  const rows = () =>
    q(`return { title: d.querySelector('.igpip-drawer-title')?.textContent, rows: Array.from(d.querySelectorAll('.igpip-comment-item')).map(r => ({reply: r.classList.contains('reply'), author: r.querySelector('.igpip-comment-author')?.textContent, text: r.querySelector('.igpip-comment-text')?.textContent, likes: r.querySelector('.igpip-comment-like-count')?.textContent || '', liked: Boolean(r.querySelector('.igpip-comment-like-btn.liked')), links: Array.from(r.querySelectorAll('.igpip-comment-meta-btn')).map(x => x.textContent)})) };`);
  const calls = () => ig.evalIsolated(`window.__igMock.calls.splice(0).map(c => c.method + ' ' + c.url + (c.body ? ' ' + c.body : ''))`);
  await clickSel(`${RAIL}[title^="Comments"]`);
  await sleep(1600);
  let view = await rows();
  const firstCalls = await calls();
  const expectedId = await ig.evalIsolated(`window.__IGPipAdapter.shortcodeToMediaId(location.pathname.split('/')[2])`);
  check('comments load for the Reel on screen', view.rows.length === 12 && firstCalls[0]?.includes(`/api/v1/media/${expectedId}/comments/`), `${view.rows.length} rows, ${view.title}`);
  check('total count is shown', /1,631/.test(view.title || ''));
  await q(`const p = d.querySelector('.igpip-pane-body'); p.scrollTop = p.scrollHeight; p.dispatchEvent(new Event('scroll')); return 1;`);
  await sleep(1500);
  view = await rows();
  check('scrolling the list loads the next page', view.rows.length === 20 && (await calls()).some((c) => c.includes('min_id=')), `${view.rows.length} rows`);
  await q(`d.querySelector('.igpip-pane-body').scrollTop = 0; Array.from(d.querySelectorAll('.igpip-comment-meta-btn')).find(x => /view replies/i.test(x.textContent)).click(); return 1;`);
  await sleep(1300);
  view = await rows();
  check('replies expand under their comment', view.rows.slice(1, 4).every((r) => r.reply) && view.rows[0].links.includes('Hide replies'), view.rows.slice(0, 4).map((r) => (r.reply ? '↳' : '') + r.author).join(' '));
  await calls();
  const likePt = await q(`const row = Array.from(d.querySelectorAll('.igpip-comment-item')).find(r => r.querySelector('.igpip-comment-author')?.textContent === 'user_2'); row.scrollIntoView({block: 'center'}); const r = row.querySelector('.igpip-comment-like-btn').getBoundingClientRect(); return {x: r.left + r.width / 2, y: r.top + r.height / 2};`);
  await pip.click(likePt.x, likePt.y);
  await sleep(1000);
  const likeCalls = await calls();
  view = await rows();
  const likedRow = view.rows.find((r) => r.author === 'user_2');
  check('liking a comment updates it and tells Instagram', likeCalls.some((c) => c.startsWith('POST /api/v1/web/comments/like/18000000000000002/')) && likedRow?.liked && likedRow.likes === '15', `${likeCalls.join(' ')} likes=${likedRow?.likes}`);
  const typeComment = async (text) => {
    const pt = await q(`const el = d.querySelector('.igpip-drawer-footer input.igpip-text-input'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); return 1;`);
    if (!pt) return;
    await pip.send('Input.insertText', { text });
    await sleep(250);
  };
  await q(`Array.from(d.querySelectorAll('.igpip-comment-meta-btn')).find(x => x.textContent === 'Reply').click(); return 1;`);
  await sleep(300);
  await typeComment('nice one');
  await clickSel('.igpip-drawer-footer .igpip-primary-btn');
  await sleep(1300);
  const replyCalls = await calls();
  view = await rows();
  check('replying posts under the right comment', replyCalls.some((c) => c.includes('/add/') && c.includes('replied_to_comment_id=18000000000000001') && c.includes('comment_text=%40user_1+nice+one')) && view.rows.some((r) => r.reply && r.author === 'me_myself'), replyCalls.join(' '));
  await typeComment('top level hello');
  await pip.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await pip.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await sleep(1300);
  const postCalls = await calls();
  view = await rows();
  check('Enter posts a new comment at the top', postCalls.some((c) => c.includes('comment_text=top+level+hello') && !c.includes('replied_to')) && view.rows[0].author === 'me_myself' && /1,633/.test(view.title), view.title);
  check('video keeps playing behind the comments', (await source())?.paused === false);
  await clickSel('.igpip-drawer-actions button[title^="Close"]');
  await b.activate(ig.targetId);
  await waitPip(false);

  // ---- 10. comments, page fallback (live, logged out) --------------------
  section('comments: read from the page (live single-Reel page, logged out)');
  await ig.eval(`document.cookie = 'ds_user_id=; path=/; domain=.instagram.com; max-age=0; secure'`);
  const code = (await ig.eval('location.pathname')).split('/')[2];
  await ig.send('Page.navigate', { url: `https://www.instagram.com/reel/${code}/` });
  await sleep(8000);
  const closePt = await ig.eval(`(() => { const x = document.querySelector('[role="dialog"] svg[aria-label="Close"]'); const el = x?.closest('[role="button"],button') || x; if (!el) return null; const r = el.getBoundingClientRect(); return {x: r.left + r.width / 2, y: r.top + r.height / 2}; })()`);
  await focusBrowser();
  if (closePt) await ig.click(closePt.x, closePt.y);
  else await activatePage();
  await sleep(1200);
  // Logged out, the post page does not always autoplay: start the video like a user would.
  const pageVideo = await ig.eval(`(() => { const v = document.querySelector('video'); if (!v) return null; const r = v.getBoundingClientRect(); return {paused: v.paused, x: r.left + r.width / 2, y: r.top + r.height / 2}; })()`);
  if (pageVideo?.paused) await ig.click(pageVideo.x, pageVideo.y);
  for (let i = 0; i < 20 && !(await status()).autoPipReady; i++) await sleep(300);
  const pagePost = await ig.evalIsolated(`(() => { const a = window.__IGPipAdapter; const v = a.findActiveVideo(document); const s = a.extractPostState(a.findPostContainer(v), v, document); return {likes: s.likeCount, comments: s.commentCount, caption: s.caption.slice(0, 40), url: s.postUrl, pageComments: document.querySelectorAll('time').length}; })()`);
  check('post page: counts and a clean permalink are read', Boolean(pagePost.likes) && Boolean(pagePost.comments) && [`https://www.instagram.com/reel/${code}/`, `https://www.instagram.com/p/${code}/`].includes(pagePost.url), JSON.stringify(pagePost));
  if ((await status()).autoPipReady) {
    await popOutByTabSwitch();
    await clickSel(`${RAIL}[title^="Comments"]`);
    await sleep(2800);
    view = await rows();
    const expected = Math.max(0, pagePost.pageComments - 1);
    const incomplete = view.rows.filter((r) => !r.author || !r.text);
    check('comments shown on the page appear in the popup', view.rows.length >= Math.min(1, expected) && incomplete.length === 0, `${view.rows.length} comments (page shows ${pagePost.pageComments} timestamps)${incomplete.length ? ` incomplete: ${JSON.stringify(incomplete)}` : ''}`);
  } else {
    check('single-Reel page video is ready to pop out', false, 'video did not start');
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} of ${results.length} checks passed`);
  if (failed.length > 0) console.log(failed.map((f) => `  FAILED: ${f.name}${f.detail ? ` — ${f.detail}` : ''}`).join('\n'));
  exitCode = failed.length === 0 ? 0 : 1;
} catch (err) {
  console.log(`\nABORTED: ${err.stack || err}`);
  exitCode = 2;
} finally {
  await b.close();
}
process.exit(exitCode);

/** Runs in the content script's world: Instagram-shaped responses for the comments endpoints. */
function installApiMock() {
  const now = Math.floor(Date.now() / 1000);
  const user = (n) => ({ pk: String(1000 + n), username: `user_${n}`, is_verified: false, profile_pic_url: '' });
  const comment = (n, extra = {}) => ({
    pk: String(18000000000000000n + BigInt(n)),
    text: `Comment number ${n}`,
    created_at: now - n * 3700,
    user: user(n),
    comment_like_count: n * 7,
    has_liked_comment: false,
    child_comment_count: 0,
    preview_child_comments: [],
    ...extra,
  });
  const calls = [];
  window.__igMock = { calls };
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
  window.fetch = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, method: opts.method || 'GET', body: opts.body || null });
    await new Promise((r) => setTimeout(r, 150));
    if (/\/api\/v1\/media\/\d+\/comments\/\d+\/child_comments\//.test(u)) {
      return json({
        child_comments: [1, 2, 3].map((i) => comment(900 + i, { text: `Reply ${i}`, created_at: now - 4000 + i * 60 })),
        has_more_tail_child_comments: false,
        next_max_child_cursor: null,
        status: 'ok',
      });
    }
    if (/\/api\/v1\/media\/\d+\/comments\//.test(u)) {
      if (u.includes('min_id=')) {
        return json({ comments: Array.from({ length: 8 }, (_, i) => comment(13 + i)), comment_count: 1631, has_more_headload_comments: false, status: 'ok' });
      }
      const first = Array.from({ length: 12 }, (_, i) => comment(i + 1));
      first[0].child_comment_count = 3;
      first[0].preview_child_comments = [comment(903, { text: 'Reply 3', created_at: now - 4000 + 180 })];
      return json({ comments: first, comment_count: 1631, has_more_headload_comments: true, next_min_id: '{"cached_comments_cursor":"abc"}', status: 'ok' });
    }
    if (/\/api\/v1\/web\/comments\/(like|unlike)\/\d+\//.test(u)) return json({ status: 'ok' });
    if (/\/api\/v1\/web\/comments\/\d+\/add\//.test(u)) {
      const text = new URLSearchParams(opts.body).get('comment_text');
      return json({ id: `1809999999999${calls.length}`, from: { id: '4242', username: 'me_myself', profile_picture: '' }, text, created_time: now, status: 'ok' });
    }
    return json({ status: 'fail', message: `unexpected ${u}` }, 404);
  };
}
