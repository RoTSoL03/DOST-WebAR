type XRSessionMode = "immersive-ar";
type XRReferenceSpaceType = "local" | "local-floor" | "viewer";
type XRDepthUsage = "cpu-optimized" | "gpu-optimized";
type XRDepthDataFormat = "luminance-alpha" | "float32" | "unsigned-short";
type XRDepthType = "raw" | "smooth";

interface XRSessionInit {
  requiredFeatures?: string[];
  optionalFeatures?: string[];
  depthSensing?: {
    usagePreference: XRDepthUsage[];
    dataFormatPreference: XRDepthDataFormat[];
    depthTypeRequest?: XRDepthType[];
    matchDepthView?: boolean;
  };
  domOverlay?: {
    root: Element;
  };
}

interface XRFrame {
  getHitTestResults(hitTestSource: XRHitTestSource): XRHitTestResult[];
  getViewerPose(referenceSpace: XRReferenceSpace): XRViewerPose | null;
  getPose(space: XRSpace, baseSpace: XRSpace): XRPose | null;
  getDepthInformation?(view: XRView): XRCPUDepthInformation | null;
}

interface XRHitTestOptionsInit {
  space: XRSpace;
  offsetRay?: XRRay;
}

interface XRHitTestSource {
  cancel(): void;
}

interface XRHitTestResult {
  getPose(baseSpace: XRSpace): XRPose | null;
  createAnchor?: () => Promise<XRAnchor>;
}

interface XRInputSourceEvent extends Event {
  frame: XRFrame;
}

type XRReferenceSpace = XRSpace;

interface XRRenderStateInit {
  baseLayer?: XRWebGLLayer;
}

interface XRSession extends EventTarget {
  readonly enabledFeatures?: readonly string[];
  readonly depthUsage?: XRDepthUsage;
  readonly depthDataFormat?: XRDepthDataFormat;
  readonly depthType?: XRDepthType | null;
  readonly depthActive?: boolean | null;
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

interface XRAnchor {
  readonly anchorSpace: XRSpace;
  delete(): void;
}

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

interface XRCPUDepthInformation {
  readonly data: ArrayBuffer;
  readonly width: number;
  readonly height: number;
  readonly normDepthBufferFromNormView: XRRigidTransform;
  readonly rawValueToMeters: number;
  getDepthInMeters(x: number, y: number): number;
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
