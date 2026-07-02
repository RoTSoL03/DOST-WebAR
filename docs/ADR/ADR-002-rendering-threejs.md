# ADR-002: Use Three.js For Rendering

## Status

Accepted

## Context

The application must render animated 3D mascot models in browser-based AR and fallback camera-composition modes. It must support GLB assets, mobile WebGL, and WebXR.

## Decision

Use Three.js as the rendering engine.

## Consequences

- Mature WebGL and WebXR support.
- Strong GLB, animation, and texture compression ecosystem.
- Flexible enough to share rendering across WebXR and camera-composition fallback.
- Requires careful ownership of renderer lifecycle, memory disposal, and performance tuning.

## Alternatives

- Babylon.js: strong engine with batteries included, but heavier and less aligned with the requested direction.
- PlayCanvas: viable but introduces a different platform/tooling model.
- Custom WebGL: too costly and risky for the project scope.

