import { refinePersonMask } from "./personMaskProcessing";

describe("refinePersonMask", () => {
  it("softly expands a detected person pixel without creating a block edge", () => {
    const source = new Float32Array(9);
    source[4] = 1;
    const result = refinePersonMask(source, null, 3, 3);

    expect(result[4]).toBeGreaterThan(result[0] ?? 0);
    expect(result[0]).toBeGreaterThan(0);
    expect(result[4]).toBeLessThan(255);
  });

  it("uses the preceding mask to reduce temporal flicker", () => {
    const previous = new Uint8Array([255]);
    const result = refinePersonMask(new Float32Array([0]), previous, 1, 1);

    expect(result[0]).toBeGreaterThan(0);
    expect(result[0]).toBeLessThan(255);
  });
});
