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

  update(vehicle: Vehicle, dt: number): void {
    const car = vehicle.root;

    // Fixed chase rig: always directly behind + above; distance breathes
    // slightly with speed.
    const speedK = THREE.MathUtils.clamp(vehicle.speedMps / 55, 0, 1);
    const dist = 9.5 + speedK * 3.2;
    const height = 4.1 + speedK * 0.8;

    const heading = vehicle.yaw; // true yaw (rotation.y is Euler-clamped)
    const back = new THREE.Vector3(-Math.sin(heading), 0, -Math.cos(heading));

    const targetPos = tmpA
      .copy(car.position)
      .addScaledVector(back, dist)
      .add(tmpB.set(0, height, 0));

    // Critically damped follow.
    this.pos.x = THREE.MathUtils.damp(this.pos.x, targetPos.x, 4.2, dt);
    this.pos.y = THREE.MathUtils.damp(this.pos.y, targetPos.y, 3.4, dt);
    this.pos.z = THREE.MathUtils.damp(this.pos.z, targetPos.z, 4.2, dt);

    const lookTarget = tmpC
      .copy(car.position)
      .addScaledVector(back, -7)
      .add(tmpB.set(0, 1.6, 0));
    this.look.lerp(lookTarget, 1 - Math.exp(-6 * dt));

    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);

    // Speed-based FOV kick.
    const targetFov = 58 + speedK * 10 + (vehicle.isDrifting ? 3 : 0);
    this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, 3, dt);
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
