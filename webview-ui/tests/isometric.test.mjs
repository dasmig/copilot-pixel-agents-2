import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Bundle in memory: test the actual TypeScript without generated test artifacts
// or browser globals leaking into production code.
const result = await build({
  stdin: {
    contents: 'export * from "./engine.ts"; export * from "./isometric.ts";',
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
const motionPreference = { matches: false };
globalThis.matchMedia = () => motionPreference;
const engine = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);

function fixture(count = 1) {
  const handlers = new Map();
  const captures = new Set();
  const calls = [];
  const painted = [];
  const ctx = new Proxy({
    measureText: (text) => ({ width: text.length * 5 }),
  }, {
    get(target, key) {
      return key in target ? target[key] : (...args) => {
        for (const value of args) if (typeof value === 'number') assert.ok(Number.isFinite(value), `${String(key)}: finite coordinates`);
        calls.push([key, ...args]);
        if (key === 'fill') painted.push(target.fillStyle);
      };
    },
  });
  const canvas = {
    width: 800, height: 600,
    getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: canvas.width, height: canvas.height }),
    classList: { add() {}, remove() {} },
    addEventListener(name, fn) {
      if (!handlers.has(name)) handlers.set(name, []);
      handlers.get(name).push(fn);
    },
    setPointerCapture: (id) => captures.add(id),
    hasPointerCapture: (id) => captures.has(id),
    releasePointerCapture: (id) => captures.delete(id),
  };
  const office = engine.createOffice(canvas);
  for (let i = 0; i < count; i++) engine.addCharacter(office, `agent-${i}`, `Agent ${i}`);
  const emit = (name, event = {}) => handlers.get(name)?.forEach((fn) => fn({ pointerId: 1, button: 0, isPrimary: true, ...event }));
  return { office, canvas, calls, painted, emit };
}

test('projection keeps height upright and produces a 2:1 diamond', () => {
  assert.deepEqual(engine.project(16, 0), { x: 16, y: 8 });
  assert.deepEqual(engine.project(0, 16), { x: -16, y: 8 });
  assert.deepEqual(engine.project(16, 16, 12), { x: 0, y: 4 });
});

test('napping pet has closed eyes', () => {
  const { office, calls } = fixture(0);
  office.pet.behavior = 'nap';

  engine.renderIsometric(office);

  assert.ok(calls.some((call) => JSON.stringify(call) === JSON.stringify(['fillRect', 1, -10, 2, 1])));
});

test('grooming pet raises a paw toward its face', () => {
  const { office, calls } = fixture(0);
  office.pet.behavior = 'groom';
  office.pet.frame = 1;

  engine.renderIsometric(office);

  assert.ok(calls.some((call) => JSON.stringify(call) === JSON.stringify(['fillRect', 2, -12, 3, 4])));
});

test('shelf search scans rows and retrieves a folder only after arrival', () => {
  const { office, calls } = fixture();
  const character = office.characters.get('agent-0');
  engine.onToolStart(office, character.id, 'tool', 'file_search', 'searching');
  character.x = character.targetX;
  character.y = character.targetY;
  character.motion = 'stationary';
  character.shelfStartedAt = 0;
  const anchor = engine.characterPose(character).anchor;
  const hasFolder = () => calls.some(([method, x, y, width, height]) =>
    method === 'fillRect' && x === anchor.x + 4 && y === anchor.y - 19 && width === 10 && height === 7);

  office.elapsedTime = 300;
  engine.renderIsometric(office);
  assert.equal(hasFolder(), false);
  calls.length = 0;
  office.elapsedTime = 1900;
  engine.renderIsometric(office);
  assert.equal(hasFolder(), true);
});

