import type { AnimationClip, Group } from "three";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneWithSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";

export interface MascotModelInstance {
  scene: Group;
  animations: AnimationClip[];
}

let sharedLoader: GLTFLoader | null = null;
const gltfCache = new Map<string, Promise<GLTF>>();

function getLoader(): GLTFLoader {
  if (!sharedLoader) {
    sharedLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  }

  return sharedLoader;
}

function loadGltf(url: string): Promise<GLTF> {
  let pending = gltfCache.get(url);

  if (!pending) {
    pending = getLoader().loadAsync(url);
    pending.catch(() => {
      // Failed downloads must not poison the cache; allow a retry later.
      gltfCache.delete(url);
    });
    gltfCache.set(url, pending);
  }

  return pending;
}

/**
 * Starts downloading and parsing models in the background so an AR session
 * can start instantly. Errors are swallowed; sessions surface their own.
 */
export function preloadMascotModels(urls: readonly string[]): void {
  urls.forEach((url) => {
    loadGltf(url).catch(() => undefined);
  });
}

/**
 * Preloads models and resolves once the cache has either loaded or rejected
 * each URL. Rejections are swallowed so feature flows can still show their own
 * target-specific missing-model message later.
 */
export async function warmMascotModelCache(urls: readonly string[]): Promise<void> {
  await Promise.allSettled(urls.map((url) => loadGltf(url)));
}

/**
 * Returns a fresh scene-graph instance of the model at `url`, downloading and
 * parsing it only once per page load. Instances share geometry, materials and
 * textures with the cached original, so callers must NOT dispose those
 * resources — detach the returned scene from the graph and drop the reference.
 */
export async function instantiateMascotModel(url: string): Promise<MascotModelInstance> {
  const gltf = await loadGltf(url);

  return {
    scene: cloneWithSkeleton(gltf.scene) as Group,
    animations: gltf.animations
  };
}
