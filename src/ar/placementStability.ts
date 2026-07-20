import { Vector3 } from "three";

export interface PlacementStabilityOptions {
  minimumSamples: number;
  minimumStableDurationMs: number;
  sampleWindowMs: number;
  maximumPositionSpreadMeters: number;
  maximumNormalSpreadDegrees: number;
  minimumUpDot: number;
}

interface PlacementSample {
  position: Vector3;
  normal: Vector3;
  time: number;
}

const DEFAULT_OPTIONS: PlacementStabilityOptions = {
  minimumSamples: 5,
  minimumStableDurationMs: 120,
  sampleWindowMs: 450,
  maximumPositionSpreadMeters: 0.04,
  maximumNormalSpreadDegrees: 6,
  minimumUpDot: 0.85
};

export function isFloorFacingPose(
  matrix: ArrayLike<number>,
  minimumUpDot = DEFAULT_OPTIONS.minimumUpDot
) {
  return (matrix[5] ?? 0) >= minimumUpDot;
}

/**
 * Rejects isolated, tilted, or visibly jittering hit-test poses before the
 * reticle becomes selectable. WebXR matrices are column-major; their second
 * column is the hit surface's local Y axis (surface normal).
 */
export class PlacementStabilityTracker {
  private readonly options: PlacementStabilityOptions;
  private readonly samples: PlacementSample[] = [];
  private readonly meanPosition = new Vector3();
  private readonly meanNormal = new Vector3();

  constructor(options: Partial<PlacementStabilityOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  update(matrix: ArrayLike<number>, time: number) {
    const position = new Vector3(matrix[12] ?? 0, matrix[13] ?? 0, matrix[14] ?? 0);
    const normal = new Vector3(matrix[4] ?? 0, matrix[5] ?? 1, matrix[6] ?? 0).normalize();

    if (!isFloorFacingPose(matrix, this.options.minimumUpDot)) {
      this.reset();
      return false;
    }

    this.samples.push({ position, normal, time });

    const oldestAllowedTime = time - this.options.sampleWindowMs;
    while ((this.samples[0]?.time ?? time) < oldestAllowedTime) {
      this.samples.shift();
    }

    const firstSample = this.samples[0];
    if (
      !firstSample ||
      this.samples.length < this.options.minimumSamples ||
      time - firstSample.time < this.options.minimumStableDurationMs
    ) {
      return false;
    }

    this.meanPosition.set(0, 0, 0);
    this.meanNormal.set(0, 0, 0);
    this.samples.forEach((sample) => {
      this.meanPosition.add(sample.position);
      this.meanNormal.add(sample.normal);
    });
    this.meanPosition.multiplyScalar(1 / this.samples.length);
    this.meanNormal.normalize();

    const minimumNormalDot = Math.cos(
      (this.options.maximumNormalSpreadDegrees * Math.PI) / 180
    );

    return this.samples.every(
      (sample) =>
        sample.position.distanceTo(this.meanPosition) <=
          this.options.maximumPositionSpreadMeters &&
        sample.normal.dot(this.meanNormal) >= minimumNormalDot
    );
  }

  reset() {
    this.samples.length = 0;
  }
}
