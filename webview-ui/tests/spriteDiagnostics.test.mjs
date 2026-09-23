import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import packageJson from '../package.json' with { type: 'json' };

test('missing character sprite reports a fixed asset key while fallback stays available', async () => {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('../src/sprites.ts', import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'node',
  });
  const previousImage = globalThis.Image;
  const previousWindow = globalThis.window;
  const previousWarn = console.warn;
  const warnings = [];
  globalThis.window = {};
  console.warn = (message) => warnings.push(message);
  globalThis.Image = class {
    complete = true;
    naturalWidth = 112;
    set src(value) {
      if (value.endsWith('char_0.png')) {
        this.naturalWidth = 0;
        queueMicrotask(() => this.onerror?.());
      } else queueMicrotask(() => this.onload?.());
    }
  };
  try {
    const sprites = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
    await sprites.loadSprites();
    assert.equal(sprites.getAssetStatus().get('characters/char_0.png'), 'failed');
    assert.ok(warnings.some((message) => message.includes(`Asset characters/char_0.png failed (v${packageJson.version})`)));
    assert.equal(sprites.drawCharacterSprite({}, 0, 'down', 0, 0, 0), false);
  } finally {
    globalThis.Image = previousImage;
    globalThis.window = previousWindow;
    console.warn = previousWarn;
  }
});