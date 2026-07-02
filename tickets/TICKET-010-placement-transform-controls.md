# TICKET-010: Placement And Transform Controls

## Purpose

Implement placement confirmation, rotation, and scaling across both runtimes.

## Dependencies

- TICKET-007
- TICKET-008
- TICKET-009

## Implementation Notes

- WebXR placement uses hit-test reticle and tap-to-place.
- Camera fallback placement uses screen-space controls.
- Rotation and scale should share domain transform logic.
- Use touch-friendly controls and gestures.

## Acceptance Criteria

- Mascot can be placed.
- Mascot can be rotated.
- Mascot can be scaled.
- Controls work in WebXR and camera fallback.
- Transform state survives capture.

## Testing Requirements

- Unit tests for transform calculations.
- Real-device gesture tests.

## Risks And Pitfalls

- Browser gestures may conflict with pinch/drag.
- Scaling must be clamped to prevent unusable sizes.

## Complexity

High

