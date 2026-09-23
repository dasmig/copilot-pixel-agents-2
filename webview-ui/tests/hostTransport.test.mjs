import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/hostTransport.ts', import.meta.url))],
  bundle: true, write: false, format: 'esm', platform: 'node',
});
const { createHostTransport } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

test('browser connection remains stale until an authoritative snapshot arrives', () => {
  const previousWindow = globalThis.window;
  const previousEventSource = globalThis.EventSource;
  const states = [];
  let stream;
  globalThis.window = { location: { href: 'http://127.0.0.1:3000/' } };
  globalThis.EventSource = class { constructor() { stream = this; } };
  try {
    const transport = createHostTransport();
    transport.subscribe(() => {}, (state) => states.push(state));
    stream.onopen();
    stream.onerror();
    stream.onopen();
    assert.notEqual(states.at(-1), 'connected');
    stream.onmessage({ data: JSON.stringify({ type: 'existingAgents', agents: [] }) });
    assert.equal(states.at(-1), 'connected');
  } finally {
    globalThis.window = previousWindow;
    globalThis.EventSource = previousEventSource;
  }
});

test('browser reports disconnection after the configured timeout and recovers on snapshot', async () => {
  const previousWindow = globalThis.window;
  const previousEventSource = globalThis.EventSource;
  let stream;
  const states = [];
  globalThis.window = { location: { href: 'http://127.0.0.1:3000/' } };
  globalThis.EventSource = class { constructor() { stream = this; } };
  try {
    createHostTransport({ disconnectTimeoutMs: 5 }).subscribe(() => {}, (state) => states.push(state));
    stream.onerror();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(states.at(-1), 'disconnected');
    stream.onopen();
    assert.equal(states.at(-1), 'reconnecting');
    stream.onmessage({ data: JSON.stringify({ type: 'existingAgents', agents: [] }) });
    assert.equal(states.at(-1), 'connected');
  } finally {
    globalThis.window = previousWindow;
    globalThis.EventSource = previousEventSource;
  }
});

test('VS Code transport does not emit browser connection states', () => {
  const previousWindow = globalThis.window;
  const states = [];
  globalThis.window = { acquireVsCodeApi: () => ({ postMessage() {} }), addEventListener() {} };
  try {
    const transport = createHostTransport();
    transport.subscribe(() => {}, (state) => states.push(state));
    assert.equal(transport.supportsCommands, true);
    assert.deepEqual(states, []);
  } finally {
    globalThis.window = previousWindow;
  }
});

test('repeated SSE errors cannot postpone disconnected feedback', async () => {
  const previousWindow = globalThis.window;
  const previousEventSource = globalThis.EventSource;
  let stream;
  const states = [];
  globalThis.window = { location: { href: 'http://127.0.0.1:3000/' } };
  globalThis.EventSource = class { constructor() { stream = this; } };
  try {
    createHostTransport({ disconnectTimeoutMs: 20 }).subscribe(() => {}, (state) => states.push(state));
    for (let attempt = 0; attempt < 5; attempt++) {
      stream.onerror();
      await new Promise((resolve) => setTimeout(resolve, 8));
    }
    assert.equal(states.at(-1), 'disconnected');
  } finally {
    globalThis.window = previousWindow;
    globalThis.EventSource = previousEventSource;
  }
});