import { MathUtils, Matrix4, Quaternion, Vector3, type Object3D } from "three";

/**
 * Keeps each target's content inside its own MindAR anchor hierarchy. MindAR
 * owns the anchor matrix, so direct parenting prevents poses from being copied
 * or accidentally reassigned between simultaneously tracked targets.
 */
export function bindContentToImageAnchor(anchorGroup: Object3D, contentRoot: Object3D) {
  contentRoot.position.set(0, 0, 0);
  contentRoot.quaternion.identity();
  contentRoot.scale.set(1, 1, 1);
  contentRoot.matrixAutoUpdate = true;
  anchorGroup.add(contentRoot);
}

/**
 * Smooths one MindAR anchor in place while retaining its latest raw pose as a
 * target. Each instance owns exactly one anchor, so simultaneous markers can
 * never share pose state or move another marker's model.
 */
export class SmoothedImageAnchorBinding {
  private initialized = false;
  private readonly position = new Vector3();
  private readonly rotation = new Quaternion();
  private readonly scale = new Vector3();
  private readonly targetPosition = new Vector3();
  private readonly targetRotation = new Quaternion();
  private readonly targetScale = new Vector3();
  private readonly glideStartPosition = new Vector3();
  private readonly glideStartRotation = new Quaternion();
  private readonly glideStartScale = new Vector3();
  private readonly lastWrittenMatrix = new Matrix4();
  private reacquisitionPending = false;
  private reacquisitionActive = false;
  private reacquisitionElapsedSeconds = 0;
  private reacquisitionDurationSeconds = REACQUISITION_MIN_DURATION_SECONDS;

  constructor(
    private readonly anchorGroup: Object3D,
    contentRoot: Object3D
  ) {
    bindContentToImageAnchor(anchorGroup, contentRoot);
  }

  beginReacquisition() {
    if (this.initialized) {
      this.reacquisitionPending = true;
    }
  }

  update(deltaSeconds: number) {
    if (!this.anchorGroup.matrix.elements.every(Number.isFinite)) {
      return false;
    }

    if (
      !this.initialized ||
      this.reacquisitionPending ||
      !matricesAlmostEqual(this.anchorGroup.matrix, this.lastWrittenMatrix)
    ) {
      this.anchorGroup.matrix.decompose(this.targetPosition, this.targetRotation, this.targetScale);

      if (!hasValidScale(this.targetScale)) {
        return false;
      }

      if (this.reacquisitionPending && this.initialized) {
        this.startReacquisitionGlide();
      }
    }

    if (!this.initialized) {
      this.position.copy(this.targetPosition);
      this.rotation.copy(this.targetRotation);
      this.scale.copy(this.targetScale);
      this.initialized = true;
    } else if (this.reacquisitionActive) {
      this.updateReacquisitionGlide(deltaSeconds);
    } else {
      smoothVector(
        this.position,
        this.targetPosition,
        deltaSeconds,
        POSITION_DEAD_ZONE,
        POSITION_FAST_DISTANCE,
        POSITION_SLOW_SPEED,
        POSITION_FAST_SPEED
      );
      smoothRotation(this.rotation, this.targetRotation, deltaSeconds);
      smoothVector(
        this.scale,
        this.targetScale,
        deltaSeconds,
        SCALE_DEAD_ZONE,
        SCALE_FAST_DISTANCE,
        SCALE_SLOW_SPEED,
        SCALE_FAST_SPEED
      );
    }

    this.anchorGroup.matrix.compose(this.position, this.rotation, this.scale);
    this.anchorGroup.matrixWorldNeedsUpdate = true;
    this.lastWrittenMatrix.copy(this.anchorGroup.matrix);

    return true;
  }

  private startReacquisitionGlide() {
    const requestedDuration = Math.max(
      this.position.distanceTo(this.targetPosition) / REACQUISITION_POSITION_UNITS_PER_SECOND,
      this.rotation.angleTo(this.targetRotation) / REACQUISITION_ROTATION_RADIANS_PER_SECOND
    );

    this.glideStartPosition.copy(this.position);
    this.glideStartRotation.copy(this.rotation);
    this.glideStartScale.copy(this.scale);
    this.reacquisitionDurationSeconds = MathUtils.clamp(
      requestedDuration,
      REACQUISITION_MIN_DURATION_SECONDS,
      REACQUISITION_MAX_DURATION_SECONDS
    );
    this.reacquisitionElapsedSeconds = 0;
    this.reacquisitionPending = false;
    this.reacquisitionActive = true;
  }

