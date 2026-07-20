/** Blends masks over time, then applies a softly dilated 3x3 edge filter. */
export function refinePersonMask(
  current: Float32Array,
  previous: Uint8Array | null,
  width: number,
  height: number
) {
  const blended = new Uint8Array(width * height);
  const output = new Uint8Array(width * height);

  for (let index = 0; index < blended.length; index += 1) {
    const currentByte = Math.round(Math.max(0, Math.min(1, current[index] ?? 0)) * 255);
    const previousByte = previous?.[index] ?? currentByte;
    blended[index] = Math.round(currentByte * 0.62 + previousByte * 0.38);
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let maximum = 0;
      let weightedTotal = 0;
      let totalWeight = 0;

      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        const sampleY = Math.max(0, Math.min(height - 1, y + offsetY));
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const sampleX = Math.max(0, Math.min(width - 1, x + offsetX));
          const sample = blended[sampleY * width + sampleX] ?? 0;
          const weight =
            offsetX === 0 && offsetY === 0 ? 4 : offsetX === 0 || offsetY === 0 ? 2 : 1;
          maximum = Math.max(maximum, sample);
          weightedTotal += sample * weight;
          totalWeight += weight;
        }
      }

      const weightedAverage = weightedTotal / totalWeight;
      output[y * width + x] = Math.round(weightedAverage * 0.72 + maximum * 0.28);
    }
  }

  return output;
}
