// Dev-only: keeps one Chrome (with the extension) alive and runs posted JS snippets against it.
//   node test/lab-server.mjs            -> listens on 127.0.0.1:9477
//   curl -s --data-binary @snippet.js http://127.0.0.1:9477/run
import http from 'node:http';
import * as h from './lib/harness.mjs';

const b = await h.launch();
const state = {};
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

const server = http.createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  if (req.url === '/quit') {
    res.end('bye\n');
    await b.close();
    process.exit(0);
  }
  const logs = [];
  const log = (...a) => logs.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x, null, 1))).join(' '));
  try {
    const fn = new AsyncFunction('b', 'h', 'sleep', 'state', 'log', body);
    const timeout = new Promise((_, j) => setTimeout(() => j(new Error('snippet timeout (100s)')), 100000));
    const result = await Promise.race([fn(b, h, h.sleep, state, log), timeout]);
    if (result !== undefined) log(result);
  } catch (e) {
    log('ERROR', String(e.stack || e).split('\n').slice(0, 4).join('\n'));
  }
  res.end(logs.join('\n') + '\n');
});
server.listen(9477, '127.0.0.1', () => console.log('lab ready', b.extensionId));
process.on('SIGTERM', async () => {
  await b.close();
  process.exit(0);
});
