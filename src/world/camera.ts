import * as THREE from 'three';
import type { Vehicle } from './vehicle';

/**
 * Chase camera: floats behind and above the car, breathing with speed,
 * drifting into a lazy cinematic sway when the player idles.
 */
export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera;
  private pos = new THREE.Vector3(0, 6, -12);
  private look = new THREE.Vector3();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(58, aspect, 0.3, 9000);
    this.camera.position.copy(this.pos);
  }

  /**
   * Steady-state chase pose for the vehicle's current position and yaw.
   * Writes `outPos`/`outLook` and returns the 0..1 speed factor the rig's
   * distance, height and FOV all key off. Uses `tmpB` as scratch.
   */
  private rig(vehicle: Vehicle, outPos: THREE.Vector3, outLook: THREE.Vector3): number {
    const car = vehicle.root;

    // Fixed chase rig: always directly behind + above; distance breathes
    // slightly with speed.
    const speedK = THREE.MathUtils.clamp(vehicle.speedMps / 55, 0, 1);
    const dist = 9.5 + speedK * 3.2;
    const height = 4.1 + speedK * 0.8;

    const heading = vehicle.yaw; // true yaw (rotation.y is Euler-clamped)
    const back = tmpB.set(-Math.sin(heading), 0, -Math.cos(heading));

    outPos.copy(car.position).addScaledVector(back, dist);
    outPos.y += height;
    outLook.copy(car.position).addScaledVector(back, -7);
    outLook.y += 1.6;
    return speedK;
  }

  /** FOV the rig settles on at this speed. */
  private rigFov(vehicle: Vehicle, speedK: number): number {
    return 58 + speedK * 10 + (vehicle.isDrifting ? 3 : 0);
  }

  update(vehicle: Vehicle, dt: number): void {
    const speedK = this.rig(vehicle, tmpA, tmpC);

    // Critically damped follow.
    this.pos.x = THREE.MathUtils.damp(this.pos.x, tmpA.x, 4.2, dt);
    this.pos.y = THREE.MathUtils.damp(this.pos.y, tmpA.y, 3.4, dt);
    this.pos.z = THREE.MathUtils.damp(this.pos.z, tmpA.z, 4.2, dt);

    this.look.lerp(tmpC, 1 - Math.exp(-6 * dt));

    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);

    // Speed-based FOV kick.
    this.camera.fov = THREE.MathUtils.damp(this.camera.fov, this.rigFov(vehicle, speedK), 3, dt);
    this.camera.updateProjectionMatrix();
  }

  /**
   * Hard-set the rig to its steady-state pose for the vehicle right now, with
   * no damping. Called when leaving the main menu (docs/ARCHITECTURE.md §4.1):
   * without it the chase rig would lerp in from wherever the cinematic menu
   * camera left off, which reads as a swoop rather than a cut.
   */
  snapTo(vehicle: Vehicle): void {
    const speedK = this.rig(vehicle, this.pos, this.look);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
    this.camera.fov = this.rigFov(vehicle, speedK);
    this.camera.updateProjectionMatrix();
  }

  shiftOrigin(dx: number, dz: number): void {
    this.pos.x += dx;
    this.pos.z += dz;
    this.look.x += dx;
    this.look.z += dz;
    this.camera.position.copy(this.pos);
  }
}

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();
