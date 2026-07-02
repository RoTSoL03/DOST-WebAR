import type { RuntimeKind } from "../config/runtime";

export interface RuntimeStartOptions {
  canvas: HTMLCanvasElement;
  selectedMascotId: string;
}

export interface MascotTransform {
  position: { x: number; y: number; z: number };
  rotationY: number;
  scale: number;
}

export interface CaptureResult {
  blob: Blob;
  fileName: string;
}

export interface RuntimeAdapter {
  readonly kind: RuntimeKind;
  isSupported(): Promise<boolean>;
  start(options: RuntimeStartOptions): Promise<void>;
  placeMascot?(input: MascotTransform): void;
  updateMascotTransform(transform: MascotTransform): void;
  capture(): Promise<CaptureResult>;
  end(): Promise<void>;
}