test('read_file displays an open document only while reading', () => {
  const { office, calls } = fixture();
  const reader = office.characters.get('agent-0');
  const anchor = engine.characterPose(reader).anchor;
  const hasOpenPage = () => calls.some(([method, x, y, width, height]) =>
    method === 'fillRect' && x === anchor.x - 7 && y === anchor.y - 17 && width === 6 && height === 7);

  engine.onToolStart(office, reader.id, 'read', 'read_file', 'reading');
  engine.renderIsometric(office);
  assert.equal(hasOpenPage(), true);

  calls.length = 0;
  engine.onToolDone(office, reader.id, 'read');
  engine.renderIsometric(office);
  assert.equal(hasOpenPage(), false);
});

test('document remains attached to the reader at seated and standing shelf anchors', () => {
  const { office, calls } = fixture();
  const reader = office.characters.get('agent-0');
  engine.onToolStart(office, reader.id, 'read', 'read_file', 'reading');
  reader.sitProgress = 1;
  reader.seatKind = 'desk';
  let anchor = engine.characterPose(reader).anchor;
  engine.renderIsometric(office);
  assert.ok(calls.some(([method, x, y, width]) =>
    method === 'fillRect' && x === anchor.x - 7 && y === anchor.y - 17 && width === 6));

  calls.length = 0;
  reader.x = reader.targetX = office.shelfSpot.standX;
  reader.y = reader.targetY = office.shelfSpot.standY;
  reader.navigationIntent = 'shelf';
  reader.sitProgress = 0;
  reader.pose = 'stand';
  anchor = engine.characterPose(reader).anchor;
  engine.renderIsometric(office);
  assert.ok(calls.some(([method, x, y, width]) =>
    method === 'fillRect' && x === anchor.x - 7 && y === anchor.y - 17 && width === 6));
});

test('document page turns pause when reduced motion is requested', () => {
  const { office, calls } = fixture();
  const reader = office.characters.get('agent-0');
  engine.onToolStart(office, reader.id, 'read', 'read_file', 'reading');
  const anchor = engine.characterPose(reader).anchor;
  const offset = [...reader.id].reduce((value, letter) => value + letter.charCodeAt(0) * 37, 0) % 2400;
  office.elapsedTime = (2750 - offset + 3000) % 3000;
  const hasTurningPage = () => calls.some(([method, x, y, width]) =>
    method === 'fillRect' && x === anchor.x + 1 && y === anchor.y - 17 && width === 3);

  engine.renderIsometric(office);
  assert.equal(hasTurningPage(), true);

  try {
    motionPreference.matches = true;
    calls.length = 0;
    engine.renderIsometric(office);
    assert.equal(hasTurningPage(), false);
  } finally {
    motionPreference.matches = false;
  }
});

test('writing highlights a key at the desk while reading does not', () => {
  const { office, calls } = fixture();
  const editor = office.characters.get('agent-0');
  const key = engine.project(editor.deskX + 2, editor.deskY + 13, 24);
  const highlighted = () => calls.some(([method, x, y, width, height]) =>
    method === 'fillRect' && x === key.x && y === key.y && width === 2 && height === 1);

  engine.onToolStart(office, editor.id, 'edit', 'edit_file', 'writing');
  engine.renderIsometric(office);
  assert.equal(highlighted(), true);

  calls.length = 0;
  engine.onToolDone(office, editor.id, 'edit');
  engine.onToolStart(office, editor.id, 'read', 'read_file', 'reading');
  engine.renderIsometric(office);
  assert.equal(highlighted(), false);
});

test('writing monitor cycles through three abstract layouts without displaying tool contents', () => {
  const { office, painted } = fixture();
  const editor = office.characters.get('agent-0');
  engine.onToolStart(office, editor.id, 'edit', 'edit_file', 'writing');
  const frames = [];
  for (const time of [0, 1600, 3200]) {
    painted.length = 0;
    office.elapsedTime = time;
    engine.renderIsometric(office);
    frames.push(painted.filter((color) => color === '#93d8c4' || color === '#f2cc8f' || color === '#e8b7b7'));
  }

  assert.equal(new Set(frames.map((colors) => colors.join(','))).size, 3);
});

