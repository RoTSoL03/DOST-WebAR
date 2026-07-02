# TICKET-016: Testing Automation

## Purpose

Implement the automated test foundation for unit, integration, and non-AR browser flows.

## Dependencies

- TICKET-001
- TICKET-002
- TICKET-003
- TICKET-004

## Implementation Notes

- Add Vitest setup.
- Add React Testing Library setup.
- Add Playwright for non-AR smoke flows.
- Mock camera and WebXR APIs where needed.
- Include CI scripts.

## Acceptance Criteria

- Unit tests run in CI.
- Playwright smoke test runs against built app or dev server.
- Capability and unsupported-state paths are covered.

## Testing Requirements

- This ticket creates the test requirements for the project.

## Risks And Pitfalls

- Automated tests cannot replace real-device AR tests.
- Avoid brittle visual assertions for AR canvas content.

## Complexity

Medium

