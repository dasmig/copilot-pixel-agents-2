import { hitTestCharacter, renderIsometric } from './isometric.js';
import { loadSprites } from './sprites.js';
import { legacyEntry, replaceHistory, upsertHistory } from './history.js';
import { updateSeating, type SeatKind } from './seating.js';
import { reduceCharacter } from './characterController.js';
import { InteractionRegistry } from './interactionRegistry.js';
import { findGridPath } from './gridPathfinder.js';
import type { ToolHistoryEntry, ToolStatus } from './types.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const TILE = 16;

const FLOOR_START_Y = 2 * TILE;

// Idle leisure timings
const IDLE_WANDER_MS = 10_000;      // after this long idle, consider leisure
const LEISURE_MIN_MS = 15_000;      // minimum time at leisure spot
const LEISURE_MAX_MS = 35_000;      // maximum time at leisure spot
const LEISURE_CHANCE = 0.45;        // probability of picking leisure vs staying at desk
const CHAR_MIN_SEPARATION = 20;     // min px between characters — prevents sprite stacking while wandering
const PET_FOLLOW_RADIUS = 96;
const PET_FOLLOW_DURATION = 5000;
const PET_REPATH_INTERVAL = 500;
const PET_NAP_DURATION = 6000;
const PET_GROOM_DURATION = 1500;


// ─── Types ────────────────────────────────────────────────────────────────────

export type CharacterActivity =
  | 'idle' | 'walking' | 'typing' | 'reading' | 'waiting'
  | 'running' | 'searching'
  | 'gaming' | 'watching_tv' | 'coffee_break';

export type LeisureType = 'gaming' | 'tv' | 'coffee';

export type WorkActivity = 'idle' | 'writing' | 'reading' | 'executing' | 'searching' | 'waiting';

export interface Character {
  id: string;
  name: string;
  // Logical world position; the renderer projects feet at (x + 8, y + 12).
  x: number; y: number;
  targetX: number; targetY: number;
  deskX: number; deskY: number;
  activity: CharacterActivity;
  workActivity: WorkActivity;
  motion: 'stationary' | 'walking';
  pose: 'stand' | 'sit-desk' | 'sit-gaming' | 'sit-tv' | 'drink-coffee';
  intentGeneration: number;
  movementGeneration: number;
  routeGeneration: number;
  routeLayoutRevision: number;
  route: Array<{ x: number; y: number }>;
  navigationIntent: 'desk' | 'leisure' | 'wander';
  activeTools: Map<string, { name: string; status: ToolStatus }>;
  toolHistory: ToolHistoryEntry[];
  palette: number;
  frame: number; frameTimer: number;
  direction: 'left' | 'right' | 'up' | 'down';
  sitProgress: number;
  seatKind: SeatKind | null;
  inputTokens: number; outputTokens: number;
  sessionStartedAt: number;
  speechBubble?: { text: string; expiresAt: number; owner: string };
  selected: boolean;
  // Leisure system
  idleGoal: LeisureType | 'desk' | null;
  idleTimer: number;       // ms until next idle action
  leisureTimer: number;    // ms remaining in leisure activity
  leisureExpiresAt?: number;
}

interface Pet {
  x: number; y: number;
  targetX: number; targetY: number;
  direction: 'left' | 'right';
  frame: number; frameTimer: number;
  isSitting: boolean;
  sitTimer: number;    // ms until next sit/unsit toggle
  color: 'orange' | 'gray';
  behavior: 'rest' | 'follow' | 'nap' | 'groom';
  followTargetId: string | null;
  route: Array<{ x: number; y: number }>;
  routeLayoutRevision: number;
  repathTimer: number;
}

interface LeisureSpot {
  type: LeisureType;
  capacity: number;
  itemX: number; itemY: number;
  standX: number; standY: number;
  occupant: string | null;
}

