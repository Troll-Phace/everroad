import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { createEventBus } from '../events';
import { RoadPath } from './roadPath';
import type { ChunkManager, Obstacle } from './chunks';
import { Pickups, type PickupDeps, CONSUMED_PRUNE_AT } from './pickups';
import type { Vehicle } from './vehicle';

/**
 * Near-miss scoring and the `nearMiss` bus event.
 *
 * The distinction these tests exist to hold: scoring is per obstacle, the
 * event is per frame. Seeded scenery clumping routinely puts two or three
 * registered obstacles inside the same +/-1.6 m award window, and the event's
 * only consumer is a one-shot whoosh that sums rather than reading as several
 * events (see the comment in pickups.ts and issue #75). Collapsing the event
 * back into the loop, or lifting the scoring out of it, must fail here.
 *
 * Determinism: coin patterns and the relic roll use Math.random, so the
 * harness parks the car far behind the first spawned pattern, disables the
 * magnet, and holds the relic chance and miles delta at 0. Nothing asserted
 * below depends on a random draw.
 */

/** Path distance the car is parked at. Chunk 0, and 145 m behind any coin. */
const CAR_S = 30;
/** One 60 Hz frame — far shorter than the combo duration the harness hands out. */
const DT = 1 / 60;
/** Combo gained per obstacle cleared, from Pickups.update's near-miss block. */
const NEAR_MISS_GAIN = 0.4;
/** Longitudinal half-width of the award window, in meters. */
const WINDOW_S = 1.6;

/**
 * Stand-in for the chunk source. The near-miss pass reads exactly two members
 * of ChunkManager; the rest of it builds scene geometry this path never
 * touches, so the cast below buys a real ChunkManager's worth of setup for
 * nothing.
 */
function fakeChunks() {
  const obstacles: Obstacle[] = [];
  const deadChunks = new Set<number>();
  const source = {
    *obstaclesNear(s: number, range: number): Generator<Obstacle> {
      // Mirrors ChunkManager.obstaclesNear: only what is inside `range`.
      for (const ob of obstacles) if (Math.abs(ob.s - s) <= range) yield ob;
    },
    hasChunk(index: number): boolean {
      return !deadChunks.has(index);
    },
  };
  return { obstacles, deadChunks, manager: source as unknown as ChunkManager };
}

/** The five members of Vehicle the pickups update reads. */
interface CarPose {
  s: number;
  lateral: number;
  speedMps: number;
  isActive: boolean;
  isDrifting: boolean;
}

function harness() {
  const bus = createEventBus();
  const events: { comboNow: number }[] = [];
  bus.on('nearMiss', (e) => events.push(e));
  const pickupEvents: { kind: string; value: number }[] = [];
  bus.on('pickup', (e) => pickupEvents.push(e));

  const chunks = fakeChunks();
  const deps = {
    // No magnet: spawned coins never drift onto the parked car, so coin
    // collection can never add combo behind an assertion's back.
    getMagnetRadius: vi.fn(() => 0),
    getPickupCoinValue: vi.fn(() => 1),
    // Keeps the Math.random relic roll from ever being reached.
    getRelicChancePerMile: vi.fn(() => 0),
    getComboCap: vi.fn(() => 10),
    getComboDuration: vi.fn(() => 4),
    onCoins: vi.fn(),
    onRelic: vi.fn(),
    onNearMiss: vi.fn(),
  } satisfies PickupDeps;

  const car: CarPose = { s: CAR_S, lateral: 0, speedMps: 30, isActive: true, isDrifting: false };
  const scene = new THREE.Scene();
  const pickups = new Pickups(scene, new RoadPath(7), chunks.manager, bus, deps);

  return {
    pickups,
    car,
    deps,
    events,
    pickupEvents,
    obstacles: chunks.obstacles,
    deadChunks: chunks.deadChunks,
    /**
     * One frame. `car` is a literal rather than a Vehicle because Vehicle
     * carries private state and a real Input (which needs `window`); the
     * near-miss pass only ever reads the five members of CarPose.
     */
    frame(dt = DT): void {
      pickups.update(dt, car as unknown as Vehicle, 0);
    },
  };
}

