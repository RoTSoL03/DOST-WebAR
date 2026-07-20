import type {
  SegmentationMaskMessage,
  SegmentationWorkerRequest,
  SegmentationWorkerResponse
} from "./personSegmentationProtocol";

interface PersonSegmentationClientOptions {
  onMask: (message: SegmentationMaskMessage) => void;
  onUnavailable?: () => void;
}

export class PersonSegmentationClient {
  private readonly worker: Worker | null;
  private readonly onMask: PersonSegmentationClientOptions["onMask"];
  private readonly onUnavailable?: PersonSegmentationClientOptions["onUnavailable"];
  private ready = false;
  private busy = false;
  private disposed = false;

  constructor({ onMask, onUnavailable }: PersonSegmentationClientOptions) {
    this.onMask = onMask;
    this.onUnavailable = onUnavailable;

    if (typeof Worker === "undefined") {
      this.worker = null;
      this.onUnavailable?.();
      return;
    }

    this.worker = new Worker(new URL("./personSegmentation.worker.ts", import.meta.url), {
      type: "module"
    });
    this.worker.onmessage = (event: MessageEvent<SegmentationWorkerResponse>) => {
      if (this.disposed) {
        return;
      }

      if (event.data.type === "ready") {
        this.ready = true;
        return;
      }

      if (event.data.type === "mask") {
        this.busy = false;
        this.onMask(event.data);
        return;
      }

      this.disable();
    };
    this.worker.onerror = () => this.disable();

    this.post({
      type: "init",
      modelUrl: `${import.meta.env.BASE_URL}models/selfie_segmenter.tflite`
    });
  }

  tryProcess(image: ImageData, timestamp: number) {
    if (!this.worker || !this.ready || this.busy || this.disposed) {
      return false;
    }

    // The sampler creates this ImageData exclusively for the worker. Transfer
    // its existing buffer instead of allocating and copying a second frame.
    const pixels = image.data;
    const pixelBuffer = pixels.buffer as ArrayBuffer;
    this.busy = true;
    this.post(
      {
        type: "frame",
        pixels: pixelBuffer,
        width: image.width,
        height: image.height,
        timestamp
      },
      [pixelBuffer]
    );
    return true;
  }

  dispose() {
    this.disposed = true;
    this.worker?.terminate();
  }

  private disable() {
    if (this.disposed) {
      return;
    }

    this.ready = false;
    this.busy = false;
    this.onUnavailable?.();
    this.worker?.terminate();
  }

  private post(message: SegmentationWorkerRequest, transfer: Transferable[] = []) {
    this.worker?.postMessage(message, transfer);
  }
}
