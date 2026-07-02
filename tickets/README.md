# Implementation Ticket Backlog

This backlog converts the approved architecture into implementation-ready work for downstream development agents.

## Ticket Format

Each ticket includes:

- Purpose
- Dependencies
- Implementation notes
- Acceptance criteria
- Testing requirements
- Risks and pitfalls
- Complexity

## Suggested Execution Order

1. `TICKET-001-project-scaffold.md`
2. `TICKET-002-app-shell-mobile-gates.md`
3. `TICKET-003-capability-service.md`
4. `TICKET-004-state-management.md`
5. `TICKET-005-threejs-rendering-engine.md`
6. `TICKET-006-asset-manifest-loader.md`
7. `TICKET-007-webxr-runtime-adapter.md`
8. `TICKET-008-ios-camera-composition-adapter.md`
9. `TICKET-009-mascot-selection-flow.md`
10. `TICKET-010-placement-transform-controls.md`
11. `TICKET-011-local-capture-share.md`
12. `TICKET-012-pwa-offline-cache.md`
13. `TICKET-013-error-handling-unsupported-states.md`
14. `TICKET-014-performance-instrumentation.md`
15. `TICKET-015-asset-optimization-pipeline.md`
16. `TICKET-016-testing-automation.md`
17. `TICKET-017-deployment-pipeline.md`
18. `TICKET-018-field-testing-launch-readiness.md`

## Non-Negotiable Constraints

- No native app download.
- No Quick Look in MVP.
- No commercial WebAR SDK in MVP.
- No photo upload.
- No camera frame upload.
- Production analytics disabled unless DOST approves.
- Camera permission requested only after explicit user action.