/**
 * An obstacle inside the award window: `ds` meters along the road from the
 * car, and offset laterally so the gap past its radius (0.9 m) sits inside the
 * (-0.2, 1.9) band that counts as threading it.
 */
function inWindow(key: string, ds = 0): Obstacle {
  return { key, s: CAR_S + ds, lateral: 1.4, radius: 0.5 };
}

describe('Pickups near-miss events', () => {
  it('emits one event for three obstacles cleared in the same frame', () => {
    const h = harness();
    h.obstacles.push(inWindow('0:0', -0.9), inWindow('0:1', 0), inWindow('0:2', 0.9));

    h.frame();

    expect(h.events).toHaveLength(1);
  });

  it('still scores every obstacle cleared in a coalesced frame', () => {
    const h = harness();
    h.obstacles.push(inWindow('0:0', -0.9), inWindow('0:1', 0), inWindow('0:2', 0.9));

    h.frame();

    // One event, but three obstacles missed: the stat counts obstacles, and
    // threading three clumped rocks pays three times.
    expect(h.deps.onNearMiss).toHaveBeenCalledTimes(3);
    expect(h.pickups.combo).toBeCloseTo(1 + 3 * NEAR_MISS_GAIN, 10);
  });

  it('reports the combo after every gain of the frame, not an intermediate one', () => {
    const h = harness();
    h.obstacles.push(inWindow('0:0', -0.9), inWindow('0:1', 0), inWindow('0:2', 0.9));

    h.frame();

    expect(h.events[0].comboNow).toBeCloseTo(1 + 3 * NEAR_MISS_GAIN, 10);
    expect(h.events[0].comboNow).toBeCloseTo(h.pickups.combo, 10);
    // Not the value after the first gain, which is what per-obstacle emits
    // put on the first event.
    expect(h.events[0].comboNow).not.toBeCloseTo(1 + NEAR_MISS_GAIN, 3);
  });

  it('emits one event for a single obstacle', () => {
    const h = harness();
    h.obstacles.push(inWindow('0:0'));

    h.frame();

    expect(h.events).toEqual([{ comboNow: 1 + NEAR_MISS_GAIN }]);
    expect(h.deps.onNearMiss).toHaveBeenCalledTimes(1);
  });

  it('emits one event per frame when obstacles are cleared in separate frames', () => {
    const h = harness();
    h.obstacles.push(inWindow('0:0'), { key: '0:1', s: CAR_S + 10, lateral: 1.4, radius: 0.5 });

    h.frame();
    // The car drives on to the second obstacle: a genuine slalom, which must
    // not be swallowed by a time-window throttle.
    h.car.s += 10;
    h.frame();

    expect(h.events).toHaveLength(2);
    expect(h.events[0].comboNow).toBeCloseTo(1 + NEAR_MISS_GAIN, 10);
    expect(h.events[1].comboNow).toBeCloseTo(1 + 2 * NEAR_MISS_GAIN, 10);
    expect(h.deps.onNearMiss).toHaveBeenCalledTimes(2);
  });
});