  private updateReacquisitionGlide(deltaSeconds: number) {
    this.reacquisitionElapsedSeconds += Math.min(Math.max(deltaSeconds, 0), MAX_DELTA_SECONDS);
    const progress = MathUtils.clamp(
      this.reacquisitionElapsedSeconds / this.reacquisitionDurationSeconds,
      0,
      1
    );
    const easedProgress = progress * progress * (3 - 2 * progress);

    this.position.lerpVectors(this.glideStartPosition, this.targetPosition, easedProgress);
    this.rotation.copy(this.glideStartRotation).slerp(this.targetRotation, easedProgress);
    this.scale.lerpVectors(this.glideStartScale, this.targetScale, easedProgress);

    if (progress >= 1) {
      this.reacquisitionActive = false;
    }
  }
}

function smoothVector(
  current: Vector3,
  target: Vector3,
  deltaSeconds: number,
  deadZone: number,
  fastDistance: number,
  slowSpeed: number,
  fastSpeed: number
) {
  const distance = current.distanceTo(target);

  if (distance <= deadZone) {
    return;
  }

  current.lerp(
    target,
    getAdaptiveAlpha(deltaSeconds, slowSpeed, fastSpeed, distance / fastDistance)
  );
}

function smoothRotation(current: Quaternion, target: Quaternion, deltaSeconds: number) {
  const angle = current.angleTo(target);

  if (angle <= ROTATION_DEAD_ZONE_RADIANS) {
    return;
  }

  current.slerp(
    target,
    getAdaptiveAlpha(
      deltaSeconds,
      ROTATION_SLOW_SPEED,
      ROTATION_FAST_SPEED,
      angle / ROTATION_FAST_ANGLE_RADIANS
    )
  );
}

function getAdaptiveAlpha(
  deltaSeconds: number,
  slowSpeed: number,
  fastSpeed: number,
  motionRatio: number
) {
  const speed = MathUtils.lerp(slowSpeed, fastSpeed, MathUtils.clamp(motionRatio, 0, 1));
  const safeDelta = Math.min(Math.max(deltaSeconds, 0), MAX_DELTA_SECONDS);

  return 1 - Math.exp(-speed * safeDelta);
}

function hasValidScale(scale: Vector3) {
  return (
    Number.isFinite(scale.x) &&
    Number.isFinite(scale.y) &&
    Number.isFinite(scale.z) &&
    Math.abs(scale.x) > MIN_SCALE &&
    Math.abs(scale.y) > MIN_SCALE &&
    Math.abs(scale.z) > MIN_SCALE
  );
}

function matricesAlmostEqual(first: Matrix4, second: Matrix4) {
  return first.elements.every(
    (value, index) => Math.abs(value - (second.elements[index] ?? 0)) <= MATRIX_EPSILON
  );
}

const POSITION_DEAD_ZONE = 0.0015;
const POSITION_FAST_DISTANCE = 0.06;
const POSITION_SLOW_SPEED = 9;
const POSITION_FAST_SPEED = 34;
const ROTATION_DEAD_ZONE_RADIANS = MathUtils.degToRad(0.22);
const ROTATION_FAST_ANGLE_RADIANS = MathUtils.degToRad(14);
const ROTATION_SLOW_SPEED = 9;
const ROTATION_FAST_SPEED = 32;
const SCALE_DEAD_ZONE = 0.002;
const SCALE_FAST_DISTANCE = 0.06;
const SCALE_SLOW_SPEED = 7;
const SCALE_FAST_SPEED = 20;
const MAX_DELTA_SECONDS = 1 / 20;
const MIN_SCALE = 0.000001;
const MATRIX_EPSILON = 0.0000001;
const REACQUISITION_MIN_DURATION_SECONDS = 0.1;
const REACQUISITION_MAX_DURATION_SECONDS = 0.22;
const REACQUISITION_POSITION_UNITS_PER_SECOND = 6;
const REACQUISITION_ROTATION_RADIANS_PER_SECOND = MathUtils.degToRad(600);
