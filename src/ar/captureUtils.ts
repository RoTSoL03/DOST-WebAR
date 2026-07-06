export interface CapturedPhoto {
  blob: Blob;
  fileName: string;
  url: string;
}

export function get2DContext(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("2D canvas is unavailable.");
  }

  return context;
}

export function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }

      reject(new Error("Canvas capture failed."));
    }, "image/png");
  });
}

export function createCaptureFileName() {
  return `dost-webar-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
}

export function downloadCapturedPhoto(photo: CapturedPhoto) {
  const link = document.createElement("a");
  link.href = photo.url;
  link.download = photo.fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
}