export interface Office {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  characters: Map<string, Character>;
  animFrameId: number;
  lastTimestamp: number;
  pcFrame: number; pcFrameTimer: number;
  cols: number; rows: number;
  zoom: number;
  // Canvas pixels, equivalent to CSS pixels at the current 1:1 resolution.
  panX: number; panY: number;
  onCharacterClick?: (id: string) => void;
  pet: Pet;
  leisureSpots: LeisureSpot[];
  interactions: InteractionRegistry;
  elapsedTime: number;
  layoutRevision: number;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

let nextPaletteIndex = 0;

export function createOffice(canvas: HTMLCanvasElement): Office {
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;

  const pet: Pet = {
    x: 80, y: 80,
    targetX: 80, targetY: 80,
    direction: 'right',
    frame: 0, frameTimer: 0,
    isSitting: true,
    sitTimer: 4000,
    color: 'orange',
    behavior: 'rest',
    followTargetId: null,
    route: [],
    routeLayoutRevision: 0,
    repathTimer: 0,
  };

  const office: Office = {
    canvas, ctx,
    characters: new Map(),
    animFrameId: 0,
    lastTimestamp: 0,
    pcFrame: 0, pcFrameTimer: 0,
    cols: 14, rows: 16,
    zoom: 1, panX: 0, panY: 0,
    pet,
    leisureSpots: [],
    interactions: new InteractionRegistry(),
    elapsedTime: 0,
    layoutRevision: 0,
  };

  let pointerId: number | null = null;
  let startX = 0, startY = 0;
  let lastX = 0, lastY = 0;
  let dragging = false;
  let suppressClick = false;

  const movePointer = (e: PointerEvent): void => {
    if (e.pointerId !== pointerId) return;
    if (!dragging && Math.hypot(e.clientX - startX, e.clientY - startY) <= 4) return;
    dragging = true;
    suppressClick = true;
    canvas.classList.add('dragging');
    const rect = canvas.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      office.panX += (e.clientX - lastX) * canvas.width / rect.width;
      office.panY += (e.clientY - lastY) * canvas.height / rect.height;
    }
    lastX = e.clientX;
    lastY = e.clientY;
  };

  const resetPointer = (e: PointerEvent): void => {
    if (e.pointerId !== pointerId) return;
    const capturedId = e.pointerId;
    pointerId = null;
    dragging = false;
    canvas.classList.remove('dragging');
    if (canvas.hasPointerCapture(capturedId)) canvas.releasePointerCapture(capturedId);
  };

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !e.isPrimary || pointerId !== null) return;
    pointerId = e.pointerId;
    startX = lastX = e.clientX;
    startY = lastY = e.clientY;
    dragging = false;
    suppressClick = false;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', movePointer);
  canvas.addEventListener('pointerup', (e) => {
    movePointer(e);
    resetPointer(e);
  });
  canvas.addEventListener('pointercancel', resetPointer);
  canvas.addEventListener('lostpointercapture', resetPointer);

  canvas.addEventListener('click', (e) => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const cx = (e.clientX - rect.left) * canvas.width / rect.width;
    const cy = (e.clientY - rect.top) * canvas.height / rect.height;
    const hit = hitTestCharacter(office, cx, cy);
    for (const c of office.characters.values()) c.selected = c === hit;
    office.onCharacterClick?.(hit?.id ?? '');
  });

  computeLeisureSpots(office);
  loadSprites();
  return office;
}

// ─── Resize & Layout ──────────────────────────────────────────────────────────

export function resizeOffice(office: Office, cssWidth: number, cssHeight: number): void {
  const w = Math.max(Math.round(cssWidth), 64);
  const h = Math.max(Math.round(cssHeight), 64);
  if (office.canvas.width === w && office.canvas.height === h) return;

  office.canvas.width = w;
  office.canvas.height = h;
  office.ctx.imageSmoothingEnabled = false;
  // Viewport resizing never changes logical layout, occupancy or work.
}

export function setOfficeZoom(office: Office, zoom: number): void {
  if (Number.isNaN(zoom)) return;
  office.zoom = clamp(zoom, 0.5, 3);
}

export function resetOfficeView(office: Office): void {
  office.zoom = 1;
  office.panX = 0;
  office.panY = 0;
}

function refreshRoomLayout(office: Office): void {
  office.layoutRevision++;
  office.cols = 14;
  office.rows = Math.max(16, 10 + Math.ceil(office.characters.size / 2) * 4);
  computeLeisureSpots(office);
  repositionDesks(office);

  const maxX = (office.cols - 2) * TILE;
  const maxY = (office.rows - 2) * TILE;
  const zones = furnitureZones(office);
  for (const c of office.characters.values()) {
    c.x = clamp(c.x, TILE, maxX);
    c.y = clamp(c.y, FLOOR_START_Y, maxY);
    const atDesk = Math.hypot(c.x - c.deskX, c.y - c.deskY - TILE) < 0.5;
    const atReservedSeat = office.leisureSpots.some((spot) =>
      office.interactions.has(spot.type, c.id) && (spot.type === c.idleGoal || c.sitProgress > 0)
      && Math.hypot(c.x - spot.standX, c.y - spot.standY) < 0.5);
    if (!atDesk && !atReservedSeat && zones.some((zone) => insideZone(c.x, c.y, zone))) {
      const safe = nearestClearTile(office, c, zones);
      if (safe) { c.x = safe.x; c.y = safe.y; }
    }
    reduceCharacter(office, c, {
      type: 'layout-changed',
      x: clamp(c.targetX, TILE, maxX), y: clamp(c.targetY, FLOOR_START_Y, maxY),
    });
  }
  const petMaxX = (office.cols - 3) * TILE;
  const petMinY = FLOOR_START_Y + TILE;
  office.pet.x = clamp(office.pet.x, TILE, petMaxX);
  office.pet.y = clamp(office.pet.y, petMinY, maxY);
  office.pet.targetX = clamp(office.pet.targetX, TILE, petMaxX);
  office.pet.targetY = clamp(office.pet.targetY, petMinY, maxY);
}

