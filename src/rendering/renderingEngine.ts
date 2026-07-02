export interface RenderingEngineOptions {
  canvas: HTMLCanvasElement;
  maxDevicePixelRatio: number;
}

export interface RenderingEngine {
  start(): void;
  stop(): void;
  dispose(): void;
}

export function createRenderingEnginePlaceholder(options: RenderingEngineOptions): RenderingEngine {
  void options;

  return {
    start: () => undefined,
    stop: () => undefined,
    dispose: () => undefined
  };
}
