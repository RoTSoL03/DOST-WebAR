/**
 * Copies the opaque, runtime-owned XR camera texture into a small RGBA render
 * target. This avoids a full-resolution readback for every ML inference.
 */
export class XRCameraFrameSampler {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly vertexArray: WebGLVertexArrayObject;
  private readonly framebuffer: WebGLFramebuffer;
  private readonly targetTexture: WebGLTexture;
  private readonly cameraSamplerLocation: WebGLUniformLocation;
  private targetWidth = 0;
  private targetHeight = 0;
  private pixels = new Uint8ClampedArray(0);

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.program = createProgram(gl);
    this.vertexArray = requireResource(gl.createVertexArray(), "camera sampler vertex array");
    this.framebuffer = requireResource(gl.createFramebuffer(), "camera sampler framebuffer");
    this.targetTexture = requireResource(gl.createTexture(), "camera sampler texture");
    this.cameraSamplerLocation = requireResource(
      gl.getUniformLocation(this.program, "uCameraTexture"),
      "camera sampler uniform"
    );
  }

  sample(
    frame: XRFrame,
    referenceSpace: XRReferenceSpace,
    binding: XRWebGLBindingCameraAccess,
    width?: number,
    height?: number
  ): ImageData | null {
    const view = frame.getViewerPose(referenceSpace)?.views.find((candidate) => candidate.camera);
    const camera = view?.camera;

    if (!camera) {
      return null;
    }

    let cameraTexture: WebGLTexture | null = null;
    try {
      cameraTexture = binding.getCameraImage(camera);
    } catch {
      return null;
    }

    if (!cameraTexture) {
      return null;
    }

    this.ensureTarget(width ?? camera.width, height ?? camera.height);
    const gl = this.gl;
    const requiredPixelCount = this.targetWidth * this.targetHeight * 4;
    if (this.pixels.byteLength !== requiredPixelCount) {
      this.pixels = new Uint8ClampedArray(requiredPixelCount);
    }
    const previousFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const previousProgram = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null;
    const previousVertexArray = gl.getParameter(
      gl.VERTEX_ARRAY_BINDING
    ) as WebGLVertexArrayObject | null;
    const previousViewport = gl.getParameter(gl.VIEWPORT) as Int32Array;
    const previousActiveTexture = gl.getParameter(gl.ACTIVE_TEXTURE) as number;
    const previousDepthTest = gl.isEnabled(gl.DEPTH_TEST);
    const previousBlend = gl.isEnabled(gl.BLEND);
    const previousCullFace = gl.isEnabled(gl.CULL_FACE);
    const previousScissorTest = gl.isEnabled(gl.SCISSOR_TEST);
    const previousColorMask = gl.getParameter(gl.COLOR_WRITEMASK) as boolean[];

    gl.activeTexture(gl.TEXTURE0);
    const previousTexture0 = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;

    try {
      while (gl.getError() !== gl.NO_ERROR) {
        // Ignore errors produced by the preceding XR renderer work.
      }
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.SCISSOR_TEST);
      gl.colorMask(true, true, true, true);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
      gl.viewport(0, 0, this.targetWidth, this.targetHeight);
      gl.useProgram(this.program);
      gl.bindVertexArray(this.vertexArray);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, cameraTexture);
      gl.uniform1i(this.cameraSamplerLocation, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.readPixels(
        0,
        0,
        this.targetWidth,
        this.targetHeight,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        this.pixels
      );

      if (gl.getError() !== gl.NO_ERROR) {
        return null;
      }

      return new ImageData(this.pixels, this.targetWidth, this.targetHeight);
    } finally {
      gl.bindTexture(gl.TEXTURE_2D, previousTexture0);
      gl.activeTexture(previousActiveTexture);
      gl.bindVertexArray(previousVertexArray);
      gl.useProgram(previousProgram);
      gl.bindFramebuffer(gl.FRAMEBUFFER, previousFramebuffer);
      gl.viewport(
        previousViewport[0] ?? 0,
        previousViewport[1] ?? 0,
        previousViewport[2] ?? 1,
        previousViewport[3] ?? 1
      );
      restoreEnabled(gl, gl.DEPTH_TEST, previousDepthTest);
      restoreEnabled(gl, gl.BLEND, previousBlend);
      restoreEnabled(gl, gl.CULL_FACE, previousCullFace);
      restoreEnabled(gl, gl.SCISSOR_TEST, previousScissorTest);
      gl.colorMask(
        previousColorMask[0] ?? true,
        previousColorMask[1] ?? true,
        previousColorMask[2] ?? true,
        previousColorMask[3] ?? true
      );
    }
  }

  dispose() {
    const gl = this.gl;
    gl.deleteTexture(this.targetTexture);
    gl.deleteFramebuffer(this.framebuffer);
    gl.deleteVertexArray(this.vertexArray);
    gl.deleteProgram(this.program);
  }

  private ensureTarget(width: number, height: number) {
    const nextWidth = Math.max(1, Math.floor(width));
    const nextHeight = Math.max(1, Math.floor(height));

    if (this.targetWidth === nextWidth && this.targetHeight === nextHeight) {
      return;
    }

    const gl = this.gl;
    const previousFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const previousActiveTexture = gl.getParameter(gl.ACTIVE_TEXTURE) as number;
    gl.activeTexture(gl.TEXTURE0);
    const previousTexture0 = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;

    this.targetWidth = nextWidth;
    this.targetHeight = nextHeight;
    this.pixels = new Uint8ClampedArray(nextWidth * nextHeight * 4);

    gl.bindTexture(gl.TEXTURE_2D, this.targetTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      nextWidth,
      nextHeight,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.targetTexture,
      0
    );

    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error("Camera sampler framebuffer is incomplete.");
    }

    gl.bindTexture(gl.TEXTURE_2D, previousTexture0);
    gl.activeTexture(previousActiveTexture);
    gl.bindFramebuffer(gl.FRAMEBUFFER, previousFramebuffer);
  }
}

function createProgram(gl: WebGL2RenderingContext) {
  const vertexShader = compileShader(
    gl,
    gl.VERTEX_SHADER,
    `#version 300 es
out vec2 vUv;
void main() {
  vec2 position = gl_VertexID == 0 ? vec2(-1.0, -1.0) :
    (gl_VertexID == 1 ? vec2(3.0, -1.0) : vec2(-1.0, 3.0));
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`
  );
  const fragmentShader = compileShader(
    gl,
    gl.FRAGMENT_SHADER,
    `#version 300 es
precision mediump float;
uniform sampler2D uCameraTexture;
in vec2 vUv;
out vec4 outColor;
void main() {
  // Flip in the GPU pass so readPixels already has ImageData's top-left row
  // order. This removes a full CPU frame copy and row-flip loop per inference.
  outColor = texture(uCameraTexture, vec2(vUv.x, 1.0 - vUv.y));
}`
  );
  const program = requireResource(gl.createProgram(), "camera sampler program");
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) ?? "Unknown camera sampler link error.";
    gl.deleteProgram(program);
    throw new Error(message);
  }

  return program;
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = requireResource(gl.createShader(type), "camera sampler shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? "Unknown camera sampler compile error.";
    gl.deleteShader(shader);
    throw new Error(message);
  }

  return shader;
}

function restoreEnabled(gl: WebGL2RenderingContext, capability: number, enabled: boolean) {
  if (enabled) {
    gl.enable(capability);
  } else {
    gl.disable(capability);
  }
}

function requireResource<T>(resource: T | null, name: string): T {
  if (!resource) {
    throw new Error(`Unable to create ${name}.`);
  }

  return resource;
}
