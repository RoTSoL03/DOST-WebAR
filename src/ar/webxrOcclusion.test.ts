import { decodeDepthToMeters } from "./webxrOcclusion";

describe("decodeDepthToMeters", () => {
  it("decodes 16-bit depth values", () => {
    const source = new Uint16Array([0, 1000, 2500]);
    const target = new Float32Array(3);

    decodeDepthToMeters(source.buffer, "unsigned-short", 0.001, target);

    expect(Array.from(target)).toEqual([0, 1, 2.5]);
  });

  it("decodes float depth values using the runtime scale", () => {
    const source = new Float32Array([0, 1.5, 4]);
    const target = new Float32Array(3);

    decodeDepthToMeters(source.buffer, "float32", 2, target);

    expect(Array.from(target)).toEqual([0, 3, 8]);
  });
});

