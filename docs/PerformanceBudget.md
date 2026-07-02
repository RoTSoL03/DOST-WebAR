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

