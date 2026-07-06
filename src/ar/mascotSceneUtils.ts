import {
  Box3,
  CircleGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  RingGeometry,
  Vector3,
  type Material
} from "three";

export const MASCOT_FORWARD_YAW_OFFSET = -Math.PI / 2;
export const MASCOT_TARGET_HEIGHT_METERS = 1.4;

interface ModelAlignmentOptions {
  defaultScale: number;
  defaultVerticalOffset: number;
}

const SHADOW_RADIUS_X_METERS = 0.38;
const SHADOW_RADIUS_Z_METERS = 0.24;

/**
 * Normalizes a freshly loaded model so its largest dimension matches
 * `targetHeight` (scaled by the manifest default) and its lowest point rests
 * on the local y=0 plane, centered on the local origin.
 */
export function alignModelBottomToFloor(
  root: Group,
  mascot: ModelAlignmentOptions,
  targetHeight: number
) {
  root.position.set(0, 0, 0);
  root.scale.setScalar(1);
  root.updateMatrixWorld(true);

  const bounds = new Box3().setFromObject(root);
  const size = bounds.getSize(new Vector3());
  const center = bounds.getCenter(new Vector3());
  const largestAxis = Math.max(size.x, size.y, size.z, 1);
  const normalizedScale = (targetHeight / largestAxis) * mascot.defaultScale;

  root.scale.setScalar(normalizedScale);
  root.position.set(
    -center.x * normalizedScale,
    -bounds.min.y * normalizedScale + mascot.defaultVerticalOffset,
    -center.z * normalizedScale
  );
}

export function applyMascotForwardCorrection(root: Group) {
  root.rotation.y = MASCOT_FORWARD_YAW_OFFSET;
}

export function createReticle() {
  const reticle = new Group();
  const platformGeometry = new CircleGeometry(0.38, 48).rotateX(-Math.PI / 2);
  const platformMaterial = new MeshBasicMaterial({
    color: 0x8ee4d1,
    side: DoubleSide,
    transparent: true,
    opacity: 0.34,
    depthTest: false,
    depthWrite: false
  });
  const platform = new Mesh(platformGeometry, platformMaterial);
  const ringGeometry = new RingGeometry(0.12, 0.16, 32).rotateX(-Math.PI / 2);
  const ringMaterial = new MeshBasicMaterial({
    color: 0xffdf6e,
    side: DoubleSide,
    transparent: true,
    opacity: 1,
    depthTest: false,
    depthWrite: false
  });
  const ring = new Mesh(ringGeometry, ringMaterial);
  reticle.add(platform, ring);
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;

  return reticle;
}

/** Cheap fake contact shadow that grounds a mascot without real-time shadow maps. */
export function createMascotContactShadow() {
  const geometry = new CircleGeometry(1, 48).rotateX(-Math.PI / 2);
  const material = new MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.28,
    depthWrite: false
  });
  const shadow = new Mesh(geometry, material);

  shadow.position.y = 0.006;
  shadow.scale.set(SHADOW_RADIUS_X_METERS, 1, SHADOW_RADIUS_Z_METERS);
  shadow.renderOrder = -1;

  return shadow;
}

/**
 * Disposes geometries and materials owned by a session-created object tree.
 * Never call this on (or on ancestors of) cached mascot model instances —
 * their resources are shared through the model cache.
 */
export function disposeObjectResources(object: Object3D) {
  object.traverse((child: Object3D) => {
    const mesh = child as Mesh;
    mesh.geometry?.dispose();

    if (Array.isArray(mesh.material)) {
      mesh.material.forEach(disposeMaterial);
    } else if (mesh.material) {
      disposeMaterial(mesh.material);
    }
  });
}

function disposeMaterial(material: Material) {
  material.dispose();
}
