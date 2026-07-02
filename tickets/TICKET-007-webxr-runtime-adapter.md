# TICKET-007: WebXR Runtime Adapter

## Purpose

Implement the Android markerless AR path using WebXR.

## Dependencies

- TICKET-003
- TICKET-005
- TICKET-006

## Implementation Notes

- Check `navigator.xr`.
- Check `isSessionSupported("immersive-ar")`.
- Start session only from user gesture.
- Request hit-test support.
- Create reference space.
- Show placement reticle.
- Place mascot on tap.
- Handle session visibility changes.
- End session cleanly.

## Acceptance Criteria

- WebXR session starts on a supported Android device.
- Reticle appears when a surface is detected.
- Mascot can be placed on a surface.
- Session can be ended without camera or renderer leaks.
- Unsupported WebXR conditions fall back cleanly.

## Testing Requirements

- Unit tests with mocked WebXR APIs for adapter state.
- Real Android device test required.

## Risks And Pitfalls

- WebXR requires HTTPS and user gesture.
- Hit-test behavior varies by device and environment.
- Do not assume anchors are available.

## Complexity

High

