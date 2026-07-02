# Testing Strategy

## Testing Goals

- Confirm the core user journey works on representative Android and iOS devices.
- Detect regressions in runtime selection, capture, performance, and offline behavior.
- Validate privacy and security constraints.
- Prepare the app for live event conditions.

## Unit Tests

Cover:

- Capability detection.
- Runtime adapter selection.
- Session state transitions.
- Asset manifest validation.
- Error mapping.
- Analytics gating.

Recommended tools:

- Vitest.
- React Testing Library.

## Integration Tests

Cover:

- Mascot selection to model load.
- Permission start flow.
- Unsupported browser flow.
- Capture preview flow.
- Offline cache status flow.

Mock browser APIs where real hardware is unavailable.

## End-To-End Tests

Use Playwright for non-AR browser flows:

- App loads.
- Desktop unsupported state appears.
- Mobile-emulated mascot selection works.
- Error screens render.
- Capture UI flow can be exercised with mocked services.

Real WebXR and camera behavior must be validated on physical devices.

## Device Testing

Test on the representative matrix in `docs/DeviceSupportMatrix.md`.

Each device should validate:

- QR launch.
- First load timing.
- Permission prompt.
- Runtime selected.
- Placement or fallback placement.
- Rotate and scale.
- Capture.
- Download or native share.
- Repeat visit with cached assets.

## Performance Testing

Measure:

- Initial page load.
- Mascot load time.
- AR ready time.
- FPS.
- Memory pressure symptoms.
- Battery and thermal behavior during repeated sessions.

## Accessibility Testing

Validate:

- Touch target size.
- High contrast.
- Safe-area layout.
- Clear permission copy.
- Keyboard and screen reader basics for non-AR UI.
- Error messages that explain next steps.

## Privacy Testing

Confirm:

- No photo upload.
- No camera frame upload.
- No GPS collection.
- No PII collection.
- Production analytics are disabled unless approved.

## Field Testing

Before public launch, run a venue rehearsal:

- Scan the real event QR code.
- Use event Wi-Fi and cellular data.
- Test under venue lighting.
- Test with foot traffic and crowd movement.
- Test on reflective floors, carpet, and tables.
- Confirm fallback messaging is understandable to non-technical users.

