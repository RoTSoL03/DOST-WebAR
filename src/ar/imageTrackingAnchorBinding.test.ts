import { Euler, Group, Quaternion, Scene, Vector3 } from "three";

import { bindContentToImageAnchor, SmoothedImageAnchorBinding } from "./imageTrackingAnchorBinding";

describe("bindContentToImageAnchor", () => {
  it("keeps two content roots attached to their own independent anchors", () => {
    const scene = new Scene();
    const firstAnchor = createAnchorAt(-1.2, 0.1, -2);
    const secondAnchor = createAnchorAt(0.9, -0.2, -1.5);
    const firstContent = new Group();
    const secondContent = new Group();

    scene.add(firstAnchor, secondAnchor);
    bindContentToImageAnchor(firstAnchor, firstContent);
    bindContentToImageAnchor(secondAnchor, secondContent);
    scene.updateMatrixWorld(true);

    expect(firstContent.parent).toBe(firstAnchor);
    expect(secondContent.parent).toBe(secondAnchor);
    expect(worldPositionOf(firstContent).toArray()).toEqual([-1.2, 0.1, -2]);
    expect(worldPositionOf(secondContent).toArray()).toEqual([0.9, -0.2, -1.5]);

    secondAnchor.matrix.makeTranslation(2.4, 0.5, -3);
    secondAnchor.matrixWorldNeedsUpdate = true;
    scene.updateMatrixWorld(true);

    expect(worldPositionOf(firstContent).toArray()).toEqual([-1.2, 0.1, -2]);
    expect(worldPositionOf(secondContent).toArray()).toEqual([2.4, 0.5, -3]);
  });

  it("clears stale local transforms before binding", () => {
    const anchor = createAnchorAt(1, 2, 3);
    const content = new Group();

    content.position.set(9, 8, 7);
    content.rotation.set(0.4, 0.3, 0.2);
    content.scale.setScalar(4);
    bindContentToImageAnchor(anchor, content);

    expect(content.position.toArray()).toEqual([0, 0, 0]);
    expect(content.quaternion.toArray()).toEqual([0, 0, 0, 1]);
    expect(content.scale.toArray()).toEqual([1, 1, 1]);
  });

  it("keeps simultaneous animated poses isolated over repeated updates", () => {
    const scene = new Scene();
    const firstAnchor = createAnchorAt(0, 0, 0);
    const secondAnchor = createAnchorAt(0, 0, 0);
    const firstContent = new Group();
    const secondContent = new Group();
    const firstRotation = new Quaternion();
    const secondRotation = new Quaternion();

    scene.add(firstAnchor, secondAnchor);
    bindContentToImageAnchor(firstAnchor, firstContent);
    bindContentToImageAnchor(secondAnchor, secondContent);

    for (let frame = 0; frame < 120; frame += 1) {
      firstAnchor.matrix.compose(
        new Vector3(-1 - frame * 0.004, Math.sin(frame * 0.05) * 0.1, -2),
        firstRotation.setFromEuler(new Euler(0.1, frame * 0.003, -0.2)),
        new Vector3(1.1, 1.1, 1.1)
      );
      secondAnchor.matrix.compose(
        new Vector3(1 + frame * 0.006, Math.cos(frame * 0.04) * 0.12, -1.4),
        secondRotation.setFromEuler(new Euler(-0.15, -frame * 0.004, 0.25)),
        new Vector3(0.85, 0.85, 0.85)
      );
      firstAnchor.matrixWorldNeedsUpdate = true;
      secondAnchor.matrixWorldNeedsUpdate = true;
      scene.updateMatrixWorld(true);

      expectMatricesToMatch(firstContent.matrixWorld.elements, firstAnchor.matrixWorld.elements);
      expectMatricesToMatch(secondContent.matrixWorld.elements, secondAnchor.matrixWorld.elements);
    }
  });

  it("rejects tiny pose noise while gliding toward deliberate movement", () => {
    const anchor = createAnchorAt(0, 0, -1);
    const content = new Group();
    const binding = new SmoothedImageAnchorBinding(anchor, content);

    binding.update(1 / 60);
    anchor.matrix.makeTranslation(0.0008, -0.0006, -1);
    binding.update(1 / 60);
    expect(anchor.matrix.elements[12]).toBe(0);
    expect(anchor.matrix.elements[13]).toBe(0);

    anchor.matrix.makeTranslation(0.5, 0.2, -1.4);
    binding.update(1 / 60);
    const firstGlidePosition = worldPositionOf(anchor);
    expect(firstGlidePosition.x).toBeGreaterThan(0);
    expect(firstGlidePosition.x).toBeLessThan(0.5);

    for (let frame = 0; frame < 20; frame += 1) {
      binding.update(1 / 60);
    }

    const settledPosition = worldPositionOf(anchor);
    expect(settledPosition.distanceTo(new Vector3(0.5, 0.2, -1.4))).toBeLessThanOrEqual(0.0015);
  });

  it("smooths marker angle without reversing rotation", () => {
    const anchor = createAnchorAt(0, 0, -1);
    const content = new Group();
    const binding = new SmoothedImageAnchorBinding(anchor, content);
    const position = new Vector3();
    const rotation = new Quaternion();
    const scale = new Vector3();
    const targetRotation = new Quaternion().setFromEuler(new Euler(0.35, -0.2, 0.7));

    binding.update(1 / 60);
    anchor.matrix.compose(new Vector3(0, 0, -1), targetRotation, new Vector3(1, 1, 1));
    binding.update(1 / 60);
    anchor.matrix.decompose(position, rotation, scale);

    expect(new Quaternion().angleTo(rotation)).toBeGreaterThan(0);
    expect(rotation.angleTo(targetRotation)).toBeGreaterThan(0);

    for (let frame = 0; frame < 30; frame += 1) {
      binding.update(1 / 60);
    }

    anchor.matrix.decompose(position, rotation, scale);
    expect(rotation.angleTo(targetRotation)).toBeLessThan(0.005);
  });

  it("uses a fast eased glide when a marker is reacquired elsewhere", () => {
    const anchor = createAnchorAt(0, 0, -1);
    const content = new Group();
    const binding = new SmoothedImageAnchorBinding(anchor, content);
    const originalPosition = new Vector3(0, 0, -1);
    const recoveredPosition = new Vector3(0.8, 0.25, -1.6);

    binding.update(1 / 60);
    anchor.matrix.makeTranslation(recoveredPosition.x, recoveredPosition.y, recoveredPosition.z);
    binding.beginReacquisition();
    binding.update(1 / 60);

    const firstGlidePosition = worldPositionOf(anchor);
    expect(firstGlidePosition.distanceTo(originalPosition)).toBeGreaterThan(0);
    expect(firstGlidePosition.distanceTo(recoveredPosition)).toBeGreaterThan(0.5);

    for (let frame = 0; frame < 14; frame += 1) {
      binding.update(1 / 60);
    }

    expect(worldPositionOf(anchor).distanceTo(recoveredPosition)).toBeLessThan(0.000001);
  });
});

function createAnchorAt(x: number, y: number, z: number) {
  const anchor = new Group();
  anchor.matrixAutoUpdate = false;
  anchor.matrix.makeTranslation(x, y, z);

  return anchor;
}

function worldPositionOf(object: Group) {
  return object.getWorldPosition(new Vector3());
}

function expectMatricesToMatch(first: readonly number[], second: readonly number[]) {
  first.forEach((value, index) => {
    expect(value).toBeCloseTo(second[index] ?? 0, 10);
  });
}