test('command execution displays a terminal monitor instead of the writing screen', () => {
  const { office, painted } = fixture();
  engine.onToolStart(office, 'agent-0', 'run', 'run_command', 'running');

  engine.renderIsometric(office);

  assert.ok(painted.includes('#85d4a1'));
  assert.equal(painted.includes('#93d8c4'), false);
});

test('terminal cursor pulses but stays fixed with reduced motion', () => {
  const { office, painted } = fixture();
  engine.onToolStart(office, 'agent-0', 'run', 'run_command', 'running');
  const cursorColor = () => painted.includes('#d7f2bf');
  office.elapsedTime = 0;
  engine.renderIsometric(office);
  assert.equal(cursorColor(), true);
  painted.length = 0;
  office.elapsedTime = 700;
  engine.renderIsometric(office);
  assert.equal(cursorColor(), false);

  try {
    motionPreference.matches = true;
    painted.length = 0;
    engine.renderIsometric(office);
    assert.equal(cursorColor(), true);
  } finally {
    motionPreference.matches = false;
  }
});

test('waiting agent looks aside briefly and reduced motion holds the resting gaze', () => {
  const { office, calls } = fixture();
  const agent = office.characters.get('agent-0');
  engine.setWaiting(office, agent.id);
  const anchor = engine.characterPose(agent).anchor;
  const looksAside = () => calls.some(([method, x, y, width, height]) =>
    method === 'fillRect' && x === anchor.x - 1 && y === anchor.y - 25 && width === 2 && height === 1);

  office.elapsedTime = 200;
  engine.renderIsometric(office);
  assert.equal(looksAside(), false);
  calls.length = 0;
  office.elapsedTime = 1650;
  engine.renderIsometric(office);
  assert.equal(looksAside(), true);

  try {
    motionPreference.matches = true;
    calls.length = 0;
    engine.renderIsometric(office);
    assert.equal(looksAside(), false);
  } finally {
    motionPreference.matches = false;
  }
});

test('completed, failed, and interrupted tools draw distinct idle reactions', () => {
  for (const [outcome, xOffset, width, height] of [
    ['completed', 10, 2, 2], ['failed', 12, 2, 5], ['interrupted', 9, 6, 6],
  ]) {
    const { office, calls } = fixture();
    const agent = office.characters.get('agent-0');
    engine.onToolStart(office, agent.id, 'tool', 'run_command', 'running');
    engine.onToolDone(office, agent.id, 'tool', {
      entryId: 'tool', toolId: 'tool', toolName: 'run_command', status: 'running', startedAt: 1, outcome,
    });
    const anchor = engine.characterPose(agent).anchor;

    engine.renderIsometric(office);

    assert.ok(calls.some(([method, x, y, rectWidth, rectHeight]) =>
      method === 'fillRect' && x === anchor.x + xOffset && y === anchor.y - 29
        && rectWidth === width && rectHeight === height), outcome);
  }
});

test('reaction is hidden while walking and after expiry, with a static reduced-motion indicator', () => {
  const { office, calls } = fixture();
  const agent = office.characters.get('agent-0');
  engine.onToolStart(office, agent.id, 'tool', 'run_command', 'running');
  engine.onToolDone(office, agent.id, 'tool', {
    entryId: 'tool', toolId: 'tool', toolName: 'run_command', status: 'running',
    startedAt: 1, outcome: 'completed',
  });
  const anchor = engine.characterPose(agent).anchor;
  const hasCheck = () => calls.some(([method, x, y, width, height]) =>
    method === 'fillRect' && x === anchor.x + 10 && y === anchor.y - 29 && width === 2 && height === 2);

  try {
    motionPreference.matches = true;
    engine.renderIsometric(office);
    assert.equal(hasCheck(), true);
    calls.length = 0;
    agent.motion = 'walking';
    engine.renderIsometric(office);
    assert.equal(hasCheck(), false);
    calls.length = 0;
    agent.motion = 'stationary';
    office.elapsedTime = agent.reaction.expiresAt;
    engine.renderIsometric(office);
    assert.equal(hasCheck(), false);
  } finally {
    motionPreference.matches = false;
  }
});

