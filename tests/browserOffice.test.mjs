import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer, get } from 'node:http';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);

function load(file) {
  const { outputFiles } = buildSync({
    entryPoints: [join(root, 'src', file)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', outputFiles[0].text)(require, module, module.exports);
  return module.exports;
}

const { AgentStore } = load('agentStore.ts');
const { BrowserOfficeHost } = load('browserOffice.ts');

async function fixture(t) {
  const webRoot = await mkdtemp(join(tmpdir(), 'pixel-browser-'));
  await mkdir(join(webRoot, 'assets'));
  await writeFile(join(webRoot, 'main.js'), 'console.log("office");');
  await writeFile(join(webRoot, 'main.css'), 'body { color: white; }');
  await writeFile(join(webRoot, 'assets', 'sprite.png'), 'sprite');

  const store = new AgentStore();
  let port = 0;
  const office = new BrowserOfficeHost(store, webRoot, () => port, 'test-token');
  const server = createServer((request, response) => {
    if (!office.handle(request, response)) {
      response.writeHead(405, { 'Content-Type': 'application/json' });
      response.end('{}');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;

  t.after(async () => {
    office.dispose();
    store.dispose();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(webRoot, { recursive: true, force: true });
  });
  return { office, port, store };
}

function request(port, path) {
  return new Promise((resolve, reject) => {
    get({ hostname: '127.0.0.1', port, path }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    }).on('error', reject);
  });
}

function receiveEvents(port, path, count, onOpen) {
  return new Promise((resolve, reject) => {
    const messages = [];
    const request = get({ hostname: '127.0.0.1', port, path }, (response) => {
      onOpen();
      let pending = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        pending += chunk;
        const records = pending.split('\n\n');
        pending = records.pop();
        for (const record of records) {
          const data = record.split('\n').find((line) => line.startsWith('data: '));
          if (data) messages.push(JSON.parse(data.slice(6)));
        }
        if (messages.length >= count) {
          request.destroy();
          resolve(messages);
        }
      });
    });
    request.on('error', (error) => {
      if (messages.length < count) reject(error);
    });
  });
}

test('browser office serves only token-protected UI assets', async (t) => {
  const { office, port } = await fixture(t);

  const missingToken = await request(port, '/office/wrong/main.js');
  const page = await request(port, '/office/test-token/');
  const script = await request(port, '/office/test-token/main.js');

  assert.equal(missingToken.status, 405);
  assert.equal(page.status, 200);
  assert.match(page.headers['content-security-policy'], /default-src 'self'/);
  assert.match(page.body, /<div id="app"><\/div>/);
  assert.match(page.body, /src="main\.js"/);
  assert.equal(script.status, 200);
  assert.match(script.headers['content-type'], /javascript/);
  assert.equal(office.url, `http://127.0.0.1:${port}/office/test-token/`);
});

test('browser office streams snapshots followed by live agent updates', async (t) => {
  const { port, store } = await fixture(t);
  store.processEvent({ event: 'session_start', session_id: 'existing', agent_name: 'Existing Agent' });
  const messages = await receiveEvents(port, '/office/test-token/events', 4, () => {
    store.processEvent({ event: 'session_start', session_id: 'live', agent_name: 'Live Agent' });
  });

  assert.deepEqual(messages[0], { type: 'captureSettings', enabled: false });
  assert.equal(messages[1].type, 'existingAgents');
  assert.equal(messages[1].agents[0].name, 'Existing Agent');
  assert.deepEqual(messages[2], { type: 'serverPort', port });
  assert.deepEqual(messages[3], { type: 'agentCreated', id: 'live', name: 'Live Agent' });
});