# Prompt For Next Agent: Build WebAR Foundations

You are an experienced frontend/WebXR implementation agent working on the DOST WebAR Mascot Experience.

Your task is to create the technical foundations of the WebAR application. Do not attempt to complete the full product in one pass. Focus on a clean, maintainable project scaffold and the core architecture needed by later agents.

## Required Reading

Before making changes, read these files in order:

1. `docs/PRD.md`
2. `docs/RequirementsClarifications.md`
3. `docs/Architecture.md`
4. `docs/DevelopmentGuide.md`
5. `docs/ADR/ADR-001-framework-react-typescript.md`
6. `docs/ADR/ADR-002-rendering-threejs.md`
7. `docs/ADR/ADR-003-ar-runtime-strategy.md`
8. `tickets/README.md`
9. `tickets/TICKET-001-project-scaffold.md`
10. `tickets/TICKET-002-app-shell-mobile-gates.md`
11. `tickets/TICKET-003-capability-service.md`
12. `tickets/TICKET-004-state-management.md`

## Objective

Implement the first foundation phase of the WebAR application:

- React + TypeScript + Vite project scaffold.
- Strict TypeScript setup.
- Basic app shell.
- Mobile-first layout foundation.
- Unsupported desktop state.
- Capability detection service.
- Zustand session/app state foundation.
- Initial test setup.

Do not implement full WebXR placement, iOS camera fallback, model loading, capture, PWA caching, or deployment yet. Create the boundaries those later tickets will use.

## Technical Requirements

Use:

- React
- TypeScript
- Vite
- Zustand
- Vitest
- React Testing Library

Prepare for later use of:

- Three.js
- WebXR
- GLB assets
- Draco compression
- KTX2/BasisU textures
- PWA caching

## Implementation Scope

Complete these tickets:

- `tickets/TICKET-001-project-scaffold.md`
- `tickets/TICKET-002-app-shell-mobile-gates.md`
- `tickets/TICKET-003-capability-service.md`
- `tickets/TICKET-004-state-management.md`

If time permits, create lightweight placeholder files/interfaces for later tickets, but do not implement their behavior.

## Expected Folder Structure

Create or prepare this structure:

```text
src/
  app/
  ar/
  rendering/
  features/
  services/
  state/
  ui/
  config/
  errors/
  tests/
public/
  icons/
  models/
```

## Foundation Behavior

The initial app should:

1. Load in a browser.
2. Show a mobile-first app shell.
3. Show unsupported messaging on desktop production views.
4. Allow a development/debug override for desktop if useful.
5. Run capability detection without requesting camera permission.
6. Decide between these runtime recommendations:
   - `webxr`
   - `camera-composition`
   - `unsupported`
7. Store selected mascot, runtime kind, session status, loading state, and error state in Zustand.

## Session States

Use explicit session states based on the architecture:

```text
idle
checkingCapabilities
selectingMascot
loadingMascot
readyToStart
requestingPermission
startingRuntime
detectingSurface
placingMascot
mascotPlaced
capturing
captureReady
ending
error
unsupported
```

## Privacy And Security Constraints

Do not:

- Request camera permission on page load.
- Upload photos.
- Upload camera frames.
- Add analytics network calls.
- Add user authentication.
- Add commercial WebAR SDKs.
- Add Apple Quick Look as MVP behavior.

## Acceptance Criteria

The foundation phase is complete when:

- The app installs dependencies successfully.
- The app starts locally.
- The production build succeeds.
- Typecheck succeeds.
- Unit tests pass.
- Basic app shell renders.
- Desktop unsupported state works.
- Capability service is typed and tested.
- Zustand store is typed and tested.
- No camera permission is requested during initial load.
- The code structure matches the architecture docs.

## Verification Commands

Run the equivalent project commands after implementation:

```bash
npm install
npm run typecheck
npm run test
npm run build
```

If command names differ, document the actual commands in your final response.

## Final Response Requirements

When finished, report:

- Files created or changed.
- Tickets completed.
- Commands run and results.
- Any known limitations.
- Recommended next ticket for the following agent.

Keep the implementation focused. This phase should make later WebXR, rendering, asset loading, and capture work easier without prematurely building those features.