test('two writing agents use different monitor layouts at the same time', () => {
  const { office, painted } = fixture(2);
  for (const editor of office.characters.values()) {
    engine.onToolStart(office, editor.id, `edit-${editor.id}`, 'edit_file', 'writing');
  }

  engine.renderIsometric(office);

  assert.ok(painted.includes('#93d8c4'));
  assert.ok(painted.includes('#e8b7b7'));
});

test('seated writing agent briefly reaches for the mouse instead of typing', () => {
  const { office, calls } = fixture();
  const editor = office.characters.get('agent-0');
  engine.onToolStart(office, editor.id, 'edit', 'edit_file', 'writing');
  editor.sitProgress = 1;
  editor.seatKind = 'desk';
  const mouseReach = () => calls.some(([method, x, y, width, height]) =>
    method === 'fillRect' && x === 13 && y === 19 && width === 9 && height === 2);

  office.elapsedTime = 0;
  engine.renderIsometric(office);
  assert.equal(mouseReach(), false);

  calls.length = 0;
  office.elapsedTime = 2000;
  engine.renderIsometric(office);
  assert.equal(mouseReach(), true);
});

test('reduced motion freezes writing monitor layout and suppresses the mouse gesture', () => {
  const { office, calls, painted } = fixture();
  const editor = office.characters.get('agent-0');
  engine.onToolStart(office, editor.id, 'edit', 'edit_file', 'writing');
  editor.sitProgress = 1;
  editor.seatKind = 'desk';
  const colors = ['#93d8c4', '#f2cc8f', '#e8b7b7'];

  try {
    motionPreference.matches = true;
    office.elapsedTime = 0;
    engine.renderIsometric(office);
    const firstLayout = painted.filter((color) => colors.includes(color));

    calls.length = 0;
    painted.length = 0;
    office.elapsedTime = 2000;
    engine.renderIsometric(office);

    assert.deepEqual(painted.filter((color) => colors.includes(color)), firstLayout);
    assert.equal(calls.some(([method, x, y, width, height]) =>
      method === 'fillRect' && x === 13 && y === 19 && width === 9 && height === 2), false);
  } finally {
    motionPreference.matches = false;
  }
});

test('coffee break holds a cup and raises it for a sip only while stationary', () => {
  const { office, calls } = fixture();
  const drinker = office.characters.get('agent-0');
  const coffee = office.leisureSpots.find((spot) => spot.type === 'coffee');
  drinker.x = drinker.targetX = coffee.standX;
  drinker.y = drinker.targetY = coffee.standY;
  drinker.idleGoal = 'coffee';
  drinker.activity = 'coffee_break';
  drinker.pose = 'drink-coffee';
  coffee.occupant = drinker.id;
  const anchor = engine.characterPose(drinker).anchor;
  const hasCupAt = (y) => calls.some(([method, x, top, width, height]) =>
    method === 'fillRect' && x === anchor.x + 4 && top === y && width === 6 && height === 5);

  office.elapsedTime = 0;
  engine.renderIsometric(office);
  assert.equal(hasCupAt(anchor.y - 18), true);

  calls.length = 0;
  office.elapsedTime = 1700;
  engine.renderIsometric(office);
  assert.equal(hasCupAt(anchor.y - 26), true);

  calls.length = 0;
  drinker.activity = 'walking';
  drinker.motion = 'walking';
  engine.renderIsometric(office);
  assert.equal(hasCupAt(anchor.y - 26), false);
});

