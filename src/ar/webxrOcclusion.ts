import {
  ClampToEdgeWrapping,
  DataTexture,
  FloatType,
  LinearFilter,
  Material,
  Matrix4,
  NearestFilter,
  Object3D,
  RedFormat,
  UnsignedByteType,
  type WebGLRenderer
} from "three";
import type { WebGLProgramParametersWithUniforms } from "three/src/renderers/webgl/WebGLPrograms.js";

interface MaterialObject extends Object3D {
  material?: Material | Material[];
}

interface PatchOptions {
  cloneMaterials?: boolean;
}

const OCCLUSION_PROGRAM_KEY = "dost-webxr-hybrid-occlusion-v2";

/**
 * Bridges CPU-readable WebXR depth and an on-device person mask into ordinary
 * Three.js materials. All uniforms are shared, so a depth/mask update is O(1)
 * with respect to the number of mascot materials.
 */
export class WebXROcclusionController {
  private readonly session: XRSession;
  private readonly depthTexture = createDepthTexture();
  private readonly personTexture = createPersonTexture();
  private readonly depthUvTransform = new Matrix4();
  private readonly patchedMaterials = new Set<Material>();
  private readonly clonedMaterials = new Set<Material>();
  private depthMeters = new Float32Array(1);

  private readonly uniforms = {
    uOcclusionEnabled: { value: 1 },
    uRealDepthTexture: { value: this.depthTexture },
    uPersonMaskTexture: { value: this.personTexture },
    uDepthUvTransform: { value: this.depthUvTransform },
    uHasRealDepth: { value: 0 },
    uHasPersonMask: { value: 0 },
    uDepthBiasMeters: { value: 0.02 },
    uDepthFeatherMeters: { value: 0.04 },
    uPersonThreshold: { value: 0.5 },
    uPersonFeather: { value: 0.18 }
  };

  constructor(session: XRSession) {
    this.session = session;
  }

  patchObject(object: Object3D, { cloneMaterials = false }: PatchOptions = {}) {
    object.traverse((child) => {
      const materialObject = child as MaterialObject;

      if (!materialObject.material) {
        return;
      }

      if (Array.isArray(materialObject.material)) {
        materialObject.material = materialObject.material.map((material) =>
          this.prepareMaterial(material, cloneMaterials)
        );
      } else {
        materialObject.material = this.prepareMaterial(materialObject.material, cloneMaterials);
      }
    });
  }

  updateDepth(frame: XRFrame, referenceSpace: XRReferenceSpace) {
    this.uniforms.uHasRealDepth.value = 0;

    if (getDepthUsage(this.session) !== "cpu-optimized" || !frame.getDepthInformation) {
      return false;
    }

    const view = frame.getViewerPose(referenceSpace)?.views[0];
    if (!view) {
      return false;
    }

    let depthInformation: XRCPUDepthInformation | null = null;
    try {
      depthInformation = frame.getDepthInformation(view);
    } catch {
      return false;
    }

    if (!depthInformation || depthInformation.width <= 0 || depthInformation.height <= 0) {
      return false;
    }

    const pixelCount = depthInformation.width * depthInformation.height;
    if (this.depthMeters.length !== pixelCount) {
      this.depthMeters = new Float32Array(pixelCount);
    }

    decodeDepthToMeters(
      depthInformation.data,
      getDepthDataFormat(this.session),
      depthInformation.rawValueToMeters,
      this.depthMeters
    );

    this.depthTexture.image = {
      data: this.depthMeters,
      width: depthInformation.width,
      height: depthInformation.height
    };
    this.depthTexture.needsUpdate = true;
    this.depthUvTransform.fromArray(depthInformation.normDepthBufferFromNormView.matrix);
    this.uniforms.uHasRealDepth.value = 1;
    return true;
  }

  updatePersonMask(mask: Uint8Array, width: number, height: number) {
    if (width <= 0 || height <= 0 || mask.length !== width * height) {
      return;
    }

    this.personTexture.image = { data: mask, width, height };
    this.personTexture.needsUpdate = true;
    this.uniforms.uHasPersonMask.value = 1;
  }

  clearPersonMask() {
    this.uniforms.uHasPersonMask.value = 0;
  }

  setEnabled(enabled: boolean) {
    this.uniforms.uOcclusionEnabled.value = enabled ? 1 : 0;
  }

  dispose() {
    this.depthTexture.dispose();
    this.personTexture.dispose();
    this.clonedMaterials.forEach((material) => material.dispose());
    this.clonedMaterials.clear();
    this.patchedMaterials.clear();
  }

