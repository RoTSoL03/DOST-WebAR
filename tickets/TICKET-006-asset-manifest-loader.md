# TICKET-006: Asset Manifest And Model Loader

## Purpose

Implement manifest-driven mascot loading with lazy loading and validation hooks.

## Dependencies

- TICKET-005

## Implementation Notes

- Define mascot manifest schema.
- Load thumbnails and metadata before model files.
- Load selected mascot only.
- Support GLB loading with Draco and KTX2/BasisU configuration.
- Expose loading progress.
- Dispose previously loaded mascot when switching if memory requires it.

## Acceptance Criteria

- Placeholder manifest supports four mascot entries.
- Selected model loads into rendering engine.
- Loading progress is visible to state/UI.
- Failed model loads produce typed errors.

## Testing Requirements

- Unit tests for manifest validation.
- Integration test for model load success/failure using mock loader.

## Risks And Pitfalls

- Do not preload all production GLBs on first page load.
- Ensure decoder asset paths work after static deployment.

## Complexity

High

