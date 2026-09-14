import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Bundle in memory: test the actual TypeScript without generated test artifacts.
// Only engine.ts's own public surface is exercised here — isometric/seating/sprites
// have their own dedicated fixtures (isometric.test.mjs, seating.test.mjs, sprites.test.mjs).
const result = await build({
  stdin: {
    contents: 'export * from "./engine.ts";',
    resolveDir: fileURLToPath(new URL('../src/', import.meta.url)),
    loader: 'ts',
  },
  bundle: true, write: false, format: 'esm', platform: 'node',
});
globalThis.window = {};
globalThis.Image = class {
  complete = false;
  naturalWidth = 0;
  set src(value) { queueMicrotask(() => this.onerror?.()); }
};
let nextTick;
globalThis.requestAnimationFrame = (fn) => { nextTick = fn; return 1; };
globalThis.cancelAnimationFrame = () => {};
const engine = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);

function fixture(count = 1) {
  const ctx = new Proxy({ measureText: (t) => ({ width: t.length * 5 }) }, {
    get(target, key) { return key in target ? target[key] : () => {}; },
  });
  const canvas = { width: 800, height: 600, getContext: () => ctx, addEventListener() {} };
  const office = engine.createOffice(canvas);
  for (let i = 0; i < count; i++) engine.addCharacter(office, `agent-${i}`, `Agent ${i}`);
  // Pinned high so the pet's own sit/stand timer never fires during a short test and
  // never consumes Math.random() calls that a test has scripted for character logic.
  office.pet.sitTimer = 1e9;
  engine.startLoop(office);
  let time = 0;
  function tick(dt = 100) { time += dt; nextTick(time); }
  return { office, tick };
}

// Scripts Math.random() to return exactly `values`, in order, for the duration of `fn`.
// Throws if `fn` asks for more values than scripted — a signal to script more, not a
// leak of unrelated randomness into the assertions below.
function withRandomQueue(values, fn) {
  const original = Math.random;
  let i = 0;
  Math.random = () => {
    if (i >= values.length) throw new Error(`random queue exhausted after ${i} calls`);
    return values[i++];
  };
  try { return fn(); } finally { Math.random = original; }
}

// Regression coverage for the sprite-stacking bug fixed in 0.4.11/0.4.12 (CHANGELOG):
// idle-wandering agents used to pick their next spot with no awareness of anyone else,
// so two agents could land on the exact same tile. The existing engine/seating fixtures
// pin Math.random() to 0.99 specifically to keep this rare (p=0.0003/tick) path from
// ever firing, so it had no dedicated coverage of its own.
test('idle-wandering agents avoid landing on top of each other, and stay put if every retry collides', () => {
  const { office, tick } = fixture(2);
  const a = office.characters.get('agent-0');
  const b = office.characters.get('agent-1');
  // Give b an active tool so its own idle behavior is skipped this tick, isolating
  // every scripted random() call below to agent a's wander logic.
  engine.onToolStart(office, b.id, 'tool', 'edit_file', 'writing');
  b.x = b.targetX = 16;
  b.y = b.targetY = 48;

  // [trigger, wx#1, wy#1, wx#2, wy#2]: the first candidate lands exactly on b (both
  // random() calls resolve to 0), forcing a retry; the second is far from b.
  withRandomQueue([0.0001, 0, 0, 0.99, 0.99], () => tick());
  assert.equal(a.activity, 'walking');
  assert.equal(a.targetX, 191);
  assert.equal(a.targetY, 223);
  assert.notEqual(a.targetX, b.x);
  assert.ok(Math.hypot(a.targetX - b.x, a.targetY - b.y) >= 20, 'picked point respects the minimum separation');

  // Reset and replay with every one of the 8 retries colliding with b: the character
  // must not settle for a colliding spot — it should stay exactly where it started.
  const { office: office2, tick: tick2 } = fixture(2);
  const a2 = office2.characters.get('agent-0');
  const b2 = office2.characters.get('agent-1');
  engine.onToolStart(office2, b2.id, 'tool', 'edit_file', 'writing');
  b2.x = b2.targetX = 16;
  b2.y = b2.targetY = 48;
  const start = { x: a2.targetX, y: a2.targetY };
  withRandomQueue([0.0001, ...Array(16).fill(0)], () => tick2());
  assert.equal(a2.activity, 'idle', 'no non-colliding spot found within the retry budget');
  assert.deepEqual({ x: a2.targetX, y: a2.targetY }, start);
});