function computeLeisureSpots(office: Office): void {
  const coffeeX = (office.cols - 3) * TILE;
  const leisureY = (office.rows - 4) * TILE;
  const tvX = (office.cols - 6) * TILE;
  const spots: LeisureSpot[] = [
    { type: 'coffee', capacity: 1, itemX: coffeeX, itemY: 28, standX: coffeeX - 8, standY: 46, occupant: null },
    { type: 'gaming', capacity: 1, itemX: 20, itemY: leisureY, standX: 28, standY: leisureY + 18, occupant: null },
    { type: 'tv', capacity: 1, itemX: tvX, itemY: leisureY, standX: tvX + 18, standY: leisureY + 18, occupant: null },
  ];

  office.interactions.replace(spots, (characterId, type) => {
    const character = office.characters.get(characterId);
    return !!character && (character.idleGoal === type || character.sitProgress > 0);
  });
  office.leisureSpots = spots;
  for (const spot of spots) {
    if (spot.occupant === null) continue;
    const c = office.characters.get(spot.occupant);
    if (!c) continue;
    if (c.idleGoal === spot.type) {
      if (c.activity !== 'walking') {
        c.x = spot.standX;
        c.y = spot.standY;
      }
      reduceCharacter(office, c, { type: 'layout-changed', x: spot.standX, y: spot.standY });
    }
  }
}

function repositionDesks(office: Office): void {
  let idx = 0;
  for (const c of office.characters.values()) {
    const { deskX, deskY } = deskPosition(idx);
    c.deskX = deskX;
    c.deskY = deskY;
    if ((c.activeTools.size > 0 || c.activity === 'waiting') && c.activity !== 'walking') {
      c.x = deskX;
      c.y = deskY + TILE;
    } else if (c.idleGoal === 'desk' || c.idleGoal === null) {
      if (c.activity !== 'walking') {
        c.x = deskX;
        c.y = deskY + TILE;
      }
    }
    if (c.navigationIntent !== 'wander'
      && (c.idleGoal === 'desk' || c.idleGoal === null || c.activeTools.size > 0 || c.activity === 'waiting')) {
      reduceCharacter(office, c, { type: 'layout-changed', x: deskX, y: deskY + TILE });
    }
    idx++;
  }
}

function deskPosition(idx: number): { deskX: number; deskY: number } {
  return {
    deskX: (3 + (idx % 2) * 5) * TILE,
    deskY: (4 + Math.floor(idx / 2) * 4) * TILE,
  };
}

// ─── Character management ─────────────────────────────────────────────────────

export function addCharacter(office: Office, id: string, name: string): void {
  if (office.characters.has(id)) return;
  const idx = office.characters.size;
  const { deskX, deskY } = deskPosition(idx);
  office.characters.set(id, {
    id, name,
    x: deskX, y: deskY + TILE,
    targetX: deskX, targetY: deskY + TILE,
    deskX, deskY,
    activity: 'idle',
    workActivity: 'idle', motion: 'stationary', pose: 'sit-desk', intentGeneration: 0, movementGeneration: 0,
    routeGeneration: -1, routeLayoutRevision: -1, route: [], navigationIntent: 'desk',
    activeTools: new Map(),
    toolHistory: [],
    palette: nextPaletteIndex++ % 6,
    frame: 0, frameTimer: 0,
    direction: 'down',
    sitProgress: 0,
    seatKind: null,
    inputTokens: 0, outputTokens: 0,
    sessionStartedAt: Date.now(),
    selected: false,
    idleGoal: null,
    idleTimer: IDLE_WANDER_MS * (0.5 + Math.random()),
    leisureTimer: 0,
  });
  refreshRoomLayout(office);
}

export function removeCharacter(office: Office, id: string): void {
  const character = office.characters.get(id);
  if (!character) return;
  reduceCharacter(office, character, { type: 'removed' });
  office.characters.delete(id);
  refreshRoomLayout(office);
}

