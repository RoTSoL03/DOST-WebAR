# TICKET-017: Deployment Pipeline

## Purpose

Set up prototype and production-ready deployment workflows.

## Dependencies

- TICKET-001
- TICKET-012
- TICKET-016

## Implementation Notes

- Add GitHub Pages prototype deployment if requested.
- Add Azure Static Web Apps deployment configuration.
- Add build-time environment variable documentation.
- Include asset budget validation in CI.
- Preserve immutable build and asset versions.

## Acceptance Criteria

- Prototype deployment can be produced.
- Azure Static Web Apps deployment path is documented/configured.
- Rollback path is documented.
- Production analytics are disabled by default.

## Testing Requirements

- Validate deployed staging URL over HTTPS.
- Validate service worker behavior on staging.

## Risks And Pitfalls

- Base paths differ between GitHub Pages and Azure Static Web Apps.
- Service worker scope can break if hosted under a subpath.

## Complexity

Medium