test('idle timer expiry sends an agent to an available leisure spot, or resets the timer if none is free', () => {
  const { office, tick } = fixture(1);
  const c = office.characters.get('agent-0');
  c.idleTimer = -1;
  office.leisureSpots.find((s) => s.type === 'gaming').occupant = 'ghost-1';
  office.leisureSpots.find((s) => s.type === 'tv').occupant = 'ghost-2';
  const coffee = office.leisureSpots.find((s) => s.type === 'coffee');

  // [wander-no, leisure-chance-yes, pick-index, leisure-duration] — only 'coffee' is
  // free, so any index value picks it (there's exactly one candidate).
  withRandomQueue([0.5, 0.1, 0.9, 0.5], () => tick());
  assert.equal(c.idleGoal, 'coffee');
  assert.equal(coffee.occupant, c.id);
  assert.equal(c.activity, 'walking');
  assert.equal(c.targetX, coffee.standX);
  assert.equal(c.targetY, coffee.standY);
  assert.ok(c.leisureTimer >= 15000 && c.leisureTimer <= 35000);
});

test('idle timer expiry with every spot occupied leaves the agent at its desk and reschedules', () => {
  const { office, tick } = fixture(1);
  const c = office.characters.get('agent-0');
  c.idleTimer = -1;
  for (const spot of office.leisureSpots) spot.occupant = 'ghost';

  withRandomQueue([0.5, 0.1, 0.3], () => tick());
  assert.equal(c.idleGoal, null);
  assert.equal(c.activity, 'idle');
  assert.equal(c.idleTimer, 8000); // IDLE_WANDER_MS(10000) * (0.5 + 0.3)
});

test('the pet stops before stepping into furniture instead of clipping through it', () => {
  const { office, tick } = fixture(1);
  const gaming = office.leisureSpots.find((s) => s.type === 'gaming');
  // Matches furnitureZones() for a non-tv spot: x = itemX, w = 54 (no y/h offset needed here).
  const zoneLeft = gaming.itemX;
  office.pet.isSitting = false;
  office.pet.x = office.pet.targetX = zoneLeft - 30;
  office.pet.y = office.pet.targetY = gaming.itemY + 10;
  office.pet.targetX = zoneLeft + 40; // walk straight toward/through the zone
  office.pet.sitTimer = 1e9; // no unrelated sit/stand toggle mid-approach

  const original = Math.random;
  Math.random = () => 0.5; // deterministic re-roll if/when the avoidance branch fires
  try {
    let stopped = false;
    for (let i = 0; i < 30 && !stopped; i++) {
      tick(100);
      stopped = office.pet.isSitting;
    }
    assert.equal(stopped, true, 'pet stops instead of walking into the furniture footprint');
    assert.ok(office.pet.x + 12 <= zoneLeft, 'pet never actually entered the zone (pet width = 12px)');
  } finally { Math.random = original; }
});

test('onToolDone clears a finished tool, keeps others in flight, and only returns to idle once none remain', () => {
  const { office } = fixture(1);
  const c = office.characters.get('agent-0');
  engine.onToolStart(office, c.id, 't1', 'edit_file', 'writing');
  engine.onToolStart(office, c.id, 't2', 'run_command', 'running');
  assert.equal(c.activeTools.size, 2);

  engine.onToolDone(office, c.id, 't1');
  assert.equal(c.activeTools.size, 1);
  assert.equal(c.activeTools.has('t2'), true);
  assert.equal(c.activity, 'running', 'activity reflects the remaining in-flight tool');
  assert.equal(c.toolHistory.find((e) => e.toolId === 't1').outcome, 'completed');

  engine.onToolDone(office, c.id, 't2');
  assert.equal(c.activeTools.size, 0);
  assert.equal(c.activity, 'idle');
  assert.equal(c.toolHistory.find((e) => e.toolId === 't2').outcome, 'completed');
});

test('syncHistory replaces history with a deep-cloned, most-recent-first, 50-entry-capped snapshot', () => {
  const { office } = fixture(1);
  const c = office.characters.get('agent-0');
  const incoming = Array.from({ length: 3 }, (_, i) => ({
    entryId: `e${i}`, toolId: `t${i}`, toolName: 'x', status: 'writing', startedAt: i, outcome: 'completed',
  }));
  engine.syncHistory(office, c.id, incoming);
  assert.deepEqual(c.toolHistory.map((e) => e.entryId), ['e2', 'e1', 'e0']);

  incoming[0].toolName = 'mutated-after-sync';
  assert.notEqual(c.toolHistory[2].toolName, 'mutated-after-sync', 'synced entries are cloned, not aliased');

  const many = Array.from({ length: 60 }, (_, i) => ({
    entryId: `e${i}`, toolId: `t${i}`, toolName: 'x', status: 'writing', startedAt: i, outcome: 'completed',
  }));
  engine.syncHistory(office, c.id, many);
  assert.equal(c.toolHistory.length, 50);
  assert.equal(c.toolHistory[0].entryId, 'e59', 'cap keeps the most recent entries');
});

test('removeCharacter frees any leisure spot it was occupying', () => {
  const { office } = fixture(1);
  const c = office.characters.get('agent-0');
  const spot = office.leisureSpots.find((s) => s.type === 'tv');
  spot.occupant = c.id;

  engine.removeCharacter(office, c.id);
  assert.equal(office.characters.has(c.id), false);
  assert.equal(office.leisureSpots.find((s) => s.type === 'tv').occupant, null);
});
