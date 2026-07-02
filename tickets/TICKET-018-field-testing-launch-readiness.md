# TICKET-018: Field Testing And Launch Readiness

## Purpose

Run real-device and venue-readiness validation before public event use.

## Dependencies

- TICKET-007
- TICKET-008
- TICKET-011
- TICKET-012
- TICKET-017

## Implementation Notes

- Use `docs/FieldTestingRunbook.md`.
- Test representative Android and iOS devices.
- Test venue Wi-Fi and cellular.
- Test lighting and surface variety.
- Validate QR placement and scan speed.
- Validate rollback readiness.

## Acceptance Criteria

- Device matrix results are recorded.
- P0 and P1 issues are resolved.
- Rollback procedure is tested.
- Event staff have a support checklist.

## Testing Requirements

- Manual field testing is mandatory.
- Capture evidence should not include uploaded user photos.

## Risks And Pitfalls

- Lab success does not guarantee venue success.
- Event Wi-Fi congestion can dominate perceived performance.

## Complexity

Medium

