import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Float32BufferAttribute,
  Group,
  MathUtils,
  Points,
  PointsMaterial,
  Sprite,
  SpriteMaterial
} from "three";

import { get2DContext } from "./captureUtils";

export interface MascotVfx {
  group: Group;
  aura: Sprite;
  auraMaterial: SpriteMaterial;
  auraTexture: CanvasTexture;
  particles: Points;
  particleMaterial: PointsMaterial;
  particleGeometry: BufferGeometry;
}

export interface MascotVfxRuntime {
  contentRoot: Group;
  vfx: MascotVfx;
  visible: boolean;
  modelVisible: boolean;
  appearStartedAt: number | null;
  disappearStartedAt: number | null;
}

export function createMascotVfx(): MascotVfx {
  const group = new Group();
  group.visible = false;
  group.position.y = 0.72;

  const auraTexture = createAuraTexture();
  const auraMaterial = new SpriteMaterial({
    map: auraTexture,
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    depthWrite: false
  });
  const aura = new Sprite(auraMaterial);
  aura.scale.setScalar(1);
  group.add(aura);

  const particleGeometry = createParticleGeometry();
  const particleMaterial = new PointsMaterial({
    color: 0xffffff,
    size: 0.09,
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    depthWrite: false
  });
  const particles = new Points(particleGeometry, particleMaterial);
  group.add(particles);

  return {
    group,
    aura,
    auraMaterial,
    auraTexture,
    particles,
    particleMaterial,
    particleGeometry
  };
}

export function startMascotAppear(runtime: MascotVfxRuntime, frameTime: number) {
  runtime.visible = true;
  runtime.contentRoot.visible = false;
  runtime.contentRoot.scale.setScalar(APPEAR_MODEL_START_SCALE);
  runtime.modelVisible = false;
  runtime.appearStartedAt = frameTime;
  runtime.disappearStartedAt = null;
  runtime.vfx.group.visible = true;
  updateMascotVfx(runtime, frameTime);
}

export function startMascotDisappear(runtime: MascotVfxRuntime, frameTime: number) {
  runtime.visible = false;
  runtime.contentRoot.visible = false;
  runtime.modelVisible = false;
  runtime.appearStartedAt = null;
  runtime.disappearStartedAt = frameTime;
  runtime.vfx.group.visible = true;
  updateMascotVfx(runtime, frameTime);
}

export function updateMascotVfx(runtime: MascotVfxRuntime, frameTime: number) {
  if (runtime.appearStartedAt !== null) {
    const elapsed = frameTime - runtime.appearStartedAt;
    const progress = MathUtils.clamp(elapsed / APPEAR_VFX_DURATION_MS, 0, 1);
    const pulse = Math.sin(progress * Math.PI);

    runtime.vfx.group.visible = progress < 1;
    runtime.vfx.auraMaterial.opacity = 1.18 * (1 - progress) + 0.42 * pulse;
    runtime.vfx.aura.scale.setScalar(1.3 + progress * 2.8);
    runtime.vfx.particleMaterial.opacity = 0.96 * (1 - progress);
    runtime.vfx.particles.scale.setScalar(0.95 + progress * 2.35);

    if (!runtime.modelVisible && elapsed >= APPEAR_MODEL_DELAY_MS) {
      runtime.contentRoot.visible = runtime.visible;
      runtime.modelVisible = runtime.visible;
    }

    if (runtime.modelVisible) {
      const modelProgress = MathUtils.clamp(
        (elapsed - APPEAR_MODEL_DELAY_MS) / APPEAR_MODEL_GROW_DURATION_MS,
        0,
        1
      );
      runtime.contentRoot.scale.setScalar(getOvershootScale(modelProgress));
    }

    if (progress >= 1) {
      runtime.appearStartedAt = null;
      runtime.vfx.group.visible = false;
      runtime.contentRoot.visible = runtime.visible;
      runtime.contentRoot.scale.setScalar(1);
      runtime.modelVisible = runtime.visible;
      return false;
    }

    return true;
  }

  if (runtime.disappearStartedAt !== null) {
    const elapsed = frameTime - runtime.disappearStartedAt;
    const progress = MathUtils.clamp(elapsed / DISAPPEAR_VFX_DURATION_MS, 0, 1);

    runtime.vfx.group.visible = progress < 1;
    runtime.vfx.auraMaterial.opacity = 1.25 * (1 - progress);
    runtime.vfx.aura.scale.setScalar(0.75 + progress * 2.65);
    runtime.vfx.particleMaterial.opacity = 1 * (1 - progress);
    runtime.vfx.particles.scale.setScalar(0.72 + progress * 2.45);

    if (progress >= 1) {
      runtime.disappearStartedAt = null;
      runtime.vfx.group.visible = false;
      runtime.contentRoot.visible = false;
      runtime.modelVisible = false;
      return false;
    }

    return true;
  }

  runtime.vfx.group.visible = false;
  return false;
}

export function disposeMascotVfx(vfx: MascotVfx) {
  vfx.auraTexture.dispose();
  vfx.auraMaterial.dispose();
  vfx.particleGeometry.dispose();
  vfx.particleMaterial.dispose();
}

function createAuraTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = AURA_TEXTURE_SIZE;
  canvas.height = AURA_TEXTURE_SIZE;
  const context = get2DContext(canvas);
  const center = AURA_TEXTURE_SIZE / 2;
  const gradient = context.createRadialGradient(center, center, 0, center, center, center);
  gradient.addColorStop(0, "rgba(255,255,255,0.95)");
  gradient.addColorStop(0.22, "rgba(255,255,255,0.68)");
  gradient.addColorStop(0.56, "rgba(255,255,255,0.18)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  return new CanvasTexture(canvas);
}

function createParticleGeometry() {
  const positions: number[] = [];

  for (let index = 0; index < VFX_PARTICLE_COUNT; index += 1) {
    const angle = (index / VFX_PARTICLE_COUNT) * Math.PI * 2;
    const ring = index % 3;
    const radius = 0.2 + ring * 0.14 + (index % 5) * 0.018;
    const height = -0.18 + ((index * 7) % 17) * 0.055;
    positions.push(Math.cos(angle) * radius, height, Math.sin(angle) * radius);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));

  return geometry;
}

function getOvershootScale(progress: number) {
  const eased = 1 - Math.pow(1 - progress, 3);
  const overshoot = Math.sin(progress * Math.PI) * APPEAR_MODEL_OVERSHOOT;

  return APPEAR_MODEL_START_SCALE + (1 - APPEAR_MODEL_START_SCALE) * eased + overshoot;
}

const APPEAR_MODEL_DELAY_MS = 150;
const APPEAR_MODEL_GROW_DURATION_MS = 360;
const APPEAR_MODEL_START_SCALE = 0.18;
const APPEAR_MODEL_OVERSHOOT = 0.12;
const APPEAR_VFX_DURATION_MS = 700;
const DISAPPEAR_VFX_DURATION_MS = 340;
const AURA_TEXTURE_SIZE = 128;
const VFX_PARTICLE_COUNT = 72;
