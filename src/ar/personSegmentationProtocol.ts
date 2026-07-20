export interface SegmentationInitMessage {
  type: "init";
  modelUrl: string;
}

export interface SegmentationFrameMessage {
  type: "frame";
  pixels: ArrayBuffer;
  width: number;
  height: number;
  timestamp: number;
}

export interface SegmentationReadyMessage {
  type: "ready";
}

export interface SegmentationMaskMessage {
  type: "mask";
  mask: ArrayBuffer;
  width: number;
  height: number;
  timestamp: number;
}

export interface SegmentationErrorMessage {
  type: "error";
  message: string;
}

export type SegmentationWorkerRequest = SegmentationInitMessage | SegmentationFrameMessage;
export type SegmentationWorkerResponse =
  | SegmentationReadyMessage
  | SegmentationMaskMessage
  | SegmentationErrorMessage;
