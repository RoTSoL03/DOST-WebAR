import { useEffect, useRef, useState } from "react";
import {
  AmbientLight,
  Box3,
  DirectionalLight,
  Group,
  Object3D,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
  type Material,
  type Mesh
} from "three";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import type { MascotManifestEntry } from "../config/mascots";

interface ModelPreviewProps {
  mascot: MascotManifestEntry;
}

export function ModelPreview({ mascot }: ModelPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    if (!canUseWebGL()) {
      setStatus("unavailable");
      return;
    }

    let disposed = false;
    let frameId = 0;
    let renderer: WebGLRenderer | null = null;
    let resizeObserver: ResizeObserver | null = null;
    const scene = new Scene();
    const camera = new PerspectiveCamera(35, 1, 0.01, 100);
    const root = new Group();
    const previewCanvas = canvas;
    const startedAt = performance.now();

    async function startPreview() {
      try {
        renderer = new WebGLRenderer({ canvas: previewCanvas, antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

        camera.position.set(0, 0.15, 4.8);
        scene.add(new AmbientLight(0xffffff, 1.7));

        const keyLight = new DirectionalLight(0xffffff, 2.2);
        keyLight.position.set(2.5, 4, 3);
        scene.add(keyLight);
        scene.add(root);

        const loader = new GLTFLoader();
        loader.setMeshoptDecoder(MeshoptDecoder);

        const gltf = await loader.loadAsync(mascot.modelUrl);

        if (disposed) {
          disposeScene(gltf.scene);
          return;
        }

        root.add(gltf.scene);
        frameModel(root, mascot);
        applyMascotForwardCorrection(root);

        resizeObserver = new ResizeObserver(() => resizeRenderer(previewCanvas, renderer, camera));
        resizeObserver.observe(previewCanvas);
        resizeRenderer(previewCanvas, renderer, camera);
        setStatus("ready");

        const renderFrame = () => {
          if (!renderer || disposed) {
            return;
          }

          const elapsedSeconds = (performance.now() - startedAt) / 1000;
          root.rotation.y = MASCOT_FORWARD_YAW_OFFSET + Math.sin(elapsedSeconds * 0.65) * 0.28;
          renderer.render(scene, camera);
          frameId = window.requestAnimationFrame(renderFrame);
        };

        renderFrame();
      } catch {
        if (!disposed) {
          setStatus("unavailable");
        }
      }
    }

    void startPreview();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
      scene.traverse((object: Object3D) => {
        if (object instanceof Group) {
          return;
        }
        disposeMeshResources(object as Mesh);
      });
      renderer?.dispose();
    };
  }, [mascot]);

  return (
    <figure className="model-preview" data-testid="model-preview">
      <canvas ref={canvasRef} aria-label={`${mascot.displayName} model preview`} />
      <figcaption>
        {status === "loading" ? "Loading model preview..." : null}
        {status === "ready" ? `${mascot.displayName} sample model loaded.` : null}
        {status === "unavailable" ? "Model preview is unavailable in this browser." : null}
      </figcaption>
    </figure>
  );
}

function frameModel(root: Group, mascot: MascotManifestEntry) {
  const bounds = new Box3().setFromObject(root);
  const size = bounds.getSize(new Vector3());
  const center = bounds.getCenter(new Vector3());
  const largestAxis = Math.max(size.x, size.y, size.z, 1);
  const normalizedScale = (1.55 / largestAxis) * mascot.defaultScale;

  root.position.set(-center.x, -center.y + mascot.defaultVerticalOffset, -center.z);
  root.scale.setScalar(normalizedScale);
}

function applyMascotForwardCorrection(root: Group) {
  root.rotation.y = MASCOT_FORWARD_YAW_OFFSET;
}

const MASCOT_FORWARD_YAW_OFFSET = -Math.PI / 2;

function resizeRenderer(
  canvas: HTMLCanvasElement,
  renderer: WebGLRenderer | null,
  camera: PerspectiveCamera
) {
  if (!renderer) {
    return;
  }

  const width = Math.max(canvas.clientWidth, 1);
  const height = Math.max(canvas.clientHeight, 1);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function disposeScene(group: Group) {
  group.traverse((object: Object3D) => disposeMeshResources(object as Mesh));
}

function canUseWebGL() {
  return (
    typeof window !== "undefined" &&
    (typeof window.WebGLRenderingContext !== "undefined" ||
      typeof window.WebGL2RenderingContext !== "undefined") &&
    typeof window.ResizeObserver !== "undefined"
  );
}

function disposeMeshResources(mesh: Mesh) {
  mesh.geometry?.dispose();

  if (Array.isArray(mesh.material)) {
    mesh.material.forEach(disposeMaterial);
  } else if (mesh.material) {
    disposeMaterial(mesh.material);
  }
}

function disposeMaterial(material: Material) {
  material.dispose();
}
