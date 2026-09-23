import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { fileURLToPath } from 'node:url';

const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url));
const { outputFiles } = await build({
  stdin: {
    contents: 'export { createHostTransport } from "./hostTransport.ts";',
    resolveDir: sourceRoot,
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'BrowserTransportTest',
  platform: 'browser',
});

test('browser transport connects to the token-scoped event stream', () => {
  const dom = new JSDOM('<!doctype html>', { runScripts: 'outside-only', url: 'http://127.0.0.1:7823/office/secret-token/' });
  const opened = [];
  class FakeEventSource {
    constructor(url) {
      this.url = String(url);
      opened.push(this);
    }
  }
  dom.window.EventSource = FakeEventSource;
  dom.window.eval(outputFiles[0].text);
  const transport = dom.window.BrowserTransportTest.createHostTransport();
  const received = [];

  transport.subscribe((message) => received.push(message));
  opened[0].onmessage({ data: JSON.stringify({ type: 'serverPort', port: 7823 }) });

  assert.equal(transport.supportsCommands, false);
  assert.equal(opened[0].url, 'http://127.0.0.1:7823/office/secret-token/events');
  assert.equal(received.length, 1);
  assert.equal(received[0].type, 'serverPort');
  assert.equal(received[0].port, 7823);
  assert.doesNotThrow(() => transport.post({ type: 'webviewReady' }));
  dom.window.close();
});