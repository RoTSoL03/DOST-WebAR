# TICKET-003: Capability Detection Service

## Purpose

Build feature-based capability detection for runtime selection and user messaging.

## Dependencies

- TICKET-001

## Implementation Notes

Detect:

- mobile form factor
- WebGL2
- WebAssembly
- camera availability
- WebXR availability
- `immersive-ar` support
- native share support
- browser and OS family for diagnostics

Avoid relying on exhaustive device allowlists.

## Acceptance Criteria

- Service returns a typed capability result.
- WebXR checks are asynchronous.
- Service does not request camera permission.
- Runtime recommendation can be derived from capabilities.

## Testing Requirements

- Unit tests with mocked browser APIs.
- Tests for WebXR available, camera fallback, and unsupported paths.

## Risks And Pitfalls

- Do not trigger permission prompts during detection.
- Browser API availability may differ between secure and insecure contexts.

## Complexity

Medium

