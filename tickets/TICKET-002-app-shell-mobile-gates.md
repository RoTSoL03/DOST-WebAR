# TICKET-002: App Shell And Mobile Gates

## Purpose

Implement the mobile-first app shell, basic routes or screens, and unsupported desktop messaging.

## Dependencies

- TICKET-001

## Implementation Notes

- Add screens for loading, mascot selection placeholder, permission start placeholder, AR session placeholder, capture placeholder, and unsupported device.
- Add safe-area CSS support.
- Add high-contrast mobile-friendly layout.
- Desktop production users should see unsupported messaging.
- Desktop development mode may expose debug controls if needed.

## Acceptance Criteria

- Mobile viewport shows app shell.
- Desktop viewport shows unsupported state unless development override is enabled.
- UI uses large touch targets.
- No camera permission is requested on load.

## Testing Requirements

- Component tests for shell states.
- Playwright smoke test for desktop unsupported state.

## Risks And Pitfalls

- Do not block downstream testing by making desktop development impossible.
- Do not include instructional walls of text in the main user flow.

## Complexity

Low

