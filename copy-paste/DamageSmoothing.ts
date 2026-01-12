/*
  Damage Smoothing / Damage Spreading
  Battlefield 6 Portal (30 Hz)
  Author: mindflexor

  Purpose:
  At 30 Hz, multiple damage events can resolve in a single frame,
  causing instant 100→0 deaths. This system redistributes damage
  over a short window without changing total damage dealt.
*/

import * as modlib from "modlib";

/* =================================================================================================
   CORE MODE STATE
   These are required because the smoothing logic depends on live server state
================================================================================================= */

// Battlefield Portal runs game logic in ticks (30 Hz in BF6 Portal)
const TICK_RATE = 30;

// Game status used by the mode
// In Domination: 3 === LIVE gameplay
let gameStatus: number = -1;

/* =================================================================================================
   SERVER PLAYER TRACKING
   Minimal Player object required for damage smoothing
================================================================================================= */

class Player {
  // Actual Portal player object
  public player: mod.Player;

  // Stable numeric ID (via modlib.getPlayerId)
  public id: number;

  // Whether this player is currently spawned in the world
  public isDeployed: boolean;

  constructor(player: mod.Player, id: number) {
    this.player = player;
    this.id = id;
    this.isDeployed = false;
  }
}

// All active players indexed by playerId
const serverPlayers = new Map<number, Player>();

/* =================================================================================================
   BASIC PLAYER HELPERS
================================================================================================= */

// Returns true if the soldier entity is alive
function isPlayerAlive(player: mod.Player): boolean {
  return mod.GetSoldierState(player, mod.SoldierStateBool.IsAlive);
}

// Returns the world position of a player (used for distance-based smoothing)
function getPlayerPosition(player: mod.Player): mod.Vector {
  return mod.GetSoldierState(player, mod.SoldierStateVector.GetPosition);
}

// Used to recover the damage giver later for proper kill credit
function findServerPlayerByObjId(playerObjId: number): Player | undefined {
  let found: Player | undefined = undefined;

  serverPlayers.forEach((sp) => {
    if (!sp) return;
    if (!mod.IsPlayerValid(sp.player)) return;

    // ObjId comparison lets us track the original attacker
    if (mod.GetObjId(sp.player) === playerObjId) {
      found = sp;
    }
  });

  return found;
}

/* =================================================================================================
   DAMAGE SMOOTHING CONFIGURATION
================================================================================================= */

// Distance buckets (meters)
const DMG_SPREAD_CLOSE_MAX_DIST = 10;
const DMG_SPREAD_MID_MAX_DIST = 25;

// Base smoothing durations (seconds)
// Close range = more smoothing (bursty weapons)
// Long range = less smoothing (snipers feel snappy)
const DMG_SPREAD_CLOSE_SEC = 2.0; // 0–10 m
const DMG_SPREAD_MID_SEC   = 1.8; // 10–25 m
const DMG_SPREAD_FAR_SEC   = 1.6; // 25 m+

// Health-based delay scaling
// High health = slower spread
// Low health  = faster spread (prevents “invincible” feeling)
const DMG_SPREAD_HEALTH_DELAY_MIN_FACTOR = 0.45;
const DMG_SPREAD_HEALTH_DELAY_MAX_FACTOR = 1.0;

/* =================================================================================================
   DAMAGE SMOOTHING STATE
================================================================================================= */

// Cached health from previous tick (per player)
let dmgLastHealth: { [playerId: number]: number } = {};

// Total queued damage waiting to be re-applied
let dmgQueued: { [playerId: number]: number } = {};

// How many ticks remain to apply the queued damage
let dmgQueuedTicksLeft: { [playerId: number]: number } = {};

// ObjId of original attacker (used for kill credit)
let dmgQueuedGiverObjId: { [playerId: number]: number } = {};

// Tracks which players currently need smoothing work
let dmgActive: { [playerId: number]: boolean } = {};
let dmgActiveIds: number[] = [];

// Guard flag so our own DealDamage() calls don’t re-trigger smoothing
let dmgIsReapplying: { [playerId: number]: boolean } = {};

/* =================================================================================================
   DAMAGE SMOOTHING HELPERS
================================================================================================= */

// Normalized health (0–1)
function dmgGetNormalizedHealth(player: mod.Player): number {
  return mod.GetSoldierState(player, mod.SoldierStateNumber.NormalizedHealth);
}

// Current raw health value
function dmgGetCurrentHealth(player: mod.Player): number {
  return mod.GetSoldierState(player, mod.SoldierStateNumber.CurrentHealth);
}

// Applies health-based scaling to the smoothing duration
function dmgSpreadApplyHealthDelayScale(
  baseTicks: number,
  normalizedHealth: number
): number {
  let h = normalizedHealth;

  // Manual clamp (Portal SDK safe)
  if (typeof h !== "number" || !Number.isFinite(h)) h = 1;
  if (h < 0) h = 0;
  if (h > 1) h = 1;

  const factor =
    DMG_SPREAD_HEALTH_DELAY_MIN_FACTOR +
    (DMG_SPREAD_HEALTH_DELAY_MAX_FACTOR - DMG_SPREAD_HEALTH_DELAY_MIN_FACTOR) * h;

  const scaled = mod.Ceiling(baseTicks * factor);
  return scaled < 1 ? 1 : scaled;
}

// Marks a player as actively being smoothed
function dmgMarkActive(id: number): void {
  if (dmgActive[id]) return;
  dmgActive[id] = true;
  dmgActiveIds.push(id);
}

// Removes a player from active smoothing
function dmgUnmarkActive(id: number): void {
  if (!dmgActive[id]) return;
  dmgActive[id] = false;

  const idx = dmgActiveIds.indexOf(id);
  if (idx >= 0) dmgActiveIds.splice(idx, 1);
}