export function onToolStart(
  office: Office, agentId: string, toolId: string, toolName: string, status: ToolStatus,
  entry?: ToolHistoryEntry,
): void {
  const c = office.characters.get(agentId);
  if (!c) return;
  reduceCharacter(office, c, { type: 'tool-started', toolId, name: toolName, status });
  upsertHistory(c.toolHistory, entry ?? legacyEntry(toolId, toolName, status));
  // Reset idle timer so they don't immediately dash to leisure after work ends
  c.idleTimer = IDLE_WANDER_MS * (1 + Math.random());
}

export function onToolDone(office: Office, agentId: string, toolId: string, received?: ToolHistoryEntry): void {
  const c = office.characters.get(agentId);
  if (!c) return;
  if (received) upsertHistory(c.toolHistory, received);
  else {
    const entry = c.toolHistory.find((e) => e.toolId === toolId && e.outcome === 'running');
    if (entry) { entry.finishedAt = Date.now(); entry.outcome = 'completed'; }
  }
  reduceCharacter(office, c, { type: 'tool-finished', toolId });
  if (c.activeTools.size === 0) {
    c.idleTimer = IDLE_WANDER_MS * (0.5 + Math.random());
  }
}

export function syncHistory(office: Office, agentId: string, history: ToolHistoryEntry[]): void {
  const c = office.characters.get(agentId);
  if (c) c.toolHistory = replaceHistory(history);
}

export function setWaiting(office: Office, agentId: string): void {
  const c = office.characters.get(agentId);
  if (!c) return;
  reduceCharacter(office, c, { type: 'waiting' });
}

export function setIdle(office: Office, agentId: string): void {
  const c = office.characters.get(agentId);
  if (!c) return;
  reduceCharacter(office, c, { type: 'stopped' });
  c.idleTimer = IDLE_WANDER_MS * (0.5 + Math.random());
}

export function restoreCharacterSnapshot(
  office: Office, agentId: string,
  tools: ReadonlyArray<readonly [string, { name: string; status: ToolStatus }]>, isWaiting: boolean,
): void {
  const character = office.characters.get(agentId);
  if (!character) return;
  reduceCharacter(office, character, { type: 'snapshot-restored', tools, isWaiting });
  character.idleTimer = IDLE_WANDER_MS * (0.5 + Math.random());
  character.leisureTimer = 0;
}

// ─── Loop ─────────────────────────────────────────────────────────────────────

export function startLoop(office: Office): void {
  function tick(ts: number) {
    const elapsed = Math.max(0, ts - office.lastTimestamp);
    const dt = Math.min(elapsed, 100);
    office.lastTimestamp = ts;
    update(office, dt, elapsed);
    renderIsometric(office);
    office.animFrameId = requestAnimationFrame(tick);
  }
  office.animFrameId = requestAnimationFrame(tick);
}

export function stopLoop(office: Office): void {
  cancelAnimationFrame(office.animFrameId);
}

// ─── Update ───────────────────────────────────────────────────────────────────

function update(office: Office, dt: number, elapsed: number): void {
  office.elapsedTime += elapsed;

  // PC animation
  office.pcFrameTimer += dt;
  if (office.pcFrameTimer >= 400) {
    office.pcFrameTimer = 0;
    office.pcFrame = (office.pcFrame + 1) % 3;
  }

  updatePet(office, dt);

  const maxX = Math.max(0, (office.cols - 2) * TILE);
  const maxY = Math.max(0, (office.rows - 2) * TILE);
  const floorStartY = FLOOR_START_Y;

  for (const c of office.characters.values()) {
    updateCharacterMovement(office, c, dt);
    updateCharacterAnimation(c, dt);

    // Only run idle behavior when character has no work
    if (c.activeTools.size === 0 && c.activity !== 'waiting') {
      updateIdleBehavior(office, c, dt, maxX, maxY, floorStartY);
    }

    updateSeating(office, c, dt);
    if (c.sitProgress === 0 && office.leisureSpots.some((spot) => spot.occupant === c.id && spot.type !== c.idleGoal)) {
      reduceCharacter(office, c, { type: 'seat-vacated' });
    }
    if (c.speechBubble && office.elapsedTime >= c.speechBubble.expiresAt) {
      reduceCharacter(office, c, { type: 'bubble-expired', owner: c.speechBubble.owner });
    }
  }
}

function updateCharacterAnimation(c: Character, dt: number): void {
  const animateHands = c.sitProgress > 0 && (c.activity === 'typing' || c.activity === 'gaming');
  if (!animateHands && (c.motion === 'stationary' || c.sitProgress > 0)) {
    c.frame = 0;
    c.frameTimer = 0;
    return;
  }
  c.frameTimer += dt;
  const fps = 8;
  if (c.frameTimer >= 1000 / fps) {
    c.frameTimer = 0;
    c.frame = (c.frame + 1) % 4;
  }
}

