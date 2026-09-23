import type { Character, CharacterActivity, LeisureType, Office, WorkActivity } from './engine.js';
import type { ToolStatus } from './types.js';

export type CharacterEvent =
  | { type: 'tool-started'; toolId: string; name: string; status: ToolStatus }
  | { type: 'tool-finished'; toolId: string }
  | { type: 'waiting' }
  | { type: 'stopped' }
  | { type: 'arrived'; generation: number }
  | { type: 'route-unreachable'; generation: number }
  | { type: 'wander-started'; x: number; y: number }
  | { type: 'leisure-started'; spot: Office['leisureSpots'][number]; durationMs: number }
  | { type: 'leisure-expired' }
  | { type: 'layout-changed'; x: number; y: number }
  | { type: 'seat-vacated' }
  | { type: 'bubble-expired'; owner: string }
  | { type: 'removed' }
  | { type: 'snapshot-restored'; tools: ReadonlyArray<readonly [string, { name: string; status: ToolStatus }]>; isWaiting: boolean };

function toolActivity(status: ToolStatus): WorkActivity {
  switch (status) {
    case 'reading': return 'reading';
    case 'writing': return 'writing';
    case 'running': return 'executing';
    case 'searching': return 'searching';
    default: return 'writing';
  }
}

function workPoseActivity(activity: WorkActivity): CharacterActivity {
  if (activity === 'writing') return 'typing';
  if (activity === 'executing') return 'running';
  return activity;
}

function leisureActivity(goal: LeisureType): CharacterActivity {
  switch (goal) {
    case 'gaming': return 'gaming';
    case 'tv': return 'watching_tv';
    case 'coffee': return 'coffee_break';
  }
}

function leisureBubble(goal: LeisureType): string {
  switch (goal) {
    case 'gaming': return 'GG EZ';
    case 'tv': return 'TV';
    case 'coffee': return 'Fresh coffee';
  }
}

function shortToolName(name: string): string {
  const label = name.replace(/([A-Z])/g, ' $1').trim();
  return label.length > 11 ? label.slice(0, 10) + '…' : label;
}

function setDestination(character: Character, x: number, y: number): void {
  if (character.targetX !== x || character.targetY !== y) character.intentGeneration++;
  character.targetX = x;
  character.targetY = y;
}

function resolveState(character: Character): void {
  const moving = Math.hypot(character.x - character.targetX, character.y - character.targetY) >= 0.5;
  const atDesk = Math.hypot(character.x - character.deskX, character.y - character.deskY - 16) < 0.5;
  character.motion = moving ? 'walking' : 'stationary';
  if (moving) {
    character.activity = 'walking';
    character.pose = 'stand';
    character.movementGeneration = character.intentGeneration;
  } else if (character.activeTools.size > 0) {
    character.activity = workPoseActivity(character.workActivity);
    character.pose = 'sit-desk';
  } else if (character.workActivity === 'waiting') {
    character.activity = 'waiting';
    character.pose = character.idleGoal === 'gaming' ? 'sit-gaming'
      : character.idleGoal === 'tv' ? 'sit-tv' : atDesk ? 'sit-desk' : 'stand';
  } else if (character.idleGoal && character.idleGoal !== 'desk') {
    character.activity = leisureActivity(character.idleGoal);
    character.pose = character.idleGoal === 'coffee' ? 'drink-coffee'
      : character.idleGoal === 'gaming' ? 'sit-gaming' : 'sit-tv';
  } else {
    character.activity = 'idle';
    character.pose = atDesk ? 'sit-desk' : 'stand';
  }
}

