import * as THREE from 'three';
import { AUTOPILOT_CRUISE_FRACTION, type EventBus } from '../types';
import type { Input } from '../engine/input';
import { RoadPath, ROAD_HALF_WIDTH } from './roadPath';
import { buildCar, animateCar, disposeCar, hoverBob, type CarRig } from './car';
import type { CarStyle } from '../types';

const MPH_TO_MPS = 0.44704;
/** How far onto the shoulder the car may wander. */
const MAX_LATERAL = 6.6;

/**
 * The player's car: autopilot cruiser + manual steering + drift-lite.
 * Lives at (s, lateral) on the RoadPath.
 */
export class Vehicle {
  s = 5;
  lateral = 0;
  speedMps = 0;
  isDrifting = false;
  driftMiles = 0;
  driftPeakCombo = 1;
  /** Visual-only yaw offset while drifting (radians). */
  private driftYaw = 0;
  /**
   * True world yaw of the car this frame. The camera must use this, never
   * root.rotation.y — Euler XYZ decomposition clamps y to ±90°, which made
   * the camera orbit to the car's front whenever the road heading wound past
   * a quarter turn.
   */
  yaw = 0;
  private latVel = 0;
  private time = 0;
  rig: CarRig;
  readonly root = new THREE.Group();

  constructor(
    private path: RoadPath,
    private input: Input,
    private bus: EventBus,
    /** Cruise speed in mph from the economy (car + upgrades). */
    private getCruiseMph: () => number,
    /** Current combo, read for drift bookkeeping. */
    private getCombo: () => number,
    initialStyle: CarStyle,
  ) {
    this.rig = buildCar(initialStyle);
    this.root.add(this.rig.group);
  }

  get speedMph(): number {
    return this.speedMps / MPH_TO_MPS;
  }

  get isActive(): boolean {
    return this.input.isActive;
  }

  setStyle(style: CarStyle): void {
    this.root.remove(this.rig.group);
    disposeCar(this.rig);
    this.rig = buildCar(style);
    this.root.add(this.rig.group);
  }

  shiftOrigin(dx: number, dz: number): void {
    // root.position was computed from the pre-shift path this frame; carry it
    // along so the frame renders consistently. The next update() recomputes
    // it from the (already shifted) path.
    this.root.position.x += dx;
    this.root.position.z += dz;
  }

  update(dt: number): void {
    this.time += dt;
    const active = this.input.isActive;
    const cruise = this.getCruiseMph() * MPH_TO_MPS;

    // ---- speed ----
    // The car's stated speed is a hard ceiling. Autopilot cruises a touch
    // under it; holding W tops it out, S brakes down to ~40%.
    let targetSpeed = cruise * AUTOPILOT_CRUISE_FRACTION;
    if (active) {
      const th = this.input.throttle;
      if (th > 0) targetSpeed = cruise;
      else if (th < 0) targetSpeed = cruise * (AUTOPILOT_CRUISE_FRACTION + 0.54 * th);
    }
    if (Math.abs(this.lateral) > ROAD_HALF_WIDTH + 0.6) targetSpeed *= 0.82; // shoulder rumble
    targetSpeed = Math.min(targetSpeed, cruise);
    const lambda = targetSpeed > this.speedMps ? 0.45 : 0.9;
    this.speedMps = Math.min(THREE.MathUtils.damp(this.speedMps, targetSpeed, lambda, dt), cruise);

    // ---- steering / lateral ----
    const steer = this.input.steer;
    const wantDrift = this.input.drift && active && Math.abs(steer) > 0 && this.speedMps > 13;
    if (wantDrift && !this.isDrifting) {
      this.isDrifting = true;
      this.driftMiles = 0;
      this.driftPeakCombo = this.getCombo();
    } else if (!wantDrift && this.isDrifting) {
      this.isDrifting = false;
      if (this.driftMiles > 0.003) {
        this.bus.emit('driftEnd', { miles: this.driftMiles, comboReached: this.driftPeakCombo });
      }
    }
    if (this.isDrifting) {
      this.driftMiles += (this.speedMps * dt) / 1609.34;
      this.driftPeakCombo = Math.max(this.driftPeakCombo, this.getCombo());
    }

    if (active) {
      const steerSpeed = (5.5 + this.speedMps * 0.16) * (this.isDrifting ? 1.55 : 1);
      this.latVel = THREE.MathUtils.damp(this.latVel, steer * steerSpeed, 10, dt);
    } else {
      // Autopilot: keep to the right lane with a gentle wander.
      const wander = Math.sin(this.s * 0.004 + 1.3) * 0.7 + Math.sin(this.s * 0.0013) * 0.5;
      const target = THREE.MathUtils.clamp(2.0 + wander, 0.8, 3.4);
      this.latVel = THREE.MathUtils.damp(this.latVel, (target - this.lateral) * 0.9, 4, dt);
    }
    this.lateral = THREE.MathUtils.clamp(
      this.lateral + this.latVel * dt,
      -MAX_LATERAL,
      MAX_LATERAL,
    );

    // ---- advance along road ----
    this.s += this.speedMps * dt;
    this.path.ensure(this.s + 80);

    // ---- drift visual yaw ----
    const targetYaw = this.isDrifting ? -steer * 0.42 : 0;
    this.driftYaw = THREE.MathUtils.damp(this.driftYaw, targetYaw, 8, dt);

    // ---- place mesh ----
    const pose = this.path.pose(this.s, poseScratch);
    const heading = pose.heading;
    // Same right-hand normal convention as RoadPath.point.
    const nx = -Math.cos(heading);
    const nz = Math.sin(heading);
    const y = pose.pos.y + hoverBob(this.rig, this.time);
    this.root.position.set(pose.pos.x + nx * this.lateral, y, pose.pos.z + nz * this.lateral);

    // Pitch from slope, roll from curvature + steering.
    const ahead = this.path.pose(this.s + 3, poseScratch2);
    const pitch = Math.atan2(ahead.pos.y - pose.pos.y, 3);
    const headingDelta = ahead.heading - heading;
    const roll =
      THREE.MathUtils.clamp(-headingDelta * this.speedMps * 0.05, -0.12, 0.12) +
      (this.isDrifting ? -steer * 0.06 : 0);

    this.yaw = heading + this.driftYaw + this.latVel * -0.012;
    this.root.rotation.set(0, 0, 0);
    this.root.rotateY(this.yaw);
    this.root.rotateX(-pitch);
    this.root.rotateZ(roll);

    animateCar(this.rig, this.speedMps, dt, this.time);
  }
}

const poseScratch = { pos: new THREE.Vector3(), heading: 0 };
const poseScratch2 = { pos: new THREE.Vector3(), heading: 0 };