function updateCharacterMovement(office: Office, c: Character, dt: number): void {
  if (c.activity !== 'walking' || c.sitProgress > 0) return;
  if (Math.hypot(c.targetX - c.x, c.targetY - c.y) < 0.5) {
    c.route = [];
    reduceCharacter(office, c, { type: 'arrived', generation: c.movementGeneration });
    return;
  }
  if (targetClaimedByEarlier(office, c)) {
    reduceCharacter(office, c, { type: 'route-unreachable', generation: c.movementGeneration });
    return;
  }
  if (c.routeGeneration !== c.movementGeneration || c.routeLayoutRevision !== office.layoutRevision) {
    c.route = routeToTarget(office, c);
    c.routeGeneration = c.movementGeneration;
    c.routeLayoutRevision = office.layoutRevision;
  }
  const waypoint = c.route[0];
  if (!waypoint) {
    reduceCharacter(office, c, { type: 'route-unreachable', generation: c.movementGeneration });
    return;
  }
  const speed = 55 * (dt / 1000);
  const dx = waypoint.x - c.x;
  const dy = waypoint.y - c.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist <= speed) {
    c.x = waypoint.x;
    c.y = waypoint.y;
    c.route.shift();
    if (c.route.length === 0) reduceCharacter(office, c, { type: 'arrived', generation: c.movementGeneration });
  } else {
    c.x += (dx / dist) * speed;
    c.y += (dy / dist) * speed;
    const sx = dx - dy;
    const sy = (dx + dy) * 0.5;
    c.direction = Math.abs(sx) > Math.abs(sy)
      ? (sx > 0 ? 'right' : 'left')
      : (sy > 0 ? 'down' : 'up');
  }
}

function targetClaimedByEarlier(office: Office, character: Character): boolean {
  for (const other of office.characters.values()) {
    if (other.id === character.id) break;
    if (Math.hypot(other.targetX - character.targetX, other.targetY - character.targetY) < CHAR_MIN_SEPARATION) {
      return true;
    }
  }
  return false;
}

function routeToTarget(office: Office, character: Character): Array<{ x: number; y: number }> {
  for (const other of office.characters.values()) {
    if (other.id !== character.id && other.motion === 'stationary'
      && Math.hypot(other.x - character.targetX, other.y - character.targetY) < CHAR_MIN_SEPARATION) return [];
  }
  const start = { col: Math.round(character.x / TILE), row: Math.round(character.y / TILE) };
  const end = { col: Math.round(character.targetX / TILE), row: Math.round(character.targetY / TILE) };
  const zones = furnitureZones(office);
  const startZone = zones.find((zone) => insideZone(character.x, character.y, zone));
  const isInteractionTarget = Math.hypot(character.targetX - character.deskX,
    character.targetY - character.deskY - TILE) < 0.5
    || office.leisureSpots.some((spot) => spot.standX === character.targetX && spot.standY === character.targetY);
  const endZone = isInteractionTarget
    ? zones.find((zone) => insideZone(character.targetX, character.targetY, zone)) : undefined;
  const blocked = (col: number, row: number) => {
    if (col < 1 || row < 2 || col > office.cols - 2 || row > office.rows - 2) return true;
    return zones.some((zone) => insideZone(col * TILE, row * TILE, zone)
      && !(zone === endZone && Math.abs(col - end.col) + Math.abs(row - end.row) <= 1)
      && !(zone === startZone && Math.abs(col - start.col) + Math.abs(row - start.row) <= 1));
  };
  const result = findGridPath(office.cols, office.rows, start, end, blocked);
  if (result.kind === 'unreachable') return [];
  const route = result.points.map(({ col, row }) => ({ x: col * TILE, y: row * TILE }));
  if (Math.hypot(character.x - start.col * TILE, character.y - start.row * TILE) > 0.5) {
    route.unshift({ x: start.col * TILE, y: start.row * TILE });
  }
  if (route.length === 0 || Math.hypot(route.at(-1)!.x - character.targetX, route.at(-1)!.y - character.targetY) > 0.5) {
    route.push({ x: character.targetX, y: character.targetY });
  }
  return route;
}

type FurnitureZone = { x: number; y: number; w: number; h: number };

function insideZone(x: number, y: number, zone: FurnitureZone): boolean {
  return x >= zone.x && x <= zone.x + zone.w && y >= zone.y && y <= zone.y + zone.h;
}

