import { Vector3 } from "three";

export interface FloorHitSmoothingOptions {
  responseTimeMs: number;
  maximumSpeedMetersPerSecond: number;
  deadZoneMeters: number;
}

const DEFAULT_OPTIONS: FloorHitSmoothingOptions = {
  responseTimeMs: 90,
  maximumSpeedMetersPerSecond: 2.5,
  deadZoneMeters: 0.006
};

/**
 * Converts noisy hit-test translations into a responsive, upright floor pose.
 * A speed limit prevents switching between the center and floor-biased rays
 * from teleporting the reticle across the room.
 */
export class FloorHitPoseSmoother {
  readonly position = new Vector3();

  private readonly options: FloorHitSmoothingOptions;
  private readonly targetPosition = new Vector3();
  private readonly delta = new Vector3();
  private initialized = false;
  private lastUpdateTime = 0;

  constructor(options: Partial<FloorHitSmoothingOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  update(source: ArrayLike<number>, time: number, target: Float32Array) {
    this.targetPosition.set(source[12] ?? 0, source[13] ?? 0, source[14] ?? 0);

    if (!this.initialized) {
      this.position.copy(this.targetPosition);
      this.initialized = true;
    } else {
      const elapsedMs = Math.min(50, Math.max(8, time - this.lastUpdateTime));
      this.delta.copy(this.targetPosition).sub(this.position);
      const distance = this.delta.length();

      if (distance > this.options.deadZoneMeters) {
        const alpha = 1 - Math.exp(-elapsedMs / this.options.responseTimeMs);
        const maximumStep =
          this.options.maximumSpeedMetersPerSecond * (elapsedMs / 1000);
        const step = Math.min(distance * alpha, maximumStep);
        this.position.addScaledVector(this.delta, step / distance);
      }
    }

    this.lastUpdateTime = time;
    writeUprightMatrix(this.position, target);
    return target;
  }

  reset() {
    this.initialized = false;
    this.lastUpdateTime = 0;
  }
}

export function writeUprightMatrix(position: Vector3, target: Float32Array) {
  target.fill(0);
  target[0] = 1;
  target[5] = 1;
  target[10] = 1;
  target[12] = position.x;
  target[13] = position.y;
  target[14] = position.z;
  target[15] = 1;
}

export function getCameraFacingYaw(
  placementMatrix: ArrayLike<number>,
  viewerPosition: Vector3,
  fallbackYaw = 0
) {
  const deltaX = viewerPosition.x - (placementMatrix[12] ?? 0);
  const deltaZ = viewerPosition.z - (placementMatrix[14] ?? 0);

  if (Math.hypot(deltaX, deltaZ) < 0.001) {
    return fallbackYaw;
  }

  // The model-level forward correction maps mascot forward to root +Z.
  return Math.atan2(deltaX, deltaZ);
}

export function offsetFloorHitAwayFromViewer(
  source: ArrayLike<number>,
  viewerPosition: Vector3,
  distanceMeters: number,
  target: Float32Array
) {
  const hitX = source[12] ?? 0;
  const hitY = source[13] ?? 0;
  const hitZ = source[14] ?? 0;
  const deltaX = hitX - viewerPosition.x;
  const deltaZ = hitZ - viewerPosition.z;
  const horizontalDistance = Math.hypot(deltaX, deltaZ);

  target.fill(0);
  target[0] = 1;
  target[5] = 1;
  target[10] = 1;
  target[12] =
    horizontalDistance > 0.001
      ? hitX + (deltaX / horizontalDistance) * distanceMeters
      : hitX;
  target[13] = hitY;
  target[14] =
    horizontalDistance > 0.001
      ? hitZ + (deltaZ / horizontalDistance) * distanceMeters
      : hitZ;
  target[15] = 1;

  return target;
}
