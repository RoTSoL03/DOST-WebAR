# TICKET-014: Performance Instrumentation

## Purpose

Add development-safe instrumentation for performance validation and optional approved analytics.

## Dependencies

- TICKET-004
- TICKET-005
- TICKET-006

## Implementation Notes

Track locally:

- app load time
- mascot load time
- AR ready time
- average FPS
- lowest recent FPS
- capture duration
- error codes

Production analytics must be disabled by default.

## Acceptance Criteria

- Development builds expose performance diagnostics.
- Production build does not transmit analytics unless enabled by config.
- Metrics contain no photos, camera frames, GPS, or PII.

## Testing Requirements

- Unit tests for analytics gating.
- Unit tests for sanitized event payloads.

## Risks And Pitfalls

- Do not add third-party analytics scripts directly to UI components.
- Do not log raw exception payloads in production analytics.

## Complexity

Medium