function nearestClearTile(office: Office, character: Character, zones: FurnitureZone[]): { x: number; y: number } | null {
  let nearest: { x: number; y: number } | null = null;
  let distance = Infinity;
  for (let row = 2; row <= office.rows - 2; row++) {
    for (let col = 1; col <= office.cols - 2; col++) {
      const candidateX = col * TILE;
      const candidateY = row * TILE;
      if (zones.some((zone) => insideZone(candidateX, candidateY, zone))) continue;
      if ([...office.characters.values()].some((other) => other.id !== character.id
        && (Math.hypot(other.x - candidateX, other.y - candidateY) < CHAR_MIN_SEPARATION
          || Math.hypot(other.targetX - candidateX, other.targetY - candidateY) < CHAR_MIN_SEPARATION))) continue;
      const candidateDistance = Math.hypot(character.x - candidateX, character.y - candidateY);
      if (candidateDistance < distance) {
        nearest = { x: candidateX, y: candidateY };
        distance = candidateDistance;
      }
    }
  }
  return nearest;
}

function updateIdleBehavior(
  office: Office, c: Character, dt: number,
  maxX: number, maxY: number, floorStartY: number,
): void {
  // Countdown idle timer
  if (c.idleTimer > 0) {
    c.idleTimer -= dt;
  }

  // If doing leisure, count down leisure timer
  if (c.idleGoal && c.idleGoal !== 'desk' && c.activity !== 'walking') {
    c.leisureExpiresAt ??= office.elapsedTime + c.leisureTimer;
    c.leisureTimer = Math.max(0, c.leisureExpiresAt - office.elapsedTime);
    if (c.leisureTimer <= 0) {
      // Done — go back to desk
      reduceCharacter(office, c, { type: 'leisure-expired' });
      c.idleTimer = IDLE_WANDER_MS * (0.5 + Math.random());
    }
    return;
  }

  // Don't trigger if already moving or in leisure
  if (c.activity === 'walking') return;
  if (c.idleGoal && c.idleGoal !== 'desk') return;

  // Random idle wander at desk
  if (c.activity === 'idle' && c.idleGoal === null && Math.random() < 0.0003) {
    let wx = 0, wy = 0, found = false;
    for (let i = 0; i < 8; i++) {
      wx = clamp(TILE + Math.floor(Math.random() * (maxX - TILE + 1)), TILE, maxX);
      const minY = floorStartY + TILE;
      wy = clamp(minY + Math.floor(Math.random() * (maxY - minY + 1)), minY, maxY);
      if (!tooCloseToOtherCharacters(office, wx, wy, c.id)) { found = true; break; }
    }
    if (found) {
      reduceCharacter(office, c, { type: 'wander-started', x: wx, y: wy });
    }
    return;
  }

  // When idle timer expires, consider leisure
  if (c.idleTimer <= 0 && c.activity === 'idle') {
    if (Math.random() < LEISURE_CHANCE && office.leisureSpots.length > 0) {
      // Pick an available leisure spot
      const available = office.leisureSpots.filter((s) => office.interactions.available(s.type));
      if (available.length > 0) {
        const spot = available[Math.floor(Math.random() * available.length)];
        const durationMs = LEISURE_MIN_MS + Math.random() * (LEISURE_MAX_MS - LEISURE_MIN_MS);
        reduceCharacter(office, c, { type: 'leisure-started', spot, durationMs });
        return;
      }
    }
    // Reset timer even if we didn't go anywhere
    c.idleTimer = IDLE_WANDER_MS * (0.5 + Math.random());
  }

}

// Checks candidate point against every other character's current (or, if walking, target)
// position so idle wandering never sends two agents to the same spot on screen.
function tooCloseToOtherCharacters(office: Office, x: number, y: number, excludeId: string): boolean {
  for (const other of office.characters.values()) {
    if (other.id === excludeId) continue;
    const ox = other.activity === 'walking' ? other.targetX : other.x;
    const oy = other.activity === 'walking' ? other.targetY : other.y;
    const dx = x - ox;
    const dy = y - oy;
    if (dx * dx + dy * dy < CHAR_MIN_SEPARATION * CHAR_MIN_SEPARATION) return true;
  }
  return false;
}

function furnitureZones(office: Office): Array<{ x: number; y: number; w: number; h: number }> {
  const zones = office.leisureSpots.filter((spot) => spot.type !== 'coffee').map((spot) => ({
    x: spot.itemX,
    y: spot.itemY - (spot.type === 'tv' ? 4 : 0),
    w: spot.type === 'tv' ? 65 : 54,
    h: spot.type === 'tv' ? 58 : 50,
  }));
  for (let index = 0; index < Math.max(2, office.characters.size); index++) {
    const desk = deskPosition(index);
    zones.push({ x: desk.deskX - 17, y: desk.deskY - 6, w: 48, h: 27 });
  }
  zones.push({ x: (office.cols - 3) * TILE, y: 28, w: 24, h: 14 });
  return zones;
}