  private prepareMaterial(source: Material, cloneMaterial: boolean) {
    const material = cloneMaterial ? source.clone() : source;

    // Three.js alpha hashing turns the feathered coverage into a stable,
    // screen-door edge without moving every opaque mascot into the more
    // expensive transparent sorting/blending path.
    material.alphaHash = true;

    if (cloneMaterial) {
      this.clonedMaterials.add(material);
    }

    if (this.patchedMaterials.has(material)) {
      return material;
    }

    const originalOnBeforeCompile = material.onBeforeCompile.bind(material);
    const originalProgramCacheKey = material.customProgramCacheKey.bind(material);

    material.onBeforeCompile = (
      shader: WebGLProgramParametersWithUniforms,
      renderer: WebGLRenderer
    ) => {
      originalOnBeforeCompile(shader, renderer);
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = patchVertexShader(shader.vertexShader);
      shader.fragmentShader = patchFragmentShader(shader.fragmentShader);
    };
    material.customProgramCacheKey = () => `${originalProgramCacheKey()}|${OCCLUSION_PROGRAM_KEY}`;
    material.needsUpdate = true;
    this.patchedMaterials.add(material);

    return material;
  }
}

export function decodeDepthToMeters(
  data: ArrayBuffer,
  format: XRDepthDataFormat,
  rawValueToMeters: number,
  target: Float32Array
) {
  if (format === "float32") {
    const source = new Float32Array(data);
    const count = Math.min(source.length, target.length);
    for (let index = 0; index < count; index += 1) {
      target[index] = (source[index] ?? 0) * rawValueToMeters;
    }
    return target;
  }

  const source = new Uint16Array(data);
  const count = Math.min(source.length, target.length);
  for (let index = 0; index < count; index += 1) {
    target[index] = (source[index] ?? 0) * rawValueToMeters;
  }

  return target;
}

function createDepthTexture() {
  const texture = new DataTexture(new Float32Array([0]), 1, 1, RedFormat, FloatType);
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function createPersonTexture() {
  const texture = new DataTexture(new Uint8Array([0]), 1, 1, RedFormat, UnsignedByteType);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function patchVertexShader(source: string) {
  return source
    .replace(
      "#include <common>",
      `#include <common>
varying vec2 vDostOcclusionUv;
varying float vDostVirtualDepthMeters;`
    )
    .replace(
      "#include <project_vertex>",
      `#include <project_vertex>
vDostOcclusionUv = (gl_Position.xy / gl_Position.w) * 0.5 + 0.5;
vDostVirtualDepthMeters = -mvPosition.z;`
    );
}

function patchFragmentShader(source: string) {
  return source
    .replace(
      "#include <common>",
      `#include <common>
uniform sampler2D uRealDepthTexture;
uniform sampler2D uPersonMaskTexture;
uniform mat4 uDepthUvTransform;
uniform float uOcclusionEnabled;
uniform float uHasRealDepth;
uniform float uHasPersonMask;
uniform float uDepthBiasMeters;
uniform float uDepthFeatherMeters;
uniform float uPersonThreshold;
uniform float uPersonFeather;
varying vec2 vDostOcclusionUv;
varying float vDostVirtualDepthMeters;`
    )
    .replace(
      "void main() {",
      `void main() {
  // WebXR normalized-view coordinates have a top-left origin, while clip-space
  // UVs have a bottom-left origin.
  vec2 dostViewUv = vec2(vDostOcclusionUv.x, 1.0 - vDostOcclusionUv.y);
  vec2 dostDepthUv = (uDepthUvTransform * vec4(dostViewUv, 0.0, 1.0)).xy;
  float dostRealDepth = texture2D(uRealDepthTexture, dostDepthUv).r;
  float dostPerson = texture2D(uPersonMaskTexture, dostViewUv).r;
  bool dostDepthValid = uHasRealDepth > 0.5 && dostRealDepth > 0.0;
  float dostDepthDifference = vDostVirtualDepthMeters - uDepthBiasMeters - dostRealDepth;
  float dostDepthCoverage = dostDepthValid
    ? smoothstep(0.0, uDepthFeatherMeters, dostDepthDifference)
    : 0.0;
  float dostPersonCoverage = uHasPersonMask > 0.5
    ? smoothstep(
        uPersonThreshold - uPersonFeather,
        uPersonThreshold + uPersonFeather,
        dostPerson
      )
    : 0.0;
  float dostOcclusionCoverage = uOcclusionEnabled *
    max(dostDepthCoverage, dostPersonCoverage);`
    )
    .replace(
      "#include <alphatest_fragment>",
      `#include <alphatest_fragment>
diffuseColor.a *= 1.0 - dostOcclusionCoverage;
if (diffuseColor.a < 0.02) discard;`
    );
}

function getDepthUsage(session: XRSession): XRDepthUsage | null {
  try {
    return session.depthUsage ?? null;
  } catch {
    return null;
  }
}

function getDepthDataFormat(session: XRSession): XRDepthDataFormat {
  try {
    return session.depthDataFormat ?? "luminance-alpha";
  } catch {
    return "luminance-alpha";
  }
}
