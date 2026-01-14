/*
  Damage Smoothing / Damage Spreading
  Battlefield 6 Portal (30 Hz)
  Author: mindflexor

  Purpose:
  At 30 Hz, multiple damage events can resolve in a single frame,
  causing instant 100→0 deaths. This system redistributes damage
  over a short window without changing total damage dealt.

  Key Notes:
  - serverPlayers is populated via OngoingPlayer (per-player tick callback).
  - isDeployed is maintained via OnPlayerDeployed / OnPlayerDied.
  - OnPlayerDamaged must be exported and must match SDK signature.
*/

import * as modlib from "modlib";

const TICK_RATE = 30;

/**
 * "Live" heuristic:
 * BF Portal SDK in this typing file doesn’t expose a simple GameStatus getter.
 * Using elapsed time is a practical way to avoid running during pre-round.
 */
function isMatchLive(): boolean {
  return mod.GetMatchTimeElapsed() > 0;
}

/* =================================================================================================
   SERVER PLAYER TRACKING
================================================================================================= */

class ServerPlayer {
  public player: mod.Player;
  public id: number;
  public isDeployed: boolean;

  constructor(player: mod.Player, id: number) {
    this.player = player;
    this.id = id;
    this.isDeployed = false;
  }
}

const serverPlayers = new Map<number, ServerPlayer>();

function getOrCreateServerPlayer(p: mod.Player): ServerPlayer {
  const id = modlib.getPlayerId(p);
  let sp = serverPlayers.get(id);
  if (!sp) {
    sp = new ServerPlayer(p, id);
    serverPlayers.set(id, sp);

    // Initialize caches for this player to avoid undefined behavior later
    dmgLastHealth[id] = dmgGetCurrentHealth(p);
    dmgQueued[id] = 0;
    dmgQueuedTicksLeft[id] = 0;
    dmgQueuedGiverObjId[id] = 0;
    dmgActive[id] = false;
    dmgIsReapplying[id] = false;
  } else {
    // Keep the underlying player reference fresh
    sp.player = p;
  }
  return sp;
}

/* =================================================================================================
   BASIC PLAYER HELPERS
================================================================================================= */

function isPlayerAlive(player: mod.Player): boolean {
  return mod.GetSoldierState(player, mod.SoldierStateBool.IsAlive);
}

function getPlayerPosition(player: mod.Player): mod.Vector {
  return mod.GetSoldierState(player, mod.SoldierStateVector.GetPosition);
}

function findServerPlayerByObjId(playerObjId: number): ServerPlayer | undefined {
  let found: ServerPlayer | undefined = undefined;

  serverPlayers.forEach((sp) => {
    if (!sp) return;
    if (!mod.IsPlayerValid(sp.player)) return;

    if (mod.GetObjId(sp.player) === playerObjId) {
      found = sp;
    }
  });

  return found;
}

/* =================================================================================================
   DAMAGE SMOOTHING CONFIGURATION
================================================================================================= */

const DMG_SPREAD_CLOSE_MAX_DIST = 10;
const DMG_SPREAD_MID_MAX_DIST = 25;

const DMG_SPREAD_CLOSE_SEC = 2.0; // 0–10 m
const DMG_SPREAD_MID_SEC = 1.8;   // 10–25 m
const DMG_SPREAD_FAR_SEC = 1.6;   // 25 m+

const DMG_SPREAD_HEALTH_DELAY_MIN_FACTOR = 0.45;
const DMG_SPREAD_HEALTH_DELAY_MAX_FACTOR = 1.0;

/**
 * Optional throttle:
 * Updating *all* deployed players’ health cache every single tick can be wasteful.
 * This runs the cache update every N ticks instead.
 */
const HEALTH_CACHE_UPDATE_EVERY_N_TICKS = 2; // 2 => 15 Hz; set to 1 for full 30 Hz
let gTickCounter = 0;

/* =================================================================================================
   DAMAGE SMOOTHING STATE
================================================================================================= */

let dmgLastHealth: { [playerId: number]: number } = {};
let dmgQueued: { [playerId: number]: number } = {};
let dmgQueuedTicksLeft: { [playerId: number]: number } = {};
let dmgQueuedGiverObjId: { [playerId: number]: number } = {};

let dmgActive: { [playerId: number]: boolean } = {};
let dmgActiveIds: number[] = [];

