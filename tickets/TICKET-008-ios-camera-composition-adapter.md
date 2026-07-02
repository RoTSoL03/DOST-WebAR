# TICKET-008: iOS Camera-Composition Runtime Adapter

## Purpose

Implement the fully in-browser fallback runtime for iPhone Safari and other non-WebXR mobile browsers.

## Dependencies

- TICKET-003
- TICKET-005
- TICKET-006

## Implementation Notes

- Start camera through `getUserMedia` only from user gesture.
- Render camera feed full-screen.
- Overlay Three.js mascot rendering.
- Provide manual placement on screen.
- Support drag, scale, and rotate.
- Stop media tracks on session end.

## Acceptance Criteria

- iPhone Safari can start the fallback flow.
- Camera feed appears.
- Mascot appears over the camera feed.
- User can position, scale, and rotate mascot.
- Session ends and camera indicator turns off.

## Testing Requirements

- Real iPhone Safari test required.
- Unit tests for adapter state with mocked media APIs.

## Risks And Pitfalls

- iOS video/canvas behavior can be restrictive.
- Capture composition must be validated on real devices.
- Manual placement copy must not imply true floor anchoring.

## Complexity

High

