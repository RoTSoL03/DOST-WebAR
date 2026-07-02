type XRSessionMode = "immersive-ar";
type XRReferenceSpaceType = "local" | "local-floor" | "viewer";

interface XRSessionInit {
  requiredFeatures?: string[];
  optionalFeatures?: string[];
  domOverlay?: {
    root: Element;
  };
}

interface XRFrame {
  getHitTestResults(hitTestSource: XRHitTestSource): XRHitTestResult[];
  getViewerPose(referenceSpace: XRReferenceSpace): XRViewerPose | null;
}

interface XRHitTestOptionsInit {
  space: XRSpace;
}

interface XRHitTestSource {
  cancel(): void;
}

interface XRHitTestResult {
  getPose(baseSpace: XRSpace): XRPose | null;
}

interface XRInputSourceEvent extends Event {
  frame: XRFrame;
}

type XRReferenceSpace = XRSpace;

interface XRRenderStateInit {
  baseLayer?: XRWebGLLayer;
}

interface XRSession extends EventTarget {
  end(): Promise<void>;
  requestHitTestSource(options: XRHitTestOptionsInit): Promise<XRHitTestSource | null>;
  requestReferenceSpace(type: XRReferenceSpaceType): Promise<XRReferenceSpace>;
  updateRenderState(state?: XRRenderStateInit): void;
  addEventListener(type: "end", listener: (event: Event) => void): void;
  addEventListener(type: "select", listener: (event: XRInputSourceEvent) => void): void;
  removeEventListener(type: "end", listener: (event: Event) => void): void;
  removeEventListener(type: "select", listener: (event: XRInputSourceEvent) => void): void;
}

type XRSpace = object;

interface XRPose {
  transform: XRRigidTransform;
}

interface XRViewerPose {
  views: readonly XRView[];
}

interface XRView {
  camera?: XRCamera;
  projectionMatrix: Float32Array;
  transform: XRRigidTransform;
}

interface XRCamera {
  width: number;
  height: number;
}

interface XRRigidTransform {
  matrix: Float32Array;
}

interface XRSystem {
  isSessionSupported(mode: XRSessionMode): Promise<boolean>;
  requestSession(mode: XRSessionMode, options?: XRSessionInit): Promise<XRSession>;
}

type XRWebGLLayer = object;

interface XRWebGLBindingConstructor {
  new (
    session: XRSession,
    context: WebGLRenderingContext | WebGL2RenderingContext
  ): XRWebGLBindingCameraAccess;
}

interface XRWebGLBindingCameraAccess {
  getCameraImage(camera: XRCamera): WebGLTexture | null;
}

interface Navigator {
  xr?: XRSystem;
}
