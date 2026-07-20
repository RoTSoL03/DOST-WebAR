import { Matrix4, Vector3 } from "three";

import {
  FloorHitPoseSmoother,
  getCameraFacingYaw,
  offsetFloorHitAwayFromViewer
} from "./floorHitSmoothing";

describe("FloorHitPoseSmoother", () => {
  it("uses the first floor hit immediately", () => {
    const smoother = new FloorHitPoseSmoother();
    const target = new Float32Array(16);

    smoother.update(new Matrix4().makeTranslation(1, 0, -2).elements, 0, target);

    expect(target[12]).toBe(1);
    expect(target[13]).toBe(0);
    expect(target[14]).toBe(-2);
  });

  it("limits large jumps while preserving an upright pose", () => {
    const smoother = new FloorHitPoseSmoother();
    const target = new Float32Array(16);

    smoother.update(new Matrix4().makeTranslation(0, 0, -1).elements, 0, target);
    smoother.update(new Matrix4().makeTranslation(1, 0.2, -3).elements, 16, target);

    expect(target[12]).toBeGreaterThan(0);
    expect(target[12]).toBeLessThan(0.1);
    expect(target[5]).toBe(1);
    expect(target[15]).toBe(1);
  });

  it("ignores sub-centimeter jitter", () => {
    const smoother = new FloorHitPoseSmoother();
    const target = new Float32Array(16);

    smoother.update(new Matrix4().makeTranslation(0, 0, -1).elements, 0, target);
    smoother.update(new Matrix4().makeTranslation(0.003, 0, -1.002).elements, 16, target);

    expect(target[12]).toBe(0);
    expect(target[14]).toBe(-1);
  });

  it("calculates a new camera-facing yaw for placement and replacement", () => {
    const placement = new Matrix4().makeTranslation(0, 0, -2).elements;

    expect(getCameraFacingYaw(placement, new Vector3(0, 1.6, 0))).toBeCloseTo(0);
    expect(getCameraFacingYaw(placement, new Vector3(2, 1.6, -2))).toBeCloseTo(
      Math.PI / 2
    );
  });

  it("moves a close floor hit farther away without changing its height", () => {
    const hit = new Matrix4().makeTranslation(0, 0.05, -1).elements;
    const target = new Float32Array(16);

    offsetFloorHitAwayFromViewer(hit, new Vector3(0, 1.6, 0), 0.35, target);

    expect(target[12]).toBeCloseTo(0);
    expect(target[13]).toBeCloseTo(0.05);
    expect(target[14]).toBeCloseTo(-1.35);
  });
});
