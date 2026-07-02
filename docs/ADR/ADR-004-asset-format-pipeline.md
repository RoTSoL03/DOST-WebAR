# ADR-004: Use GLB With Draco And KTX2/BasisU

## Status

Accepted

## Context

The app must load quickly on mobile event networks and sustain 30-60 FPS on mid-range devices. Four mascot models will be provided by DOST, with placeholders during development.

## Decision

Use GLB for models, Draco for geometry compression, and KTX2/BasisU for texture compression.

## Consequences

- Smaller downloads and better mobile GPU compatibility.
- Requires an asset optimization pipeline.
- Requires validation of triangle counts, texture sizes, animation clips, and file sizes.
- Final visual quality depends on correct export settings.

## Alternatives

- Uncompressed GLB: simpler but likely violates load and memory targets.
- USDZ: useful for Apple Quick Look but not the MVP runtime format.
- FBX or source DCC formats: useful for artists, not for runtime delivery.

