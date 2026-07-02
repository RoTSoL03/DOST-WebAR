# TICKET-011: Local Capture, Download, And Share

## Purpose

Generate user photos locally and support download or native share.

## Dependencies

- TICKET-007
- TICKET-008
- TICKET-010

## Implementation Notes

- Do not upload images.
- WebXR capture path must be validated on target Android devices.
- Camera fallback capture should composite video frame and WebGL canvas.
- Use native share where available.
- Provide download fallback.

## Acceptance Criteria

- User can capture the current scene.
- Captured image stays local.
- User can download image.
- Native share is offered where supported.
- Capture failures show recoverable error.

## Testing Requirements

- Real Android capture test.
- Real iPhone capture test.
- Unit test ensuring capture service has no network dependency.

## Risks And Pitfalls

- Camera and WebGL compositing behavior can vary by browser.
- Canvas tainting must be avoided by correct asset CORS setup.

## Complexity

High