test('reduced motion keeps the held coffee cup below the face', () => {
  const { office, calls } = fixture();
  const drinker = office.characters.get('agent-0');
  drinker.activity = 'coffee_break';
  drinker.pose = 'drink-coffee';
  office.elapsedTime = 1700;
  const anchor = engine.characterPose(drinker).anchor;

  try {
    motionPreference.matches = true;
    engine.renderIsometric(office);
    assert.ok(calls.some(([method, x, y, width, height]) =>
      method === 'fillRect' && x === anchor.x + 4 && y === anchor.y - 18 && width === 6 && height === 5));
    assert.equal(calls.some(([method, x, y, width, height]) =>
      method === 'fillRect' && x === anchor.x + 4 && y === anchor.y - 26 && width === 6 && height === 5), false);
  } finally {
    motionPreference.matches = false;
  }
});

test('coffee starts with a held cup instead of an immediate mid-sip frame', () => {
  const { office, calls } = fixture();
  const drinker = office.characters.get('agent-0');
  drinker.activity = 'coffee_break';
  drinker.pose = 'drink-coffee';
  drinker.coffeeStartedAt = 1650;
  office.elapsedTime = 1700;
  const anchor = engine.characterPose(drinker).anchor;

  engine.renderIsometric(office);

  assert.ok(calls.some(([method, x, y, width, height]) =>
    method === 'fillRect' && x === anchor.x + 4 && y === anchor.y - 18 && width === 6 && height === 5));
});

test('coffee station mug disappears only while its occupant holds it', () => {
  const { office, calls } = fixture();
  const drinker = office.characters.get('agent-0');
  const coffee = office.leisureSpots.find((spot) => spot.type === 'coffee');
  coffee.occupant = drinker.id;
  const steamCount = () => calls.filter(([method, , , width, height]) =>
    method === 'fillRect' && width === 1.5 && height === 2).length;

  engine.renderIsometric(office);
  assert.equal(steamCount(), 3);

  calls.length = 0;
  drinker.activity = 'coffee_break';
  engine.renderIsometric(office);
  assert.equal(steamCount(), 0);
});

test('camera fits all floor corners and wall tops in portrait and landscape views', () => {
  const { office } = fixture(8);
  for (const [w, h] of [[280, 600], [360, 700], [1200, 600], [700, 260]]) {
    engine.resizeOffice(office, w, h);
    const camera = engine.officeCamera(office);
    for (const [x, y, z] of [[0, 0, 52], [office.cols * 16, 0, 52], [0, office.rows * 16, 52], [office.cols * 16, office.rows * 16, -10]]) {
      const p = engine.project(x, y, z);
      assert.ok(p.x * camera.scale + camera.x >= 0 && p.x * camera.scale + camera.x <= w);
      assert.ok(p.y * camera.scale + camera.y >= 0 && p.y * camera.scale + camera.y <= h);
    }
  }
});

test('hit testing shares the camera transform at every zoom and after panning', () => {
  const { office } = fixture(2);
  const c = office.characters.get('agent-0');
  for (const zoom of [0.5, 1, 1.25, 3]) {
    engine.setOfficeZoom(office, zoom);
    office.panX = 65;
    office.panY = -28;
    const p = engine.characterAnchor(c), camera = engine.officeCamera(office);
    assert.equal(engine.hitTestCharacter(office, camera.x + p.x * camera.scale, camera.y + (p.y - 20) * camera.scale), c);
  }
  assert.equal(engine.hitTestCharacter(office, -1000, -1000), undefined);
});

test('overlapping characters select the frontmost sprite', () => {
  const { office } = fixture(2);
  const back = office.characters.get('agent-0'), front = office.characters.get('agent-1');
  front.x = back.x + 3; front.y = back.y + 3;
  const camera = engine.officeCamera(office), p = engine.characterAnchor(front);
  assert.equal(engine.hitTestCharacter(office, camera.x + p.x * camera.scale, camera.y + (p.y - 18) * camera.scale), front);
});