let dmgIsReapplying: { [playerId: number]: boolean } = {};

/* =================================================================================================
   DAMAGE SMOOTHING HELPERS
================================================================================================= */

function dmgGetNormalizedHealth(player: mod.Player): number {
  return mod.GetSoldierState(player, mod.SoldierStateNumber.NormalizedHealth);
}

function dmgGetCurrentHealth(player: mod.Player): number {
  return mod.GetSoldierState(player, mod.SoldierStateNumber.CurrentHealth);
}

function dmgSpreadApplyHealthDelayScale(baseTicks: number, normalizedHealth: number): number {
  let h = normalizedHealth;

  if (typeof h !== "number" || !Number.isFinite(h)) h = 1;
  if (h < 0) h = 0;
  if (h > 1) h = 1;

  const factor =
    DMG_SPREAD_HEALTH_DELAY_MIN_FACTOR +
    (DMG_SPREAD_HEALTH_DELAY_MAX_FACTOR - DMG_SPREAD_HEALTH_DELAY_MIN_FACTOR) * h;

  const scaled = mod.Ceiling(baseTicks * factor);
  return scaled < 1 ? 1 : scaled;
}

function dmgMarkActive(id: number): void {
  if (dmgActive[id]) return;
  dmgActive[id] = true;
  dmgActiveIds.push(id);
}

function dmgUnmarkActive(id: number): void {
  if (!dmgActive[id]) return;
  dmgActive[id] = false;

  const idx = dmgActiveIds.indexOf(id);
  if (idx >= 0) dmgActiveIds.splice(idx, 1);
}

function dmgSpreadSecondsToTicks(sec: number): number {
  const raw = mod.Ceiling(sec * TICK_RATE);
  return raw < 1 ? 1 : raw;
}

function dmgSpreadDistanceMeters(victim: mod.Player, attacker: mod.Player): number {
  if (!mod.IsPlayerValid(attacker)) return 99999;
  if (!isPlayerAlive(victim)) return 99999;
  if (!isPlayerAlive(attacker)) return 99999;

  return mod.DistanceBetween(getPlayerPosition(victim), getPlayerPosition(attacker));
}

function dmgSpreadPickTicks(distanceMeters: number): number {
  if (distanceMeters <= DMG_SPREAD_CLOSE_MAX_DIST) {
    return dmgSpreadSecondsToTicks(DMG_SPREAD_CLOSE_SEC);
  }
  if (distanceMeters <= DMG_SPREAD_MID_MAX_DIST) {
    return dmgSpreadSecondsToTicks(DMG_SPREAD_MID_SEC);
  }
  return dmgSpreadSecondsToTicks(DMG_SPREAD_FAR_SEC);
}

/* =================================================================================================
   LIVE TICK FUNCTIONS
================================================================================================= */

function dmgSpreadUpdateHealthCacheTick(): void {
  if (!isMatchLive()) return;

  serverPlayers.forEach((sp) => {
    if (!sp || !sp.isDeployed) return;
    if (!mod.IsPlayerValid(sp.player)) return;
    if (!isPlayerAlive(sp.player)) return;

    dmgLastHealth[sp.id] = dmgGetCurrentHealth(sp.player);
  });
}

function dmgSpreadProcessQueueTick(): void {
  if (!isMatchLive()) return;
  if (dmgActiveIds.length === 0) return;

  for (let i = dmgActiveIds.length - 1; i >= 0; i--) {
    const id = dmgActiveIds[i];
    const sp = serverPlayers.get(id);

    if (!sp || !sp.isDeployed || !mod.IsPlayerValid(sp.player) || !isPlayerAlive(sp.player)) {
      dmgQueued[id] = 0;
      dmgQueuedTicksLeft[id] = 0;
      dmgQueuedGiverObjId[id] = 0;
      dmgUnmarkActive(id);
      continue;
    }

    const remaining = dmgQueued[id] ?? 0;
    const ticksLeft = dmgQueuedTicksLeft[id] ?? 0;

    if (remaining <= 0 || ticksLeft <= 0) {
      dmgUnmarkActive(id);
      continue;
    }

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
    dmgQueuedTicksLeft[id] -= 1;

    if (dmgQueued[id] <= 0 || dmgQueuedTicksLeft[id] <= 0) {
      dmgUnmarkActive(id);
    }
  }
}

