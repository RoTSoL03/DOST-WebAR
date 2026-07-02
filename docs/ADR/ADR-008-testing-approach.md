# ADR-008: Use Layered Automated Tests Plus Real-Device Field Testing

## Status

Accepted

## Context

AR behavior depends on browser capabilities, physical devices, sensors, camera permissions, lighting, surfaces, and event network conditions. Automated tests alone cannot validate the full user experience.

## Decision

Use layered automated testing for deterministic logic and UI flows, plus mandatory real-device and field testing for AR behavior.

## Consequences

- Unit and integration tests catch logic regressions.
- Playwright can validate non-AR flows and mocked paths.
- Real-device testing validates WebXR, camera fallback, capture, and performance.
- Field testing reduces launch risk under event conditions.

## Alternatives

- Automated-only testing: insufficient for AR.
- Manual-only testing: too regression-prone.
- Cloud device farms: useful future enhancement, but not a replacement for venue rehearsal.

