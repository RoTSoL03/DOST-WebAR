# TICKET-004: Zustand State Management

## Purpose

Create the global state model for the user journey.

## Dependencies

- TICKET-001
- TICKET-003

## Implementation Notes

State should include:

- selected mascot id
- active runtime kind
- session status
- loading progress
- capture status
- cache status
- user-facing error

Use explicit session states from `docs/Architecture.md`.

## Acceptance Criteria

- Store exposes typed actions.
- Invalid transitions are minimized through action design.
- Three.js objects, WebXR sessions, and media streams are not stored in Zustand.

## Testing Requirements

- Unit tests for state transitions.
- Unit tests for error reset behavior.

## Risks And Pitfalls

- Avoid loose boolean combinations such as `isLoading`, `isReady`, and `hasError` becoming contradictory.

## Complexity

Medium