test('resize preserves work, leisure occupancy and logical positions', () => {
  const { office } = fixture(2);
  engine.onToolStart(office, 'agent-0', 'tool', 'edit_file', 'writing');
  const c = office.characters.get('agent-1');
  const spot = office.leisureSpots.find((s) => s.type === 'gaming');
  spot.occupant = c.id; c.idleGoal = 'gaming'; c.activity = 'gaming';
  c.x = spot.standX; c.y = spot.standY;
  const before = JSON.stringify([...office.characters.values()]);
  engine.resizeOffice(office, 280, 700);
  assert.equal(JSON.stringify([...office.characters.values()]), before);
  assert.equal(office.leisureSpots.find((s) => s.type === 'gaming').occupant, c.id);
  assert.equal(office.characters.get('agent-0').activeTools.size, 1);
});

test('growing and shrinking the room preserves leisure assignments and keeps desks inside', () => {
  const { office } = fixture(2);
  const c = office.characters.get('agent-0');
  c.idleGoal = 'tv'; c.activity = 'watching_tv';
  office.leisureSpots.find((s) => s.type === 'tv').occupant = c.id;
  for (let i = 2; i < 12; i++) engine.addCharacter(office, `agent-${i}`, `Agent ${i}`);
  const tv = office.leisureSpots.find((s) => s.type === 'tv');
  assert.equal(tv.occupant, c.id);
  assert.equal(c.y, tv.standY);
  for (const character of office.characters.values()) {
    assert.ok(character.deskX >= 16 && character.deskX + 32 < office.cols * 16);
    assert.ok(character.deskY + 48 < (office.rows - 4) * 16);
  }
  for (let i = 11; i > 1; i--) engine.removeCharacter(office, `agent-${i}`);
  assert.equal(office.rows, 16);
  assert.equal(c.y, office.leisureSpots.find((s) => s.type === 'tv').standY);
});

test('zoom clamps and reset clears pan', () => {
  const { office } = fixture();
  engine.setOfficeZoom(office, 100); assert.equal(office.zoom, 3);
  engine.setOfficeZoom(office, -2); assert.equal(office.zoom, 0.5);
  engine.setOfficeZoom(office, NaN); assert.equal(office.zoom, 0.5);
  office.panX = 30; office.panY = -40;
  engine.resetOfficeView(office);
  assert.equal(office.zoom, 1); assert.equal(office.panX, 0); assert.equal(office.panY, 0);
});

test('drag pans without opening the inspector, next genuine click still selects', () => {
  const { office, emit } = fixture();
  const selections = [];
  office.onCharacterClick = (id) => selections.push(id);
  emit('pointerdown', { clientX: 20, clientY: 20 });
  emit('pointermove', { clientX: 22, clientY: 22 });
  assert.equal(office.panX, 0);
  emit('pointermove', { clientX: 50, clientY: 45 });
  emit('pointerup', { clientX: 50, clientY: 45 });
  emit('click', { clientX: 50, clientY: 45 });
  assert.deepEqual(selections, []);
  assert.equal(office.panX, 30); assert.equal(office.panY, 25);
  const p = engine.characterAnchor(office.characters.get('agent-0')), camera = engine.officeCamera(office);
  const event = { clientX: camera.x + p.x * camera.scale, clientY: camera.y + (p.y - 20) * camera.scale };
  emit('pointerdown', event); emit('pointerup', event); emit('click', event);
  assert.deepEqual(selections, ['agent-0']);
});

test('renderer draws empty, active and leisure scenes with missing-sprite fallbacks', () => {
  for (const count of [0, 1, 6, 12]) {
    const { office, calls } = fixture(count);
    for (const c of office.characters.values()) {
      c.selected = true; c.inputTokens = 10000; c.speechBubble = { text: 'edit_file', expiresAt: Date.now() + 1000 };
    }
    if (count) engine.onToolStart(office, 'agent-0', 't', 'run', 'running');
    office.leisureSpots.forEach((spot) => { spot.occupant = 'agent-0'; });
    engine.renderIsometric(office);
    assert.ok(calls.filter(([name]) => name === 'fill').length > 100);
    assert.equal(calls.filter(([name]) => name === 'save').length, calls.filter(([name]) => name === 'restore').length);
  }
});