describe('Pickups near-miss award window', () => {
  it('awards nothing when no obstacle is near the car', () => {
    const h = harness();
    h.obstacles.push({ key: '0:0', s: CAR_S + 40, lateral: 1.4, radius: 0.5 });

    h.frame();

    expect(h.events).toHaveLength(0);
    expect(h.deps.onNearMiss).not.toHaveBeenCalled();
    expect(h.pickups.combo).toBe(1);
  });

  it('awards just inside the longitudinal window but not just outside it', () => {
    const inside = harness();
    inside.obstacles.push(inWindow('0:0', WINDOW_S - 0.01));
    inside.frame();
    expect(inside.events).toHaveLength(1);

    const outside = harness();
    outside.obstacles.push(inWindow('0:0', WINDOW_S + 0.01));
    outside.frame();
    expect(outside.events).toHaveLength(0);
    expect(outside.pickups.combo).toBe(1);
  });

  it('awards nothing for an obstacle passed too wide or driven into', () => {
    const wide = harness();
    // gap = 2.4 - 0.5 = 1.9: not a near miss, just a car in its own lane.
    wide.obstacles.push({ key: '0:0', s: CAR_S, lateral: 2.4, radius: 0.5 });
    wide.frame();
    expect(wide.events).toHaveLength(0);

    const hit = harness();
    // gap = 0.25 - 0.5 = -0.25: overlapping the obstacle, not clearing it.
    hit.obstacles.push({ key: '0:0', s: CAR_S, lateral: 0.25, radius: 0.5 });
    hit.frame();
    expect(hit.events).toHaveLength(0);
    expect(hit.deps.onNearMiss).not.toHaveBeenCalled();
  });

  it('awards nothing below the speed gate, and awards once above it', () => {
    const h = harness();
    h.obstacles.push(inWindow('0:0'));
    h.car.speedMps = 9;

    h.frame();

    expect(h.events).toHaveLength(0);
    expect(h.pickups.combo).toBe(1);

    // The same obstacle pays the moment the car is over the gate, so the
    // silence above was the gate and not the placement.
    h.car.speedMps = 9.01;
    h.frame();
    expect(h.events).toHaveLength(1);
  });

  it('awards nothing while the car is on autopilot', () => {
    const h = harness();
    h.obstacles.push(inWindow('0:0'));
    h.car.isActive = false;

    h.frame();

    expect(h.events).toHaveLength(0);
    expect(h.deps.onNearMiss).not.toHaveBeenCalled();
    expect(h.pickups.combo).toBe(1);
  });
});

describe('Pickups near-miss dedupe', () => {
  it('pays an obstacle once even while it stays inside the window', () => {
    const h = harness();
    h.obstacles.push(inWindow('0:0'));

    h.frame();
    const comboAfterFirst = h.pickups.combo;
    h.frame();
    h.frame();

    expect(h.events).toHaveLength(1);
    expect(h.deps.onNearMiss).toHaveBeenCalledTimes(1);
    expect(h.pickups.combo).toBe(comboAfterFirst);
  });

  it('keeps obstacles consumed when the dedupe map is pruned under them', () => {
    const h = harness();
    // Enough distinct obstacles in one pass to push the dedupe map past the
    // module's prune threshold (400 entries). Their chunk is still live, so
    // pruning must drop nothing: clearing wholesale would re-arm every one of
    // them while they are still inside the window (issue #8).
    const overPrune = CONSUMED_PRUNE_AT + 50;
    for (let i = 0; i < overPrune; i++) h.obstacles.push(inWindow(`0:${i}`, (i % 30) * 0.05));

    h.frame();
    expect(h.events).toHaveLength(1);
    expect(h.deps.onNearMiss).toHaveBeenCalledTimes(overPrune);

    h.frame();

    expect(h.events).toHaveLength(1);
    expect(h.deps.onNearMiss).toHaveBeenCalledTimes(overPrune);
  });

  it('pays an obstacle again after a reset clears the dedupe', () => {
    const h = harness();
    h.obstacles.push(inWindow('0:0'));

    h.frame();
    h.pickups.reset(CAR_S);
    h.frame();

    expect(h.events).toEqual([
      { comboNow: 1 + NEAR_MISS_GAIN },
      // reset() drops the combo back to 1, so the second pass starts over.
      { comboNow: 1 + NEAR_MISS_GAIN },
    ]);
    expect(h.deps.onNearMiss).toHaveBeenCalledTimes(2);
  });
});
