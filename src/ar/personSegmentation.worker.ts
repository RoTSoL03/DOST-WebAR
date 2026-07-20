import { ImageSegmenter } from "@mediapipe/tasks-vision";
import visionWasmBinaryUrl from "@mediapipe/tasks-vision/vision_wasm_module_internal.wasm?url";
import visionWasmLoaderUrl from "@mediapipe/tasks-vision/vision_wasm_module_internal.js?url";

import { refinePersonMask } from "./personMaskProcessing";
import type {
  SegmentationWorkerRequest,
  SegmentationWorkerResponse
} from "./personSegmentationProtocol";

interface WorkerScope {
  onmessage: ((event: MessageEvent<SegmentationWorkerRequest>) => void) | null;
  postMessage(message: SegmentationWorkerResponse, transfer?: Transferable[]): void;
}

const workerScope = self as unknown as WorkerScope;
let segmenter: ImageSegmenter | null = null;
let personMaskIndex = 1;
let previousMask: Uint8Array | null = null;

workerScope.onmessage = (event) => {
  if (event.data.type === "init") {
    void initialize(event.data.modelUrl);
    return;
  }

  if (!segmenter) {
    postError("Person segmentation is not ready.");
    return;
  }

  try {
    const frameMessage = event.data;
    const image = new ImageData(
      new Uint8ClampedArray(frameMessage.pixels),
      frameMessage.width,
      frameMessage.height
    );

    segmenter.segmentForVideo(image, frameMessage.timestamp, (result) => {
      try {
        const masks = result.confidenceMasks;
        const personMask = masks?.[Math.min(personMaskIndex, (masks?.length ?? 1) - 1)];

        if (!personMask) {
          postError("The segmentation model returned no person mask.");
          return;
        }

        const refined = refinePersonMask(
          personMask.getAsFloat32Array(),
          previousMask,
          personMask.width,
          personMask.height
        );
        // Keep a local copy because the response buffer is transferred (and is
        // therefore detached from this worker) below.
        previousMask = refined.slice();
        workerScope.postMessage(
          {
            type: "mask",
            mask: refined.buffer,
            width: personMask.width,
            height: personMask.height,
            timestamp: frameMessage.timestamp
          },
          [refined.buffer]
        );
      } finally {
        result.close();
      }
    });
  } catch (error) {
    postError(error instanceof Error ? error.message : "Person segmentation failed.");
  }
};

async function initialize(modelUrl: string) {
  try {
    // Pass Vite-emitted asset URLs directly. Pointing FilesetResolver at
    // /public makes its dynamic module import pass through Vite's source
    // pipeline, which Vite intentionally rejects during development.
    const fileset = {
      wasmLoaderPath: visionWasmLoaderUrl,
      wasmBinaryPath: visionWasmBinaryUrl
    };
    segmenter = await ImageSegmenter.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: modelUrl,
        delegate: "CPU"
      },
      runningMode: "VIDEO",
      outputConfidenceMasks: true,
      outputCategoryMask: false
    });
    const labels = segmenter.getLabels();
    const detectedPersonIndex = labels.findIndex((label) => label.toLowerCase() === "person");
    personMaskIndex = detectedPersonIndex >= 0 ? detectedPersonIndex : 1;
    workerScope.postMessage({ type: "ready" });
  } catch (error) {
    postError(error instanceof Error ? error.message : "Person segmentation failed to load.");
  }
}

function postError(message: string) {
  workerScope.postMessage({ type: "error", message });
}
