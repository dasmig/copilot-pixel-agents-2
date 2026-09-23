import assert from 'node:assert/strict';
import test from 'node:test';
import { stat } from 'node:fs/promises';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const result = await build({
  entryPoints: [fileURLToPath(new URL('./src/sprites.ts', import.meta.url))],
  bundle: true, write: false, format: 'esm', platform: 'node',
});
globalThis.window = {};
const { ASSET_PATHS } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const packagedAssets = fileURLToPath(new URL('../dist/webview/assets/', import.meta.url));

test('production webview contains every registered sprite', async () => {
  const paths = [...ASSET_PATHS.characters, ...ASSET_PATHS.floors, ...ASSET_PATHS.furniture.map(([, path]) => path)];
  for (const path of paths) {
    const file = await stat(join(packagedAssets, path));
    assert.ok(file.isFile() && file.size > 0, `${path} is missing or empty in the packaged webview`);
  }
});