import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Bundle in memory: test the actual TypeScript without generated test artifacts.
// drawSeatedCharacterSprite already has dedicated coverage in seating.test.mjs;
// this file covers the walking sprite, floor/furniture tiles and the loader itself.
const result = await build({
  stdin: {
    contents: 'export * from "./sprites.ts";',
    resolveDir: fileURLToPath(new URL('../src/', import.meta.url)),
    loader: 'ts',
  },
  bundle: true, write: false, format: 'esm', platform: 'node',
});
globalThis.window = {};
const images = [];
globalThis.Image = class {
  complete = true;
  naturalWidth = 112;
  naturalHeight = 96;
  constructor() { images.push(this); }
  set src(value) { queueMicrotask(() => this.onload?.()); }
};
const sprites = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);

function fixtureCtx() {
  const calls = [];
  const ctx = new Proxy({}, {
    get(target, key) {
      return key in target ? target[key] : (...args) => { calls.push([key, ...args]); };
    },
    set(target, key, value) { target[key] = value; return true; },
  });
  return { ctx, calls };
}

// This must run before any test calls loadSprites() — it asserts the module's
// behavior in its true initial state, with no sprite sheets registered yet.
test('before loadSprites resolves, drawing helpers report missing frames instead of throwing', () => {
  assert.equal(sprites.getSpritesLoaded(), false);
  const { ctx, calls } = fixtureCtx();
  assert.equal(sprites.drawCharacterSprite(ctx, 0, 'down', 0, 0, 0), false);
  assert.equal(sprites.drawFloorTile(ctx, 0, 0, 0), false);
  assert.equal(sprites.drawFurniture(ctx, 'desk_front', 0, 0), false);
  assert.equal(calls.length, 0, 'no drawImage calls when nothing is loaded');
});

test('loadSprites resolves once every character/floor/furniture image settles, memoized and reflected by getSpritesLoaded', async () => {
  const first = sprites.loadSprites();
  assert.equal(sprites.loadSprites(), first, 'repeated calls return the same in-flight/settled promise');
  await first;
  assert.equal(sprites.getSpritesLoaded(), true);
});

test('drawCharacterSprite picks the source row per direction, flips only when facing left, and reports success', () => {
  const cases = [['down', 0], ['up', 32], ['right', 64], ['left', 64]];
  for (const [dir, srcY] of cases) {
    const { ctx, calls } = fixtureCtx();
    const ok = sprites.drawCharacterSprite(ctx, 0, dir, 2, 10, 20, 1);
    assert.equal(ok, true);
    const draw = calls.find(([name]) => name === 'drawImage');
    assert.ok(draw, `drawImage called for direction ${dir}`);
    // args: [name, img, srcX, srcY, srcW, srcH, destX, destY, destW, destH]
    assert.equal(draw[3], srcY, 'row matches direction');
    assert.equal(draw[2], 2 * 16, 'column matches frame (frame % 7 * 16)');
    assert.deepEqual(draw.slice(4), [16, 32, dir === 'left' ? -(10 + 16) : 10, 20, 16, 32]);
    const hasFlip = calls.some(([name]) => name === 'scale');
    assert.equal(hasFlip, dir === 'left', 'only the left direction flips the canvas');
    assert.equal(
      calls.filter(([name]) => name === 'save').length,
      calls.filter(([name]) => name === 'restore').length,
      'save/restore stay balanced',
    );
  }
});

test('drawCharacterSprite cycles the frame column modulo the 7-frame sheet width', () => {
  const { ctx, calls } = fixtureCtx();
  sprites.drawCharacterSprite(ctx, 0, 'down', 9, 0, 0);
  const draw = calls.find(([name]) => name === 'drawImage');
  assert.equal(draw[2], (9 % 7) * 16);
});

test('drawFloorTile and drawFurniture draw at the requested scale and report missing tiles/keys', () => {
  const { ctx: ctxA, calls: callsA } = fixtureCtx();
  assert.equal(sprites.drawFloorTile(ctxA, 0, 5, 6, 16), true);
  assert.deepEqual(callsA.find(([n]) => n === 'drawImage').slice(2), [5, 6, 16, 16]);
  assert.equal(sprites.drawFloorTile(ctxA, 99, 0, 0), true, 'tile index wraps modulo the loaded floor count');

  const { ctx: ctxB, calls: callsB } = fixtureCtx();
  assert.equal(sprites.drawFurniture(ctxB, 'desk_front', 3, 4, 2), true);
  const draw = callsB.find(([n]) => n === 'drawImage');
  assert.deepEqual(draw.slice(2), [3, 4, 112 * 2, 96 * 2]);
  assert.equal(sprites.drawFurniture(ctxB, 'no-such-key', 0, 0), false, 'unknown furniture key reports missing');
});

test('getPcFrame returns the off sprite key when inactive and cycles 1..3 while active', () => {
  assert.equal(sprites.getPcFrame(0, false), 'pc_off');
  assert.equal(sprites.getPcFrame(5, false), 'pc_off');
  assert.equal(sprites.getPcFrame(0, true), 'pc_on_1');
  assert.equal(sprites.getPcFrame(1, true), 'pc_on_2');
  assert.equal(sprites.getPcFrame(2, true), 'pc_on_3');
  assert.equal(sprites.getPcFrame(3, true), 'pc_on_1', 'wraps modulo 3');
});

test('a broken/incomplete image reports missing rather than drawing a corrupt frame', async () => {
  await sprites.loadSprites();
  const previous = images.map((img) => [img.complete, img.naturalWidth]);
  images.forEach((img) => { img.complete = false; });
  try {
    const { ctx, calls } = fixtureCtx();
    assert.equal(sprites.drawCharacterSprite(ctx, 0, 'down', 0, 0, 0), false);
    assert.equal(calls.length, 0);
  } finally {
    images.forEach((img, i) => { [img.complete, img.naturalWidth] = previous[i]; });
  }
});