/* =================================================================================================
   EVENT HANDLERS (MUST BE EXPORTED + MATCH SDK SIGNATURES)
================================================================================================= */

/**
 * Runs once per player per tick. Perfect place to ensure serverPlayers is populated.
 */
export function OngoingPlayer(eventPlayer: mod.Player): void {
  if (!mod.IsPlayerValid(eventPlayer)) return;
  getOrCreateServerPlayer(eventPlayer);
}

/**
 * Called when player deploys (spawns).
 */
export function OnPlayerDeployed(eventPlayer: mod.Player): void {
  if (!mod.IsPlayerValid(eventPlayer)) return;
  const sp = getOrCreateServerPlayer(eventPlayer);
  sp.isDeployed = true;

  // Seed health cache immediately on deploy
  dmgLastHealth[sp.id] = dmgGetCurrentHealth(eventPlayer);

  // Clear any stale queue from prior life
  dmgQueued[sp.id] = 0;
  dmgQueuedTicksLeft[sp.id] = 0;
  dmgQueuedGiverObjId[sp.id] = 0;
  dmgUnmarkActive(sp.id);
}

/**
 * Called when player dies.
 */
export function OnPlayerDied(eventPlayer: mod.Player): void {
  if (!mod.IsPlayerValid(eventPlayer)) return;
  const sp = getOrCreateServerPlayer(eventPlayer);
  sp.isDeployed = false;

  // Clear queue so we don't keep processing dead players
  dmgQueued[sp.id] = 0;
  dmgQueuedTicksLeft[sp.id] = 0;
  dmgQueuedGiverObjId[sp.id] = 0;
  dmgUnmarkActive(sp.id);
}

/**
 * IMPORTANT:
 * This must be exported, and must include (damageType, weaponUnlock) per your SDK typing.
 */
export function OnPlayerDamaged(
  eventPlayer: mod.Player,       // victim
  eventOtherPlayer: mod.Player,  // attacker
  _eventDamageType: mod.DamageType,
  _eventWeaponUnlock: mod.WeaponUnlock
): void {
  if (!isMatchLive()) return;
  if (!mod.IsPlayerValid(eventPlayer)) return;
  if (!isPlayerAlive(eventPlayer)) return;

  const victimSp = getOrCreateServerPlayer(eventPlayer);
  if (!victimSp.isDeployed) return;

  const victimId = victimSp.id;
  const cur = dmgGetCurrentHealth(eventPlayer);

  // Ignore our own re-applied damage
  if (dmgIsReapplying[victimId]) {
    dmgLastHealth[victimId] = cur;
    return;
  }

  // Only smooth enemy damage (ignore self, invalid, or friendly)
  if (!mod.IsPlayerValid(eventOtherPlayer) || mod.Equals(eventPlayer, eventOtherPlayer)) {
    dmgLastHealth[victimId] = cur;
    return;
  }

  if (mod.Equals(mod.GetTeam(eventPlayer), mod.GetTeam(eventOtherPlayer))) {
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

  // Undo burst damage immediately
  mod.Heal(eventPlayer, delta);

  // Keep "previous" as the baseline so multiple hits in the same frame get collected
  dmgLastHealth[victimId] = prev;

  // Queue damage to be re-applied smoothly
  const dist = dmgSpreadDistanceMeters(eventPlayer, eventOtherPlayer);
  const baseTicks = dmgSpreadPickTicks(dist);
  const spreadTicks = dmgSpreadApplyHealthDelayScale(baseTicks, dmgGetNormalizedHealth(eventPlayer));

  dmgQueued[victimId] = (dmgQueued[victimId] ?? 0) + delta;
  dmgQueuedTicksLeft[victimId] = spreadTicks;
  dmgQueuedGiverObjId[victimId] = mod.GetObjId(eventOtherPlayer);

  dmgMarkActive(victimId);
}

/* =================================================================================================
   GLOBAL TICK
================================================================================================= */

export function OngoingGlobal(): void {
  gTickCounter++;

  // Cheap per-tick: only touches victims currently being smoothed
  dmgSpreadProcessQueueTick();

  // Throttled scan: updates health cache every N ticks
  if (HEALTH_CACHE_UPDATE_EVERY_N_TICKS <= 1 || (gTickCounter % HEALTH_CACHE_UPDATE_EVERY_N_TICKS) === 0) {
    dmgSpreadUpdateHealthCacheTick();
  }
}
