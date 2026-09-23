import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const result = await build({
  stdin: {
    contents: 'export * from "./interactionRegistry.ts";',
    resolveDir: fileURLToPath(new URL('../src/', import.meta.url)), loader: 'ts',
  },
  bundle: true, write: false, format: 'esm', platform: 'node',
});
const { InteractionRegistry } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);

test('reservations honor capacity, remain idempotent, and release by character', () => {
  const registry = new InteractionRegistry();
  const table = { type: 'table', capacity: 2, occupant: null };
  registry.replace([table]);

  assert.equal(registry.reserve('table', 'one'), true);
  assert.equal(registry.reserve('table', 'one'), true);
  assert.equal(registry.reserve('table', 'two'), true);
  assert.equal(registry.reserve('table', 'three'), false);
  assert.deepEqual(registry.occupants('table'), ['one', 'two']);
  registry.releaseCharacter('one');
  assert.deepEqual(registry.occupants('table'), ['two']);
  assert.equal(table.occupant, 'two');
});

test('rebuilding anchors retains eligible reservations and drops removed or invalid occupants', () => {
  const registry = new InteractionRegistry();
  registry.replace([
    { type: 'coffee', capacity: 1, occupant: null },
    { type: 'tv', capacity: 1, occupant: null },
  ]);
  registry.reserve('coffee', 'active');
  registry.reserve('tv', 'missing');

  const coffee = { type: 'coffee', capacity: 1, occupant: null };
  registry.replace([coffee], (characterId) => characterId === 'active');
  assert.deepEqual(registry.occupants('coffee'), ['active']);
  assert.deepEqual(registry.occupants('tv'), []);
  assert.equal(coffee.occupant, 'active');
});