function petInZone(px: number, py: number, zones: Array<{ x: number; y: number; w: number; h: number }>): boolean {
  const pw = 12, ph = 16;
  for (const z of zones) {
    if (px + pw > z.x && px < z.x + z.w && py + ph > z.y && py < z.y + z.h) return true;
  }
  return false;
}

function petNearCharacter(office: Office, x: number, y: number): boolean {
  return [...office.characters.values()].some((character) =>
    Math.hypot(character.x - x, character.y - y) < CHAR_MIN_SEPARATION);
}

function planPetRoute(office: Office, target: Character, zones: ReturnType<typeof furnitureZones>): boolean {
  const pet = office.pet;
  const start = { col: Math.round(pet.x / TILE), row: Math.round(pet.y / TILE) };
  if (petNearCharacter(office, start.col * TILE, start.row * TILE)) {
    start.col = Math.floor(pet.x / TILE);
    start.row = Math.floor(pet.y / TILE);
  }
  const candidates: Array<{ x: number; y: number }> = [];
  for (let row = 3; row <= office.rows - 2; row++) {
    for (let col = 1; col <= office.cols - 3; col++) {
      const x = col * TILE, y = row * TILE;
      const distance = Math.hypot(x - target.x, y - target.y);
      if (distance < 24 || distance > 48 || petInZone(x, y, zones) || petNearCharacter(office, x, y)) continue;
      candidates.push({ x, y });
    }
  }
  candidates.sort((left, right) => Math.hypot(target.x - left.x, target.y - left.y)
    - Math.hypot(target.x - right.x, target.y - right.y)
    || Math.hypot(pet.x - left.x, pet.y - left.y) - Math.hypot(pet.x - right.x, pet.y - right.y));
  const blocked = (col: number, row: number) => col < 1 || col > office.cols - 3
    || row < 3 || row > office.rows - 2 || petInZone(col * TILE, row * TILE, zones)
    || petNearCharacter(office, col * TILE, row * TILE);
  for (const candidate of candidates) {
    const end = { col: candidate.x / TILE, row: candidate.y / TILE };
    const result = findGridPath(office.cols, office.rows, start, end, blocked);
    if (result.kind === 'unreachable') continue;
    const route = result.points.map(({ col, row }) => ({ x: col * TILE, y: row * TILE }));
    if (Math.hypot(pet.x - start.col * TILE, pet.y - start.row * TILE) > 0.5) {
      route.unshift({ x: start.col * TILE, y: start.row * TILE });
    }
    pet.route = route;
    pet.targetX = candidate.x;
    pet.targetY = candidate.y;
    pet.routeLayoutRevision = office.layoutRevision;
    pet.repathTimer = PET_REPATH_INTERVAL;
    return true;
  }
  return false;
}

function stopPetFollowing(pet: Pet): void {
  pet.behavior = 'rest';
  pet.followTargetId = null;
  pet.route = [];
  pet.isSitting = true;
  pet.targetX = pet.x;
  pet.targetY = pet.y;
  pet.sitTimer = 2000 + Math.random() * 3000;
}

function updatePetFollowing(office: Office, dt: number, zones: ReturnType<typeof furnitureZones>): void {
  const pet = office.pet;
  pet.sitTimer -= dt;
  const target = pet.followTargetId === null ? undefined : office.characters.get(pet.followTargetId);
  if (!target || pet.sitTimer <= 0 || Math.hypot(target.x - pet.x, target.y - pet.y) > PET_FOLLOW_RADIUS + TILE * 2) {
    stopPetFollowing(pet);
    return;
  }
  pet.repathTimer -= dt;
  if (pet.repathTimer <= 0 || pet.routeLayoutRevision !== office.layoutRevision) {
    if (!planPetRoute(office, target, zones)) {
      stopPetFollowing(pet);
      return;
    }
  }
  let waypoint = pet.route[0];
  pet.isSitting = !waypoint;
  if (!waypoint) return;
  const speed = 35 * (dt / 1000);
  let dx = waypoint.x - pet.x, dy = waypoint.y - pet.y;
  let distance = Math.hypot(dx, dy);
  const step = Math.min(speed, distance);
  let nextX = distance ? pet.x + dx * step / distance : waypoint.x;
  let nextY = distance ? pet.y + dy * step / distance : waypoint.y;
  if (petNearCharacter(office, nextX, nextY)) {
    if (!planPetRoute(office, target, zones)) {
      stopPetFollowing(pet);
      return;
    }
    waypoint = pet.route[0];
    if (!waypoint) return;
    dx = waypoint.x - pet.x;
    dy = waypoint.y - pet.y;
    distance = Math.hypot(dx, dy);
    nextX = distance ? pet.x + dx * Math.min(speed, distance) / distance : waypoint.x;
    nextY = distance ? pet.y + dy * Math.min(speed, distance) / distance : waypoint.y;
  }
  if (petInZone(nextX, nextY, zones) || petNearCharacter(office, nextX, nextY)) {
    stopPetFollowing(pet);
    return;
  }
  pet.x = nextX;
  pet.y = nextY;
  if (Math.abs(dx - dy) > 0.5) pet.direction = dx - dy > 0 ? 'right' : 'left';
  if (speed >= distance) pet.route.shift();
}

