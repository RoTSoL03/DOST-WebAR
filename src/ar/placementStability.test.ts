import { Matrix4 } from "three";

import { isFloorFacingPose, PlacementStabilityTracker } from "./placementStability";

describe("PlacementStabilityTracker", () => {
  it("distinguishes upward-facing floor poses from vertical hits", () => {
    expect(isFloorFacingPose(new Matrix4().identity().elements)).toBe(true);
    expect(isFloorFacingPose(new Matrix4().makeRotationX(Math.PI / 2).elements)).toBe(false);
  });

  it("accepts a sustained stable horizontal pose", () => {
    const tracker = createTracker();
    const matrix = new Matrix4().makeTranslation(0.1, 0, -1).elements;

    expect(tracker.update(matrix, 0)).toBe(false);
    expect(tracker.update(matrix, 50)).toBe(false);
    expect(tracker.update(matrix, 100)).toBe(false);
    expect(tracker.update(matrix, 150)).toBe(true);
  });

  it("rejects a vertical surface", () => {
    const tracker = createTracker();
    const matrix = new Matrix4().makeRotationX(Math.PI / 2).elements;

    expect(tracker.update(matrix, 0)).toBe(false);
    expect(tracker.update(matrix, 50)).toBe(false);
    expect(tracker.update(matrix, 100)).toBe(false);
    expect(tracker.update(matrix, 150)).toBe(false);
  });

  it("rejects position jitter outside the configured spread", () => {
    const tracker = createTracker();

    expect(tracker.update(new Matrix4().makeTranslation(0, 0, -1).elements, 0)).toBe(false);
    expect(tracker.update(new Matrix4().makeTranslation(0.01, 0, -1).elements, 50)).toBe(false);
    expect(tracker.update(new Matrix4().makeTranslation(0.08, 0, -1).elements, 100)).toBe(false);
    expect(tracker.update(new Matrix4().makeTranslation(0, 0, -1).elements, 150)).toBe(false);
  });
});

function createTracker() {
  return new PlacementStabilityTracker({
    minimumSamples: 4,
    minimumStableDurationMs: 150,
    sampleWindowMs: 500,
    maximumPositionSpreadMeters: 0.03
  });
}