// Converts seconds → ticks (30 Hz)
function dmgSpreadSecondsToTicks(sec: number): number {
  const raw = mod.Ceiling(sec * TICK_RATE);
  return raw < 1 ? 1 : raw;
}

// Distance between victim and attacker
function dmgSpreadDistanceMeters(
  victim: mod.Player,
  attacker: mod.Player
): number {
  if (!mod.IsPlayerValid(attacker)) return 99999;
  if (!isPlayerAlive(victim)) return 99999;
  if (!isPlayerAlive(attacker)) return 99999;

  return mod.DistanceBetween(
    getPlayerPosition(victim),
    getPlayerPosition(attacker)
  );
}

// Chooses smoothing duration based on distance
function dmgSpreadPickTicks(distanceMeters: number): number {
  if (distanceMeters <= DMG_SPREAD_CLOSE_MAX_DIST)
    return dmgSpreadSecondsToTicks(DMG_SPREAD_CLOSE_SEC);

  if (distanceMeters <= DMG_SPREAD_MID_MAX_DIST)
    return dmgSpreadSecondsToTicks(DMG_SPREAD_MID_SEC);

  return dmgSpreadSecondsToTicks(DMG_SPREAD_FAR_SEC);
}

/* =================================================================================================
   LIVE TICK FUNCTIONS
================================================================================================= */

// Updates health cache so we can measure deltas correctly
function dmgSpreadUpdateHealthCacheTick(): void {
  if (gameStatus !== 3) return;

  serverPlayers.forEach((sp) => {
    if (!sp || !sp.isDeployed) return;
    if (!mod.IsPlayerValid(sp.player)) return;
    if (!isPlayerAlive(sp.player)) return;

    dmgLastHealth[sp.id] = dmgGetCurrentHealth(sp.player);
  });
}

// Re-applies queued damage smoothly over time
function dmgSpreadProcessQueueTick(): void {
  if (gameStatus !== 3) return;
  if (dmgActiveIds.length === 0) return;

  for (let i = dmgActiveIds.length - 1; i >= 0; i--) {
    const id = dmgActiveIds[i];
    const sp = serverPlayers.get(id);

    // Player invalid or gone → cancel smoothing
    if (!sp || !sp.isDeployed || !mod.IsPlayerValid(sp.player) || !isPlayerAlive(sp.player)) {
      dmgQueued[id] = 0;
      dmgQueuedTicksLeft[id] = 0;
      dmgQueuedGiverObjId[id] = 0;
      dmgUnmarkActive(id);
      continue;
    }

    const remaining = dmgQueued[id] ?? 0;
    let ticksLeft = dmgQueuedTicksLeft[id] ?? 0;

    if (remaining <= 0 || ticksLeft <= 0) {
      dmgUnmarkActive(id);
      continue;
    }

    // Spread damage evenly across remaining ticks
    let step = mod.Ceiling(remaining / ticksLeft);
    if (step < 1) step = 1;
    if (step > remaining) step = remaining;

    const giverSp = dmgQueuedGiverObjId[id]
      ? findServerPlayerByObjId(dmgQueuedGiverObjId[id])
      : undefined;

    dmgIsReapplying[id] = true;
    if (giverSp && mod.IsPlayerValid(giverSp.player)) {
      mod.DealDamage(sp.player, step, giverSp.player);
    } else {
      mod.DealDamage(sp.player, step);
    }
    dmgIsReapplying[id] = false;

    dmgQueued[id] -= step;
    dmgQueuedTicksLeft[id]--;

    if (dmgQueued[id] <= 0) {
      dmgUnmarkActive(id);
    }
  }
}

/* =================================================================================================
   DAMAGE EVENT HOOK
================================================================================================= */

function OnPlayerDamaged(
  victim: mod.Player,
  attacker: mod.Player
): void {
  if (gameStatus !== 3) return;
  if (!mod.IsPlayerValid(victim)) return;
  if (!isPlayerAlive(victim)) return;

  const victimId = modlib.getPlayerId(victim);
  const sp = serverPlayers.get(victimId);
  if (!sp || !sp.isDeployed) return;

  const cur = dmgGetCurrentHealth(victim);

  // Ignore our own re-applied damage
  if (dmgIsReapplying[victimId]) {
    dmgLastHealth[victimId] = cur;
    return;
  }

  // Only smooth enemy damage
  if (!mod.IsPlayerValid(attacker) || mod.Equals(victim, attacker)) {
    dmgLastHealth[victimId] = cur;
    return;
  }

  if (mod.Equals(mod.GetTeam(victim), mod.GetTeam(attacker))) {
    dmgLastHealth[victimId] = cur;
    return;
  }

  const prev = dmgLastHealth[victimId];
  if (prev === undefined) {
    dmgLastHealth[victimId] = cur;
    return;
  }

  const delta = prev - cur;
  if (delta <= 0) {
    dmgLastHealth[victimId] = cur;
    return;
  }

  // Undo burst damage
  mod.Heal(victim, delta);
  dmgLastHealth[victimId] = prev;

  // Queue damage to be reapplied smoothly
  const dist = dmgSpreadDistanceMeters(victim, attacker);
  const baseTicks = dmgSpreadPickTicks(dist);
  const spreadTicks = dmgSpreadApplyHealthDelayScale(
    baseTicks,
    dmgGetNormalizedHealth(victim)
  );

  dmgQueued[victimId] = (dmgQueued[victimId] ?? 0) + delta;
  dmgQueuedTicksLeft[victimId] = spreadTicks;
  dmgQueuedGiverObjId[victimId] = mod.GetObjId(attacker);

  dmgMarkActive(victimId);
}