export function reduceCharacter(office: Office, character: Character, event: CharacterEvent): void {
  if (event.type === 'removed') {
    office.interactions.releaseCharacter(character.id);
    return;
  }
  switch (event.type) {
    case 'tool-started':
      character.intentGeneration++;
      character.navigationIntent = 'desk';
      character.leisureExpiresAt = undefined;
      character.activeTools.set(event.toolId, { name: event.name, status: event.status });
      character.workActivity = toolActivity(event.status);
      character.idleGoal = null;
      setDestination(character, character.deskX, character.deskY + 16);
      character.speechBubble = {
        text: shortToolName(event.name), expiresAt: office.elapsedTime + 3500, owner: `tool:${event.toolId}`,
      };
      break;
    case 'tool-finished':
      if (!character.activeTools.has(event.toolId)) return;
      character.intentGeneration++;
      character.activeTools.delete(event.toolId);
      character.workActivity = character.activeTools.size > 0
        ? toolActivity([...character.activeTools.values()][0].status) : 'idle';
      if (character.speechBubble?.owner === `tool:${event.toolId}`) character.speechBubble = undefined;
      break;
    case 'waiting':
      character.intentGeneration++;
      character.activeTools.clear();
      character.workActivity = 'waiting';
      character.speechBubble = { text: '?', expiresAt: office.elapsedTime + 15000, owner: 'system:waiting' };
      if (character.activity === 'walking' && character.idleGoal && character.idleGoal !== 'desk') {
        character.idleGoal = null;
        character.navigationIntent = 'desk';
        setDestination(character, character.deskX, character.deskY + 16);
      }
      break;
    case 'stopped':
      character.intentGeneration++;
      character.activeTools.clear();
      character.workActivity = 'idle';
      character.speechBubble = undefined;
      if (character.activity === 'walking' && character.idleGoal && character.idleGoal !== 'desk') {
        character.idleGoal = 'desk';
        character.navigationIntent = 'desk';
        setDestination(character, character.deskX, character.deskY + 16);
      }
      break;
    case 'arrived':
      if (event.generation !== character.intentGeneration || event.generation !== character.movementGeneration) return;
      if (character.navigationIntent === 'wander') character.navigationIntent = 'desk';
      character.direction = 'down';
      if (character.idleGoal && character.idleGoal !== 'desk' && character.workActivity === 'idle') {
        character.leisureExpiresAt = office.elapsedTime + character.leisureTimer;
        character.speechBubble = {
          text: leisureBubble(character.idleGoal),
          expiresAt: office.elapsedTime + character.leisureTimer,
          owner: `intent:${character.intentGeneration}`,
        };
      }
      break;
    case 'route-unreachable':
      if (event.generation !== character.movementGeneration) return;
      character.leisureExpiresAt = undefined;
      character.speechBubble = character.speechBubble?.owner.startsWith('intent:')
        ? undefined : character.speechBubble;
      character.idleGoal = null;
      character.navigationIntent = 'desk';
      setDestination(character, character.x, character.y);
      break;
    case 'wander-started':
      character.navigationIntent = 'wander';
      setDestination(character, event.x, event.y);
      break;
    case 'leisure-started':
      if (!office.interactions.reserve(event.spot.type, character.id)) return;
      character.leisureExpiresAt = Math.hypot(character.x - event.spot.standX, character.y - event.spot.standY) < 0.5
        ? office.elapsedTime + event.durationMs : undefined;
      character.navigationIntent = 'leisure';
      character.idleGoal = event.spot.type;
      character.leisureTimer = event.durationMs;
      setDestination(character, event.spot.standX, event.spot.standY);
      break;
    case 'leisure-expired':
      character.leisureExpiresAt = undefined;
      character.idleGoal = 'desk';
      character.navigationIntent = 'desk';
      character.speechBubble = undefined;
      setDestination(character, character.deskX, character.deskY + 16);
      break;
    case 'layout-changed':
      setDestination(character, event.x, event.y);
      break;
    case 'seat-vacated':
      break;
    case 'bubble-expired':
      if (character.speechBubble?.owner !== event.owner) return;
      if (office.elapsedTime >= character.speechBubble.expiresAt) character.speechBubble = undefined;
      break;
    case 'snapshot-restored':
      character.intentGeneration++;
      character.leisureExpiresAt = undefined;
      character.navigationIntent = 'desk';
      character.activeTools.clear();
      if (!event.isWaiting) {
        for (const [toolId, tool] of event.tools) {
          character.activeTools.set(toolId, { name: tool.name, status: tool.status });
        }
      }
      character.workActivity = event.isWaiting ? 'waiting' : character.activeTools.size > 0
        ? toolActivity([...character.activeTools.values()][0].status) : 'idle';
      character.idleGoal = null;
      character.speechBubble = undefined;
      setDestination(character, character.deskX, character.deskY + 16);
      break;
  }
  resolveState(character);
  if (character.sitProgress === 0) {
    office.interactions.releaseCharacter(character.id, (type) => character.idleGoal !== type);
  }
}