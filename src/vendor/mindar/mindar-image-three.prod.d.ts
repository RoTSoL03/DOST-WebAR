import type { Group, PerspectiveCamera, Scene, WebGLRenderer } from "three";

export interface MindARThreeOptions {
  container: HTMLElement;
  imageTargetSrc: string;
  maxTrack?: number;
  uiLoading?: "yes" | "no";
  uiScanning?: "yes" | "no";
  uiError?: "yes" | "no";
  filterMinCF?: number | null;
  filterBeta?: number | null;
  warmupTolerance?: number | null;
  missTolerance?: number | null;
  userDeviceId?: string | null;
  environmentDeviceId?: string | null;
}

export interface MindARAnchor {
  group: Group;
  targetIndex: number;
  visible: boolean;
  onTargetFound: (() => void) | null;
  onTargetLost: (() => void) | null;
  onTargetUpdate: (() => void) | null;
}

export class MindARThree {
  constructor(options: MindARThreeOptions);

  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  scene: Scene;
  video?: HTMLVideoElement;

  addAnchor(targetIndex: number): MindARAnchor;
  resize(): void;
  start(): Promise<void>;
  stop(): void;
}