function updatePet(office: Office, dt: number): void {
  const pet = office.pet;
  const floorY = FLOOR_START_Y + TILE;
  const maxX = Math.max(TILE, (office.cols - 3) * TILE);
  const maxY = Math.max(floorY + TILE, (office.rows - 2) * TILE);
  const zones = furnitureZones(office);

  // Frame animation
  pet.frameTimer += dt;
  const fps = pet.behavior === 'groom' ? 3 : pet.isSitting ? 1 : 5;
  if (pet.frameTimer >= 1000 / fps) {
    pet.frameTimer = 0;
    pet.frame = (pet.frame + 1) % 2;
  }

  if (pet.behavior === 'follow') {
    updatePetFollowing(office, dt, zones);
    return;
  }
  if (pet.behavior === 'nap' || pet.behavior === 'groom') {
    pet.sitTimer -= dt;
    if (pet.sitTimer <= 0) {
      pet.behavior = 'rest';
      pet.frame = 0;
      pet.sitTimer = 2000 + Math.random() * 3000;
    }
    return;
  }

  // Sit/stand timer
  pet.sitTimer -= dt;
  if (pet.sitTimer <= 0) {
    if (pet.isSitting) {
      const activity = Math.random();
      if (activity < 0.4) {
        const target = [...office.characters.values()]
          .filter((character) => Math.hypot(character.x - pet.x, character.y - pet.y) <= PET_FOLLOW_RADIUS)
          .sort((left, right) => Math.hypot(left.x - pet.x, left.y - pet.y)
            - Math.hypot(right.x - pet.x, right.y - pet.y))[0];
        if (target && planPetRoute(office, target, zones)) {
          pet.behavior = 'follow';
          pet.followTargetId = target.id;
          pet.sitTimer = PET_FOLLOW_DURATION;
          updatePetFollowing(office, dt, zones);
          return;
        }
      } else if (activity < 0.65) {
        pet.behavior = 'nap';
        pet.frame = 0;
        pet.sitTimer = PET_NAP_DURATION;
        return;
      } else if (activity < 0.85) {
        pet.behavior = 'groom';
        pet.frame = 0;
        pet.sitTimer = PET_GROOM_DURATION;
        return;
      }
    }
    pet.isSitting = !pet.isSitting;
    pet.sitTimer = pet.isSitting
      ? 3000 + Math.random() * 5000    // sit for 3-8s
      : 2000 + Math.random() * 4000;   // walk for 2-6s
    if (!pet.isSitting) {
      // Pick new target, retry up to 10 times to avoid furniture zones
      let tx = 0, ty = 0;
      for (let i = 0; i < 10; i++) {
        tx = Math.max(TILE, Math.min(maxX, TILE + Math.floor(Math.random() * maxX)));
        ty = Math.max(floorY, Math.min(maxY, floorY + Math.floor(Math.random() * (maxY - floorY))));
        if (!petInZone(tx, ty, zones)) break;
      }
      pet.targetX = tx;
      pet.targetY = ty;
    }
  }

  // Move if walking
  if (!pet.isSitting) {
    const speed = 35 * (dt / 1000);
    const dx = pet.targetX - pet.x;
    const dy = pet.targetY - pet.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= speed) {
      pet.x = pet.targetX;
      pet.y = pet.targetY;
      pet.isSitting = true;
      pet.sitTimer = 2000 + Math.random() * 4000;
    } else {
      const newX = pet.x + (dx / dist) * speed;
      const newY = pet.y + (dy / dist) * speed;
      if (petInZone(newX, newY, zones)) {
        // Hit furniture — sit and pick new target next cycle
        pet.isSitting = true;
        pet.sitTimer = 500 + Math.random() * 1000;
      } else {
        pet.x = newX;
        pet.y = newY;
        pet.direction = dx - dy >= 0 ? 'right' : 'left';
      }
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
