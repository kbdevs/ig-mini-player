/**
 * Test harness: launches a real headed Chrome with the unpacked extension loaded
 * and gives CDP access to every target (pages, the service worker, the PiP window).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const EXT_DIR = path.resolve(__dirname, '..', '..');

const CANDIDATES = [
  process.env.IGPIP_CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].filter(Boolean);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ allowAutoPip = true, extraArgs = [] } = {}) {
  const bin = CANDIDATES.find((p) => fs.existsSync(p));
  if (!bin) throw new Error('No Chrome for Testing / Chromium binary found (set IGPIP_CHROME).');

  const userDataDir = fs.mkdtempSync('/tmp/igpip-e2e-');
  fs.mkdirSync(path.join(userDataDir, 'Default'), { recursive: true });
  const exceptions = allowAutoPip
    ? { auto_picture_in_picture: { 'https://www.instagram.com:443,*': { setting: 1 } } }
    : {};
  fs.writeFileSync(
    path.join(userDataDir, 'Default', 'Preferences'),
    JSON.stringify({ profile: { content_settings: { exceptions } } })
  );

  // Branded Chrome ignores --load-extension, so the extension is installed over the DevTools
  // pipe with Extensions.loadUnpacked (needs --enable-unsafe-extension-debugging).
  const proc = spawn(
    bin,
    [
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-pipe',
      '--enable-unsafe-extension-debugging',
      `--user-data-dir=${userDataDir}`,
      ...extraArgs,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] }
  );
  proc.stderr.on('data', () => {});
  const pipeOut = proc.stdio[3];
  const pipeIn = proc.stdio[4];
  const messageHandlers = new Set();
  let buf = Buffer.alloc(0);
  pipeIn.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    let idx;
    while ((idx = buf.indexOf(0)) !== -1) {
      const raw = buf.subarray(0, idx).toString('utf8');
      buf = buf.subarray(idx + 1);
      for (const h of messageHandlers) h(raw);
    }
  });
  const ws = {
    send: (text) => pipeOut.write(`${text}\0`),
    addEventListener: (_type, fn) => messageHandlers.add((raw) => fn({ data: raw })),
    close: () => {},
  };

  let seq = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) reject(new Error(`${m.error.message} ${m.error.data || ''}`));
      else resolve(m.result);
      return;
    }
    for (const l of listeners) l(m);
  });

  const send = (method, params = {}, sessionId, timeoutMs = 20000) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, timeoutMs);
      pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      if (process.env.IGPIP_TRACE) console.error('>', method, sessionId ? sessionId.slice(0, 6) : '');
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });

  let extensionId = null;
  const sessions = new Map();
  /** Attach (once) to a target and return a session bound helper. */
  async function attach(targetId) {
    if (sessions.has(targetId)) return sessions.get(targetId);
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const contexts = [];
    const onMsg = (m) => {
      if (m.sessionId !== sessionId) return;
      if (m.method === 'Runtime.executionContextCreated') contexts.push(m.params.context);
      if (m.method === 'Runtime.executionContextsCleared') contexts.length = 0;
      if (m.method === 'Runtime.executionContextDestroyed') {
        const i = contexts.findIndex((c) => c.id === m.params.executionContextId);
        if (i >= 0) contexts.splice(i, 1);
      }
    };
    listeners.add(onMsg);
    const s = {
      targetId,
      sessionId,
      contexts,
      send: (method, params) => send(method, params, sessionId),
      /** Evaluate in the page's main world. */
      async eval(expression, { awaitPromise = true, userGesture = false, contextId } = {}) {
        const res = await send(
          'Runtime.evaluate',
          { expression, awaitPromise, returnByValue: true, userGesture, ...(contextId ? { contextId } : {}) },
          sessionId
        );
        if (res.exceptionDetails) {
          throw new Error(
            `eval failed: ${res.exceptionDetails.exception?.description || res.exceptionDetails.text}`
          );
        }
        return res.result?.value;
      },
      /** Evaluate inside the extension's isolated content-script world. */
      async evalIsolated(expression, opts = {}) {
        const deadline = Date.now() + 8000;
        while (Date.now() < deadline) {
          const ctx = contexts
            .filter((c) => c.auxData?.type === 'isolated' && (!extensionId || (c.origin || '').includes(extensionId)))
            .pop();
          if (ctx) return s.eval(expression, { ...opts, contextId: ctx.id });
          await sleep(150);
        }
        throw new Error('No isolated (content-script) world found');
      },
      async click(x, y, { count = 1 } = {}) {
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, sessionId);
        await send(
          'Input.dispatchMouseEvent',
          { type: 'mousePressed', x, y, button: 'left', clickCount: count },
          sessionId
        );
        await send(
          'Input.dispatchMouseEvent',
          { type: 'mouseReleased', x, y, button: 'left', clickCount: count },
          sessionId
        );
      },
      async wheel(x, y, deltaY) {
        await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY }, sessionId);
      },
      async screenshot(file) {
        const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
        fs.writeFileSync(file, Buffer.from(data, 'base64'));
        return file;
      },
    };
    await s.send('Runtime.enable');
    await s.send('Page.enable').catch(() => {});
    sessions.set(targetId, s);
    return s;
  }

  async function targets() {
    const { targetInfos } = await send('Target.getTargets');
    return targetInfos;
  }

  async function waitForTarget(pred, timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const t = (await targets()).find(pred);
      if (t) return t;
      await sleep(150);
    }
    return null;
  }

  async function newTab(url = 'about:blank', { background = false } = {}) {
    const { targetId } = await send('Target.createTarget', { url, background });
    return attach(targetId);
  }

  const activate = (targetId) => send('Target.activateTarget', { targetId });

  async function serviceWorker() {
    const t = await waitForTarget(
      (x) => x.type === 'service_worker' && x.url.startsWith(`chrome-extension://${extensionId}/`)
    );
    if (!t) throw new Error('Extension service worker not found');
    return attach(t.targetId);
  }

  /** The Document PiP window opened by the Instagram tab (it is its own page target). */
  async function pipTarget(timeoutMs = 6000) {
    const t = await waitForTarget(
      (x) => x.type === 'page' && x.url === 'about:blank' && Boolean(x.openerId || x.openerFrameId) ,
      timeoutMs
    );
    return t ? attach(t.targetId) : null;
  }

  async function close() {
    try {
      ws.close();
    } catch {
      // Ignore
    }
    proc.kill('SIGTERM');
    await new Promise((r) => {
      const t = setTimeout(() => {
        proc.kill('SIGKILL');
        r();
      }, 4000);
      proc.once('exit', () => {
        clearTimeout(t);
        r();
      });
    });
    fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3 });
  }

  if (!process.env.IGPIP_NOEXT) {
    ({ id: extensionId } = await send('Extensions.loadUnpacked', { path: EXT_DIR }));
  }

  return { extensionId, proc, bin, send, attach, targets, waitForTarget, newTab, activate, serviceWorker, pipTarget, close, userDataDir };
}

/** Make another macOS app frontmost (so the browser is no longer the focused app). */
export function activateFinder() {
  execFileSync('osascript', ['-e', 'tell application "Finder" to activate']);
}

export function frontAppBundle() {
  try {
    return execFileSync('osascript', ['-e', 'path to frontmost application as text']).toString().trim();
  } catch (e) {
    return `ERR ${String(e.message).split('\n')[1] || ''}`;
  }
}
