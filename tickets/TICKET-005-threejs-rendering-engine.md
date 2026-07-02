# TICKET-005: Three.js Rendering Engine

## Purpose

Implement the shared Three.js rendering layer used by WebXR and camera-composition modes.

## Dependencies

- TICKET-001
- TICKET-004

## Implementation Notes

Create a rendering service responsible for:

- renderer lifecycle
- scene lifecycle
- camera setup
- lights
- mascot root node
- animation mixer
- render loop hooks
- resize handling
- resource disposal

Do not bind per-frame state to React.

## Acceptance Criteria

- Placeholder GLB or primitive can be rendered.
- Renderer can attach to a canvas/container.
- Renderer can start, pause, resume, and stop.
- Resources are disposed on teardown.
- Pixel ratio is capped for mobile.

## Testing Requirements

- Unit tests for lifecycle methods where feasible.
- Manual browser smoke test.

## Risks And Pitfalls

- Creating objects inside the frame loop can cause memory churn.
- Unreleased textures and geometries can crash mobile sessions.

## Complexity

High

