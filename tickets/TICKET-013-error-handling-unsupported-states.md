# TICKET-013: Error Handling And Unsupported States

## Purpose

Provide typed errors and clear user-facing recovery messages.

## Dependencies

- TICKET-002
- TICKET-003
- TICKET-004

## Implementation Notes

Handle:

- desktop unsupported
- browser unsupported
- camera denied
- WebXR unavailable
- asset load failure
- capture failure
- offline asset unavailable
- low performance warning

## Acceptance Criteria

- Every known failure path maps to a user-facing message.
- Messages are concise and actionable.
- Technical details are not shown to public users.
- Errors can be reset or retried where possible.

## Testing Requirements

- Unit tests for error mapping.
- Component tests for error screens.

## Risks And Pitfalls

- Avoid vague errors such as "Something went wrong".
- Avoid blaming the user for browser limitations.

## Complexity

Medium

