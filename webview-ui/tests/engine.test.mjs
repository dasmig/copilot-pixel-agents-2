import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Bundle in memory: test the actual TypeScript without generated test artifacts.
// Only engine.ts's own public surface is exercised here — isometric/seating/sprites
// have their own dedicated fixtures (isometric.test.mjs, seating.test.mjs, sprites.test.mjs).
const result = await build({
  stdin: {
    contents: 'export * from "./engine.ts"; export { reduceCharacter } from "./characterController.ts";',
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

test('file search reserves the bookshelf and heads toward it', () => {
  const { office } = fixture();
  const character = office.characters.get('agent-0');

  engine.onToolStart(office, character.id, 'search-1', 'file_search', 'searching');

  assert.equal(character.navigationIntent, 'shelf');
  assert.equal(office.interactions.has('shelf-search', character.id), true);
  assert.equal(character.activity, 'walking');
});

test('file lookup tools use the shelf while web search and edits stay at the desk', () => {
  for (const name of ['file_search', 'grep_search', 'find_files', 'glob', 'list_dir', 'semantic_search']) {
    const { office } = fixture();
    engine.onToolStart(office, 'agent-0', 'tool', name, 'searching');
    assert.equal(office.characters.get('agent-0').navigationIntent, 'shelf', name);
  }
  for (const name of ['web_search', 'browser_search', 'github_search', 'edit_file', 'read_file']) {
    const { office } = fixture();
    engine.onToolStart(office, 'agent-0', 'tool', name, 'searching');
    assert.equal(office.characters.get('agent-0').navigationIntent, 'desk', name);
  }
});

test('file search reaches the shelf, faces it, and starts its search sequence', () => {
  const { office, tick } = fixture();
  const character = office.characters.get('agent-0');
  engine.onToolStart(office, character.id, 'tool', 'file_search', 'searching');

  for (let step = 0; step < 100 && character.activity === 'walking'; step++) tick();

  assert.equal(character.activity, 'searching');
  assert.deepEqual({ x: character.x, y: character.y },
    { x: office.shelfSpot.standX, y: office.shelfSpot.standY });
  assert.equal(character.pose, 'stand');
  assert.equal(character.direction, 'up');
  assert.equal(typeof character.shelfStartedAt, 'number');
});

test('reading a retrieved file at the shelf remains standing and reserves the shelf', () => {
  const { office, tick } = fixture();
  const character = office.characters.get('agent-0');
  engine.onToolStart(office, character.id, 'search', 'file_search', 'searching');
  for (let step = 0; step < 100 && character.activity === 'walking'; step++) tick();
  assert.equal(character.navigationIntent, 'shelf');
  engine.onToolDone(office, character.id, 'search');

  engine.onToolStart(office, character.id, 'read', 'read_file', 'reading');

  assert.equal(character.activity, 'reading');
  assert.equal(character.pose, 'stand');
  assert.equal(character.navigationIntent, 'shelf');
  assert.equal(office.interactions.has('shelf-search', character.id), true);
});

test('stopping a shelf reader releases the shelf and returns to desk', () => {
  const { office, tick } = fixture();
  const reader = office.characters.get('agent-0');
  engine.onToolStart(office, reader.id, 'search', 'file_search', 'searching');
  for (let step = 0; step < 100 && reader.activity === 'walking'; step++) tick();
  engine.onToolDone(office, reader.id, 'search');
  engine.onToolStart(office, reader.id, 'read', 'read_file', 'reading');

  engine.setIdle(office, reader.id);

  assert.equal(reader.workActivity, 'idle');
  assert.equal(reader.targetX, reader.deskX);
  assert.equal(reader.targetY, reader.deskY + 16);
  assert.equal(office.interactions.has('shelf-search', reader.id), false);
});

test('busy shelf sends another search to its desk until the first agent releases it', () => {
  const { office } = fixture(2);
  engine.onToolStart(office, 'agent-0', 'first', 'file_search', 'searching');
  engine.onToolStart(office, 'agent-1', 'second', 'file_search', 'searching');

  assert.equal(office.characters.get('agent-1').navigationIntent, 'desk');
  engine.onToolDone(office, 'agent-0', 'first');
  engine.onToolStart(office, 'agent-1', 'third', 'grep_search', 'searching');
  assert.equal(office.characters.get('agent-1').navigationIntent, 'shelf');
});

test('a completed file search cancels shelf travel and frees its position', () => {
  const { office, tick } = fixture();
  const character = office.characters.get('agent-0');
  for (let step = 0; step < 4; step++) tick();
  assert.equal(character.sitProgress, 1);
  engine.onToolStart(office, character.id, 'tool', 'file_search', 'searching');

  engine.onToolDone(office, character.id, 'tool');

  assert.equal(office.interactions.has('shelf-search', character.id), false);
  assert.equal(character.navigationIntent, 'desk');
  assert.equal(character.targetX, character.deskX);
  assert.equal(character.shelfStartedAt, undefined);
});

test('list_dir searches at the shelf even when the tool reports reading', () => {
  const { office } = fixture();
  engine.onToolStart(office, 'agent-0', 'tool', 'list_dir', 'reading');

  assert.equal(office.characters.get('agent-0').workActivity, 'searching');
});

test('restoring an active file search does not replay the walk to the shelf', () => {
  const { office } = fixture();
  engine.restoreCharacterSnapshot(office, 'agent-0',
    [['tool', { name: 'file_search', status: 'searching' }]], false);

  assert.equal(office.characters.get('agent-0').navigationIntent, 'desk');
  assert.equal(office.interactions.has('shelf-search', 'agent-0'), false);
});

test('waiting at the shelf cancels the search and returns to the desk', () => {
  const { office, tick } = fixture();
  const character = office.characters.get('agent-0');
  engine.onToolStart(office, character.id, 'tool', 'file_search', 'searching');
  for (let step = 0; step < 100 && character.activity === 'walking'; step++) tick();

  engine.setWaiting(office, character.id);

  assert.equal(character.navigationIntent, 'desk');
  assert.equal(character.activity, 'walking');
  assert.equal(office.interactions.has('shelf-search', character.id), false);
});

test('growing the office does not move a searching agent away from the shelf', () => {
  const { office, tick } = fixture();
  const character = office.characters.get('agent-0');
  engine.onToolStart(office, character.id, 'tool', 'file_search', 'searching');
  for (let step = 0; step < 100 && character.activity === 'walking'; step++) tick();

  engine.addCharacter(office, 'new-agent', 'New agent');

  assert.equal(character.navigationIntent, 'shelf');
  assert.equal(character.x, office.shelfSpot.standX);
  assert.equal(office.interactions.has('shelf-search', character.id), true);
});

test('an unreachable shelf route releases its slot and searches at the desk', () => {
  const { office, tick } = fixture();
  const character = office.characters.get('agent-0');
  engine.onToolStart(office, character.id, 'tool', 'file_search', 'searching');
  for (let step = 0; step < 8; step++) tick();
  assert.ok(Math.hypot(character.x - character.deskX, character.y - character.deskY - 16) > 1);

  engine.reduceCharacter(office, character, {
    type: 'route-unreachable', generation: character.movementGeneration,
  });

  assert.equal(character.navigationIntent, 'desk');
  assert.equal(character.targetX, character.deskX);
  assert.equal(character.targetY, character.deskY + 16);
  assert.equal(office.interactions.has('shelf-search', character.id), false);
});

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

test('coffee arrival holds the standing frame instead of cycling walking frames', () => {
  const { office, tick } = fixture();
  const character = office.characters.get('agent-0');
  const coffee = office.leisureSpots.find((spot) => spot.type === 'coffee');
  character.x = character.targetX = coffee.standX;
  character.y = character.targetY = coffee.standY;
  character.idleGoal = 'coffee';
  character.leisureTimer = 10_000;
  character.activity = 'walking';
  coffee.occupant = character.id;

  tick();
  assert.equal(character.activity, 'coffee_break');
  for (let step = 0; step < 4; step++) tick();
  assert.equal(character.frame, 0);
});

test('a long frame gap expires leisure and bubbles without teleporting movement', () => {
  const { office, tick } = fixture();
  const character = office.characters.get('agent-0');
  const coffee = office.leisureSpots.find((spot) => spot.type === 'coffee');
  character.x = character.targetX = coffee.standX;
  character.y = character.targetY = coffee.standY;
  engine.reduceCharacter(office, character, { type: 'leisure-started', spot: coffee, durationMs: 1000 });
  engine.onToolStart(office, character.id, 'tool', 'run_command', 'running');
  const start = { x: character.x, y: character.y };

  tick(60_000);

  assert.ok(office.elapsedTime >= 60_000);
  assert.equal(character.speechBubble, undefined);
  assert.ok(Math.hypot(character.x - start.x, character.y - start.y) <= 5.5);
});

test('leisure expires on the first frame after a hidden-tab gap', () => {
  const { office, tick } = fixture();
  const character = office.characters.get('agent-0');
  const coffee = office.leisureSpots.find((spot) => spot.type === 'coffee');
  character.x = character.targetX = coffee.standX;
  character.y = character.targetY = coffee.standY;
  engine.reduceCharacter(office, character, { type: 'leisure-started', spot: coffee, durationMs: 1000 });
  tick();
  assert.equal(character.activity, 'coffee_break');

  tick(60_000);

  assert.equal(character.idleGoal, 'desk');
  assert.equal(character.speechBubble, undefined);
});

test('leisure started at its destination also expires after an immediate hidden-tab gap', () => {
  const { office, tick } = fixture();
  const character = office.characters.get('agent-0');
  const coffee = office.leisureSpots.find((spot) => spot.type === 'coffee');
  character.x = character.targetX = coffee.standX;
  character.y = character.targetY = coffee.standY;
  engine.reduceCharacter(office, character, { type: 'leisure-started', spot: coffee, durationMs: 1000 });

  tick(60_000);

  assert.equal(character.idleGoal, 'desk');
});

test('work interrupts coffee and an early completion arrives idle without a coffee bubble', () => {
  const { office, tick } = fixture();
  const character = office.characters.get('agent-0');
  const coffee = office.leisureSpots.find((spot) => spot.type === 'coffee');
  character.x = character.targetX = coffee.standX;
  character.y = character.targetY = coffee.standY;
  character.idleGoal = 'coffee';
  character.activity = 'walking';
  character.leisureTimer = 10_000;
  coffee.occupant = character.id;
  tick();

  engine.onToolStart(office, character.id, 'tool', 'run_command', 'running');
  assert.equal(character.activity, 'walking');
  assert.equal(coffee.occupant, null);
  engine.onToolDone(office, character.id, 'tool');
  assert.equal(character.activity, 'walking');
  for (let step = 0; step < 100 && character.activity === 'walking'; step++) tick();

  assert.equal(character.activity, 'idle');
  assert.equal(character.x, character.deskX);
  assert.equal(character.y, character.deskY + 16);
  assert.equal(character.speechBubble, undefined);
});

test('a replacement tool controls arrival after the first tool finishes en route', () => {
  const { office, tick } = fixture();
  const character = office.characters.get('agent-0');
  character.x += 40;
  character.targetX = character.x;

  engine.onToolStart(office, character.id, 'first', 'edit_file', 'writing');
  tick();
  engine.onToolStart(office, character.id, 'second', 'run_command', 'running');
  engine.onToolDone(office, character.id, 'first');
  for (let step = 0; step < 100 && character.activity === 'walking'; step++) tick();

  assert.equal(character.activity, 'running');
  assert.equal(character.activeTools.size, 1);
  assert.equal(character.activeTools.has('second'), true);
});

test('waiting during a return walk reaches the desk without restoring the old activity', () => {
  const { office, tick } = fixture();
  const character = office.characters.get('agent-0');
  character.x += 40;

  engine.onToolStart(office, character.id, 'first', 'edit_file', 'writing');
  tick();
  engine.setWaiting(office, character.id);
  for (let step = 0; step < 100 && character.activity === 'walking'; step++) tick();

  assert.equal(character.activity, 'waiting');
  assert.equal(character.x, character.deskX);
  assert.equal(character.activeTools.size, 0);
});

test('waiting while heading to coffee reroutes to the desk and releases the spot', () => {
  const { office, tick } = fixture();
  const character = office.characters.get('agent-0');
  const coffee = office.leisureSpots.find((spot) => spot.type === 'coffee');
  character.idleTimer = -1;
  withRandomQueue([0.5, 0.1, 0.9, 0.5], () => tick());
  tick();

  engine.setWaiting(office, character.id);
  assert.equal(coffee.occupant, null);
  assert.equal(character.targetX, character.deskX);
  assert.equal(character.targetY, character.deskY + 16);
  for (let step = 0; step < 100 && character.activity === 'walking'; step++) tick();
  assert.equal(character.activity, 'waiting');
  assert.equal(character.speechBubble?.text, '?');
});

test('a late tool completion cannot erase waiting or its question bubble', () => {
  const { office } = fixture();
  const character = office.characters.get('agent-0');
  engine.onToolStart(office, character.id, 'old', 'run_command', 'running');
  engine.setWaiting(office, character.id);

  engine.onToolDone(office, character.id, 'old');
  assert.equal(character.activity, 'waiting');
  assert.equal(character.workActivity, 'waiting');
  assert.equal(character.speechBubble?.text, '?');
});

test('a tool bubble expires on simulation time without erasing a newer tool bubble', () => {
  const { office, tick } = fixture();
  const character = office.characters.get('agent-0');
  engine.onToolStart(office, character.id, 'older', 'read_file', 'reading');
  engine.onToolStart(office, character.id, 'newer', 'run_command', 'running');
  engine.onToolDone(office, character.id, 'older');
  assert.equal(character.speechBubble?.owner, 'tool:newer');

  for (let step = 0; step < 34; step++) tick();
  assert.equal(character.speechBubble?.owner, 'tool:newer');
  tick();
  assert.equal(character.speechBubble, undefined);
  assert.equal(character.activeTools.has('newer'), true);
});

test('standing away from a seat has a standing pose even while idle or waiting', () => {
  const { office, tick } = fixture();
  const character = office.characters.get('agent-0');
  engine.reduceCharacter(office, character, {
    type: 'wander-started', x: character.deskX + 20, y: character.deskY + 16,
  });
  for (let step = 0; step < 100 && character.activity === 'walking'; step++) tick();
  assert.equal(character.pose, 'stand');

  engine.setWaiting(office, character.id);
  assert.equal(character.pose, 'stand');
});

test('command execution remains seated without advancing locomotion frames', () => {
  const { office, tick } = fixture();
  const character = office.characters.get('agent-0');
  engine.onToolStart(office, character.id, 'run', 'run_command', 'running');
  for (let step = 0; step < 5; step++) tick();

  assert.equal(character.workActivity, 'executing');
  assert.equal(character.motion, 'stationary');
  assert.equal(character.pose, 'sit-desk');
  assert.equal(character.activity, 'running');
  assert.equal(character.frame, 0);
});

test('stop during the walk to leisure cancels its destination and reservation', () => {
  const { office, tick } = fixture();
  const character = office.characters.get('agent-0');
  const coffee = office.leisureSpots.find((spot) => spot.type === 'coffee');
  character.idleTimer = -1;
  withRandomQueue([0.5, 0.1, 0.9, 0.5], () => tick());

  engine.setIdle(office, character.id);
  assert.equal(coffee.occupant, null);
  assert.equal(character.targetX, character.deskX);
  assert.equal(character.targetY, character.deskY + 16);
});

test('a stale arrival generation cannot restore coffee after work interrupts it', () => {
  const { office, tick } = fixture();
  const character = office.characters.get('agent-0');
  character.idleTimer = -1;
  withRandomQueue([0.5, 0.1, 0, 0.5], () => tick());
  const staleGeneration = character.intentGeneration;
  for (let step = 0; step < 5 && character.x === character.deskX && character.y === character.deskY + 16; step++) tick();
  assert.equal(character.activity, 'walking', 'travel to coffee is still in progress');
  assert.notDeepEqual({ x: character.x, y: character.y }, { x: character.deskX, y: character.deskY + 16 });
  engine.onToolStart(office, character.id, 'tool', 'run_command', 'running');

  engine.reduceCharacter(office, character, { type: 'arrived', generation: staleGeneration });
  assert.equal(character.activity, 'walking');
  assert.equal(character.idleGoal, null);
  assert.notEqual(character.speechBubble?.text, 'Fresh coffee');
});

test('snapshot restoration replaces stale tools and coffee intent without replaying bubbles', () => {
  const { office, tick } = fixture();
  const character = office.characters.get('agent-0');
  const coffee = office.leisureSpots.find((spot) => spot.type === 'coffee');
  character.x = character.targetX = coffee.standX;
  character.y = character.targetY = coffee.standY;
  character.idleGoal = 'coffee';
  character.activity = 'walking';
  character.leisureTimer = 10_000;
  coffee.occupant = character.id;
  tick();
  engine.onToolStart(office, character.id, 'obsolete', 'edit_file', 'writing');

  engine.restoreCharacterSnapshot(office, character.id, [
    ['current', { name: 'read_file', status: 'reading' }],
  ], false);
  assert.deepEqual([...character.activeTools.keys()], ['current']);
  assert.equal(character.idleGoal, null);
  assert.equal(character.speechBubble, undefined);
  assert.equal(coffee.occupant, null);
  for (let step = 0; step < 100 && character.activity === 'walking'; step++) tick();
  assert.equal(character.activity, 'reading');
});

test('idle snapshot resets an expired local leisure timer', () => {
  const { office, tick } = fixture();
  const character = office.characters.get('agent-0');
  character.idleTimer = -1;

  engine.restoreCharacterSnapshot(office, character.id, [], false);
  assert.ok(character.idleTimer > 0);
  withRandomQueue([0.99], () => tick());
  assert.equal(character.idleGoal, null);
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

test('layout rebuild drops a stale standing reservation without stealing a seated departure', () => {
  const { office } = fixture();
  const character = office.characters.get('agent-0');
  const coffee = office.leisureSpots.find((spot) => spot.type === 'coffee');
  coffee.occupant = character.id;
  character.idleGoal = null;

  engine.addCharacter(office, 'agent-1', 'Second');
  assert.equal(office.leisureSpots.find((spot) => spot.type === 'coffee').occupant, null);
});

test('the pet approaches a nearby stationary agent instead of wandering away', () => {
  const { office, tick } = fixture();
  const character = office.characters.get('agent-0');
  character.x = character.targetX = 120;
  character.y = character.targetY = 80;
  character.idleTimer = 1e9;
  office.pet.x = office.pet.targetX = 80;
  office.pet.y = office.pet.targetY = 80;
  office.pet.sitTimer = 0;

  const originalRandom = Math.random;
  Math.random = () => 0.1;
  try {
    for (let step = 0; step < 20; step++) tick();
  } finally {
    Math.random = originalRandom;
  }

  assert.ok(office.pet.x > 80,
    `pet moves toward the nearby agent: ${JSON.stringify({ x: office.pet.x, y: office.pet.y, behavior: office.pet.behavior, targetX: office.pet.targetX })}`);
});

test('the pet settles into a nap without moving', () => {
  const { office, tick } = fixture();
  office.pet.sitTimer = 0;

  withRandomQueue(Array(10).fill(0.5), () => tick());

  assert.deepEqual({ behavior: office.pet.behavior, sitting: office.pet.isSitting, x: office.pet.x },
    { behavior: 'nap', sitting: true, x: 80 });
});

test('the pet grooms while staying in place', () => {
  const { office, tick } = fixture();
  office.pet.sitTimer = 0;

  withRandomQueue(Array(10).fill(0.75), () => tick());

  assert.deepEqual({ behavior: office.pet.behavior, sitting: office.pet.isSitting, x: office.pet.x },
    { behavior: 'groom', sitting: true, x: 80 });
});

test('the pet returns to rest when a stationary activity expires', () => {
  for (const activity of [0.5, 0.75]) {
    const { office, tick } = fixture();
    office.pet.sitTimer = 0;
    withRandomQueue(Array(10).fill(activity), () => tick());
    office.pet.sitTimer = 50;

    withRandomQueue(Array(10).fill(0.5), () => tick());

    assert.equal(office.pet.behavior, 'rest');
  }
});

test('the pet abandons following when its agent disappears', () => {
  const { office, tick } = fixture();
  const character = office.characters.get('agent-0');
  character.x = character.targetX = 120;
  character.y = character.targetY = 80;
  character.idleTimer = 1e9;
  office.pet.sitTimer = 0;
  withRandomQueue(Array(10).fill(0.1), () => tick());
  engine.removeCharacter(office, character.id);

  withRandomQueue(Array(10).fill(0.5), () => tick());

  assert.deepEqual({ behavior: office.pet.behavior, target: office.pet.followTargetId },
    { behavior: 'rest', target: null });
});

test('following routes around a workstation without crossing its footprint', () => {
  const { office, tick } = fixture();
  const character = office.characters.get('agent-0');
  character.x = character.targetX = 174;
  character.y = character.targetY = 80;
  character.idleTimer = 1e9;
  office.pet.x = office.pet.targetX = 96;
  office.pet.y = office.pet.targetY = 64;
  office.pet.sitTimer = 0;
  const desk = { x: 111, y: 58, w: 48, h: 27 };

  const originalRandom = Math.random;
  Math.random = () => 0.1;
  try {
    for (let step = 0; step < 40; step++) {
      tick();
      assert.equal(office.pet.x + 12 > desk.x && office.pet.x < desk.x + desk.w
        && office.pet.y + 16 > desk.y && office.pet.y < desk.y + desk.h, false);
    }
  } finally {
    Math.random = originalRandom;
  }
  assert.ok(office.pet.x > 110, 'pet progresses to the other side of the workstation');
});

test('the pet replans its follow route when the agent moves', () => {
  const { office, tick } = fixture();
  const character = office.characters.get('agent-0');
  character.x = character.targetX = 120;
  character.y = character.targetY = 80;
  character.idleTimer = 1e9;
  office.pet.sitTimer = 0;
  const originalRandom = Math.random;
  Math.random = () => 0.1;
  try {
    tick();
    const previousTarget = { x: office.pet.targetX, y: office.pet.targetY };
    character.x = character.targetX = 160;
    character.y = character.targetY = 112;
    for (let step = 0; step < 6; step++) tick();

    assert.notDeepEqual({ x: office.pet.targetX, y: office.pet.targetY }, previousTarget);
  } finally {
    Math.random = originalRandom;
  }
});

test('following ends after its full five-second duration', () => {
  const { office, tick } = fixture();
  const character = office.characters.get('agent-0');
  character.x = character.targetX = 120;
  character.y = character.targetY = 80;
  character.idleTimer = 1e9;
  office.pet.sitTimer = 0;
  const originalRandom = Math.random;
  Math.random = () => 0.1;
  try {
    tick();
    for (let step = 0; step < 47; step++) tick();
    assert.equal(office.pet.behavior, 'follow');
    for (let step = 0; step < 3; step++) tick();
    assert.equal(office.pet.behavior, 'rest');
  } finally {
    Math.random = originalRandom;
  }
});

test('following avoids a second character standing between the pet and its target', () => {
  const { office, tick } = fixture(2);
  const target = office.characters.get('agent-0');
  const bystander = office.characters.get('agent-1');
  target.x = target.targetX = 160;
  target.y = target.targetY = 128;
  bystander.x = bystander.targetX = 200;
  bystander.y = bystander.targetY = 200;
  target.idleTimer = bystander.idleTimer = 1e9;
  office.pet.x = office.pet.targetX = 80;
  office.pet.y = office.pet.targetY = 128;
  office.pet.sitTimer = 0;
  const originalRandom = Math.random;
  Math.random = () => 0.1;
  try {
    tick();
    bystander.x = bystander.targetX = 112;
    bystander.y = bystander.targetY = 128;
    for (let step = 0; step < 35; step++) {
      tick();
      assert.ok(Math.hypot(office.pet.x - bystander.x, office.pet.y - bystander.y) >= 20,
        'pet keeps its distance from the bystander while following');
    }
    assert.ok(office.pet.x > 96, 'pet reaches the other side of the bystander');
  } finally {
    Math.random = originalRandom;
  }
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

test('the pet also stops before walking through a workstation', () => {
  const { office, tick } = fixture();
  const character = office.characters.get('agent-0');
  const deskLeft = character.deskX - 17;
  office.pet.isSitting = false;
  office.pet.x = office.pet.targetX = deskLeft - 13;
  office.pet.y = office.pet.targetY = character.deskY + 10;
  office.pet.targetX = character.deskX + 35;
  office.pet.sitTimer = 1e9;

  const original = Math.random;
  Math.random = () => 0.5;
  try {
    for (let step = 0; step < 30 && !office.pet.isSitting; step++) tick();
    assert.equal(office.pet.isSitting, true);
    assert.ok(office.pet.x + 12 <= deskLeft);
  } finally {
    Math.random = original;
  }
});

test('walking around the gaming furniture reaches a clear destination without crossing its footprint', () => {
  const { office, tick } = fixture();
  const character = office.characters.get('agent-0');
  const gaming = office.leisureSpots.find((spot) => spot.type === 'gaming');
  character.x = character.targetX = 16;
  character.y = character.targetY = gaming.itemY + 10;
  character.idleGoal = 'desk';
  const destinationX = gaming.itemX + 80;
  engine.reduceCharacter(office, character, {
    type: 'wander-started', x: destinationX, y: character.y,
  });

  for (let step = 0; step < 200 && character.activity === 'walking'; step++) {
    tick();
    assert.equal(
      character.x > gaming.itemX && character.x < gaming.itemX + 54
        && character.y > gaming.itemY && character.y < gaming.itemY + 50,
      false,
    );
  }
  assert.equal(character.x, destinationX);
  assert.equal(character.y, gaming.itemY + 10);
});

test('approaching a gaming seat from the far side does not cross the furniture', () => {
  const { office, tick } = fixture();
  const character = office.characters.get('agent-0');
  const gaming = office.leisureSpots.find((spot) => spot.type === 'gaming');
  character.x = character.targetX = gaming.itemX + 80;
  character.y = character.targetY = gaming.standY;
  engine.reduceCharacter(office, character, { type: 'leisure-started', spot: gaming, durationMs: 10_000 });

  for (let step = 0; step < 200 && character.activity === 'walking'; step++) {
    tick();
    const inside = character.x > gaming.itemX && character.x < gaming.itemX + 54
      && character.y > gaming.itemY && character.y < gaming.itemY + 50;
    assert.equal(inside && Math.hypot(character.x - gaming.standX, character.y - gaming.standY) > 16, false);
  }
  assert.equal(character.x, gaming.standX);
});

test('layout shrink relocates a walker before the moved furniture can block its route', () => {
  const { office, tick } = fixture(3);
  const character = office.characters.get('agent-0');
  character.x = character.targetX = 16;
  character.y = character.targetY = 202;
  character.idleGoal = 'desk';
  engine.reduceCharacter(office, character, { type: 'wander-started', x: 100, y: 202 });
  tick();
  engine.removeCharacter(office, 'agent-2');
  const gaming = office.leisureSpots.find((spot) => spot.type === 'gaming');

  for (let step = 0; step < 200 && character.activity === 'walking'; step++) {
    assert.equal(character.x > gaming.itemX && character.x < gaming.itemX + 54
      && character.y > gaming.itemY && character.y < gaming.itemY + 50, false);
    tick();
  }
  assert.equal(character.x, 100);
});

test('layout relocation does not stack a walker on another agent', () => {
  const { office } = fixture(3);
  const walker = office.characters.get('agent-0');
  const neighbor = office.characters.get('agent-1');
  walker.x = walker.targetX = 70;
  walker.y = walker.targetY = 210;
  neighbor.x = neighbor.targetX = 80;
  neighbor.y = neighbor.targetY = 208;
  walker.idleGoal = neighbor.idleGoal = 'desk';
  engine.reduceCharacter(office, walker, { type: 'wander-started', x: 120, y: 210 });
  engine.reduceCharacter(office, neighbor, { type: 'wander-started', x: 160, y: 160 });

  engine.removeCharacter(office, 'agent-2');

  assert.ok(Math.hypot(walker.x - neighbor.x, walker.y - neighbor.y) >= 20);
});

test('an unreachable wander destination does not leave a character walking forever', () => {
  const { office, tick } = fixture();
  const character = office.characters.get('agent-0');
  const gaming = office.leisureSpots.find((spot) => spot.type === 'gaming');
  const before = { x: character.x, y: character.y };
  engine.reduceCharacter(office, character, {
    type: 'wander-started', x: gaming.itemX + 24, y: gaming.itemY + 24,
  });

  tick();
  assert.equal(character.activity, 'idle');
  assert.deepEqual({ x: character.x, y: character.y }, before);
});

test('two moving agents cannot reserve the same wander destination', () => {
  const { office, tick } = fixture(2);
  const first = office.characters.get('agent-0');
  const second = office.characters.get('agent-1');
  const destination = { x: 96, y: 160 };
  engine.reduceCharacter(office, first, { type: 'wander-started', ...destination });
  engine.reduceCharacter(office, second, { type: 'wander-started', ...destination });

  tick();
  assert.equal(first.activity, 'walking');
  assert.equal(second.activity, 'idle');
  assert.notDeepEqual({ x: second.x, y: second.y }, destination);
});

test('a cached route yields when an earlier agent later claims the destination', () => {
  const { office, tick } = fixture(2);
  const first = office.characters.get('agent-0');
  const second = office.characters.get('agent-1');
  const destination = { x: 96, y: 160 };
  engine.reduceCharacter(office, second, { type: 'wander-started', ...destination });
  tick();
  assert.equal(second.activity, 'walking');

  engine.reduceCharacter(office, first, { type: 'wander-started', ...destination });
  tick();

  assert.equal(second.activity, 'idle');
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
