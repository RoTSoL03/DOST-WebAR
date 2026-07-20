# Performance Budget

## Product Targets

| Metric | Target |
| --- | --- |
| Initial page load on Wi-Fi | Under 5 seconds |
| AR ready after opening | Under 10 seconds |
| First mascot load after selection | Under 3 seconds |
| Runtime frame rate | 30-60 FPS |
| Minimum acceptable frame rate | 30 FPS |

## Asset Budgets

| Asset Type | Budget |
| --- | --- |
| Mascot format | GLB |
| Geometry compression | Draco |
| Texture compression | KTX2/BasisU |
| Triangles per mascot | 20,000-50,000 |
| Texture resolution | 1024x1024 preferred, 2048x2048 maximum |
| Required animation | idle |
| Recommended animation | wave |
| Optional animation | pose |

## Loading Strategy

- Initial load includes app shell, critical UI, capability detection, and mascot metadata only.
- Mascot models are lazy loaded after mascot selection.
- AR runtime code should be split from the initial shell.
- Previously loaded mascot assets should be available through PWA cache when possible.

## Rendering Strategy

- Use one active mascot at a time.
- Prefer baked lighting.
- Avoid expensive post-processing.
- Cap mobile device pixel ratio dynamically.
- Reduce shadow complexity or disable dynamic shadows on weak devices.
- Pause work when the session is hidden or ended.
- Keep depth processing and the segmentation worker inactive until the first mascot is placed. During later placement or repositioning passes, halve their update cadence so floor hit testing owns most of the scan-phase frame budget.
- Combine native CPU depth with the MediaPipe person mask: depth handles world geometry while the semantic mask preserves human occlusion around noisy depth edges.
- Run person segmentation in a worker at 224/176/144 square resolution and 6/4/3 FPS on high/mid/low tiers.
- Throttle CPU depth uploads to 20/15/10 FPS on high/mid/low tiers.
- Transfer sampled camera buffers directly to the worker and perform the vertical flip in the GPU sampling pass to avoid redundant per-frame copies.
- Copy only the downsampled camera frame for inference and cap explicit photo capture at a 1280-pixel longest edge to avoid Android GPU/readback memory spikes.
- Prefer WebXR CPU depth when available and share one depth texture and one person-mask texture across all mascot materials.

## Memory Strategy

- Dispose inactive geometries, textures, and materials.
- Stop camera tracks on session end.
- Release WebXR session resources on end.
- Avoid keeping all four mascot models resident in memory.

## Measurement Requirements

Implementation should expose development-only metrics:

- Initial load time.
- Mascot load time.
- AR ready time.
- Average FPS.
- Lowest recent FPS.
- Capture time.
- Asset load failures.
- Runtime errors.

Production analytics must remain disabled unless approved by DOST.
