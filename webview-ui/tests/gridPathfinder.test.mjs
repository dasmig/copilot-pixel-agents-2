import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const result = await build({
  stdin: {
    contents: 'export * from "./gridPathfinder.ts";',
    resolveDir: fileURLToPath(new URL('../src/', import.meta.url)), loader: 'ts',
  }, bundle: true, write: false, format: 'esm', platform: 'node',
});
const { findGridPath } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);

test('finds a deterministic four-connected route around a barrier', () => {
  const blocked = (col, row) => col === 2 && row < 4;
  const route = findGridPath(5, 5, { col: 0, row: 2 }, { col: 4, row: 2 }, blocked);
  assert.equal(route.kind, 'path');
  assert.deepEqual(route.points.at(-1), { col: 4, row: 2 });
  assert.equal(route.points.some(({ col, row }) => blocked(col, row)), false);
  assert.equal(route.points.every((point, index) => {
    const prior = index ? route.points[index - 1] : { col: 0, row: 2 };
    return Math.abs(point.col - prior.col) + Math.abs(point.row - prior.row) === 1;
  }), true);
});

test('rejects blocked and out-of-bounds destinations and distinguishes a same-cell route', () => {
  const blocked = (col, row) => col === 2;
  assert.deepEqual(findGridPath(4, 4, { col: 0, row: 1 }, { col: 3, row: 1 }, blocked), { kind: 'unreachable' });
  assert.deepEqual(findGridPath(4, 4, { col: 0, row: 1 }, { col: 2, row: 1 }, blocked), { kind: 'unreachable' });
  assert.deepEqual(findGridPath(4, 4, { col: 0, row: 1 }, { col: -1, row: 1 }, blocked), { kind: 'unreachable' });
  assert.deepEqual(findGridPath(4, 4, { col: 0, row: 1 }, { col: 0, row: 1 }, blocked), { kind: 'path', points: [] });
});