# TICKET-009: Mascot Selection Flow

## Purpose

Build the four-mascot selection experience and connect it to lazy asset loading.

## Dependencies

- TICKET-002
- TICKET-004
- TICKET-006

## Implementation Notes

- Show four mascot choices from manifest metadata.
- Use lightweight thumbnails.
- Load selected model after selection.
- Show progress and recoverable errors.
- Do not request camera permission during selection.

## Acceptance Criteria

- User can choose one of four mascots.
- Selected mascot id is stored.
- Selected mascot model begins loading.
- Load failure allows retry or another selection.

## Testing Requirements

- Component tests for selection.
- Integration test for selected mascot load trigger.

## Risks And Pitfalls

- Avoid loading heavy models before the user chooses.
- Keep selection UI fast and readable on small devices.

## Complexity

Medium

