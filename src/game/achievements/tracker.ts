/**
 * EverRoad — achievement tracker.
 *
 * Evaluates achievement conditions against the current game/runtime state,
 * unlocks new achievements, grants their rewards, and reports progress.
 * Designed to be called every frame-ish: already-unlocked defs are skipped
 * via a module-level Set cache kept in sync with state.achievements.
 */

import type { AchievementDef, GameState, RuntimeState } from '../../types';
import { ACHIEVEMENTS } from './definitions';

// ---------------------------------------------------------------------------
// Unlocked-id cache
// ---------------------------------------------------------------------------

/**
 * Cache of unlocked ids mirroring state.achievements. Rebuilt whenever the
 * array identity or length no longer matches what we last saw (e.g. after a
 * save import, prestige, or reset swaps/edits the array behind our back).
 */
let cachedArray: string[] | null = null;
let cachedLength = -1;
let unlockedSet = new Set<string>();

function syncUnlockedCache(state: GameState): void {
  const arr = state.achievements;
  if (arr === cachedArray && arr.length === cachedLength) return;
  unlockedSet = new Set(arr);
  cachedArray = arr;
  cachedLength = arr.length;
}

/** All valid achievement ids, for progress counting against stale saves. */
const ALL_IDS: ReadonlySet<string> = new Set(ACHIEVEMENTS.map((d) => d.id));

/** Shared empty result to avoid per-call allocation on the hot path. */
const NO_UNLOCKS: AchievementDef[] = [];

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/**
 * Evaluate all locked achievements against the current state. Newly satisfied
 * ones are unlocked (their ids pushed into state.achievements), their rewards
 * granted into state.currencies (reward coins also count toward
 * stats.lifetimeCoins), and the newly-unlocked defs returned.
 *
 * Returns a shared empty array when nothing unlocked — do not mutate it.
 */
export function checkAchievements(state: GameState, runtime: RuntimeState): AchievementDef[] {
  syncUnlockedCache(state);

  let newlyUnlocked: AchievementDef[] | null = null;

  for (let i = 0; i < ACHIEVEMENTS.length; i++) {
    const def = ACHIEVEMENTS[i];
    if (unlockedSet.has(def.id)) continue;
    if (!def.condition(state, runtime)) continue;

    // Unlock.
    state.achievements.push(def.id);
    unlockedSet.add(def.id);
    cachedLength = state.achievements.length;

    // Grant reward. Coin and token bounties count as earned currency, so
    // they can chain into wealth/prestige achievements later in this same
    // pass (defs are ordered by ascending tier within each ladder).
    const reward = def.reward;
    if (reward) {
      if (reward.coins) {
        state.currencies.coins += reward.coins;
        state.stats.lifetimeCoins += reward.coins;
      }
      if (reward.tokens) {
        state.currencies.tokens += reward.tokens;
        state.stats.totalTokensEarned += reward.tokens;
      }
      if (reward.relics) {
        state.currencies.relics += reward.relics;
      }
    }

    (newlyUnlocked ??= []).push(def);
  }

  return newlyUnlocked ?? NO_UNLOCKS;
}

/**
 * Unlock progress. Counts only ids that map to a known definition, so stale
 * ids in an imported save cannot push progress past the total.
 */
export function getProgress(state: GameState): { unlocked: number; total: number } {
  let unlocked = 0;
  const ids = state.achievements;
  for (let i = 0; i < ids.length; i++) {
    if (ALL_IDS.has(ids[i])) unlocked++;
  }
  return { unlocked, total: ACHIEVEMENTS.length };
}
