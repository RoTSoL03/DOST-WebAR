# Prompt For Next Agent: Real WebXR Floor Placement

You are an experienced WebXR, Three.js, React, and TypeScript implementation agent.

Your task is to implement or fix the real floor-placement AR path for the DOST WebAR Mascot Experience.

The current problem is that the mascot can appear as a camera overlay stuck near the screen. That is not sufficient. The desired Android experience is actual WebXR markerless AR: the user opens the camera, scans the floor, sees a reticle on a detected surface, taps to place the mascot, and the mascot remains anchored in the real world as the user moves around.

## Important Platform Constraint

A real floor-placement experience requires the WebXR path on an ARCore-capable Android browser.

iPhone Safari will still use the in-browser camera overlay fallback because the MVP avoids:

- Native app downloads.
- Apple Quick Look as the MVP flow.
- Commercial WebAR SDKs.

Do not try to force true WebXR floor anchoring on iPhone Safari for MVP. Keep the iOS fallback intact.

## Required Outcome

Implement the system so that on supported Android Chrome / ARCore devices it:

1. Starts an actual `immersive-ar` WebXR session.
2. Requests `hit-test`.
3. Prefers `local-floor` reference space, with `local` fallback.
4. Shows a reticle from hit-test results while scanning the floor.
5. Lets the user tap the screen or press `Place`.
6. Places the mascot at the reticle's detected surface position.
7. Aligns the mascot's bottom to the floor instead of centering it on the placement point.
8. Keeps the iOS camera overlay fallback intact.

## Dependency Policy

You may install dependencies if needed to implement or test this correctly.

Acceptable dependency additions include:

- WebXR/Three.js helpers that are lightweight and well-maintained.
- Type definitions required for WebXR APIs.
- Testing utilities that help mock or validate WebXR behavior.

Do not add:

- Commercial WebAR SDKs.
- Native app wrappers.
- Backend services.
- Analytics libraries.
- Apple Quick Look as the MVP flow.

If you add a dependency, explain why it is necessary and why the built-in Three.js/WebXR APIs were not enough.

## Required Reading

Before changing code, read:

1. `docs/PRD.md`
2. `docs/RequirementsClarifications.md`
3. `docs/Architecture.md`
4. `docs/ADR/ADR-003-ar-runtime-strategy.md`
5. `tickets/TICKET-007-webxr-runtime-adapter.md`
6. `tickets/TICKET-010-placement-transform-controls.md`
7. `src/app/App.tsx`
8. `src/ar/WebXRSession.tsx`
9. `src/ar/CameraARSession.tsx`
10. `src/services/capabilities.ts`
11. `src/state/sessionStore.ts`
12. `src/config/mascots.ts`

## Implementation Requirements

### WebXR Startup

The Android WebXR path must:

- Start only after the user presses `Start AR`.
- Use `navigator.xr.requestSession("immersive-ar", ...)`.
- Request `hit-test` as a required feature.
- Prefer `local-floor` where available.
- Fall back to `local` if `local-floor` fails.
- Avoid requiring optional features that can prevent session startup.

### Hit Testing And Reticle

The WebXR session must:

- Request a viewer reference space.
- Create an `XRHitTestSource`.
- In the XR animation loop, call `frame.getHitTestResults(hitTestSource)`.
- Convert the first hit result into a pose using the placement reference space.
- Update a visible reticle from `pose.transform.matrix`.
- Hide the reticle when no surface is detected.
- Show scanning guidance while no surface is detected.

### Placement

The placement behavior must:

- Ignore placement if no reticle is visible.
- Allow placement by tapping the screen.
- Allow placement by pressing a visible `Place` button.
- Copy the reticle position into the mascot root.
- Keep the mascot visible only after placement.
- Keep the mascot anchored in world space after placement.
- Rotate the mascot to face the camera on initial placement if practical.
- Avoid updating the mascot position every frame after placement unless the user intentionally moves it.

### Model Floor Alignment

The mascot should stand on the detected floor/surface.

When normalizing the model:

- Compute its bounding box.
- Center it on X/Z.
- Set its Y offset so `bounds.min.y` sits at the placement origin.
- Apply `defaultVerticalOffset` after bottom alignment.
- Do not center the model vertically on the hit-test point.

### iOS Fallback

Do not remove or break `CameraARSession`.

For iPhone Safari and non-WebXR browsers:

- Keep the existing in-browser camera overlay fallback.
- Do not promise true floor scanning.
- Do not open Apple Quick Look.
- Do not require app installation.

## Suggested Session Options

Use this shape or an equivalent:

```ts
{
  requiredFeatures: ["hit-test"],
  optionalFeatures: ["local-floor", "dom-overlay"],
  domOverlay: document.body ? { root: document.body } : undefined
}
```

If the session fails with DOM overlay, retry without DOM overlay:

```ts
{
  requiredFeatures: ["hit-test"],
  optionalFeatures: ["local-floor"]
}
```

## Suggested Reference Space Flow

Use this pattern or equivalent:

```ts
async function requestPlacementReferenceSpace(session: XRSession) {
  try {
    return await session.requestReferenceSpace("local-floor");
  } catch {
    return session.requestReferenceSpace("local");
  }
}
```

Then use the placement reference space for hit-test poses:

```ts
const pose = hit.getPose(placementReferenceSpace);
```

## Acceptance Criteria

The work is complete only when:

- Android Chrome on an ARCore-capable device starts a real `immersive-ar` WebXR session.
- The user sees scan-floor guidance.
- A reticle appears only when hit testing finds a floor/surface.
- Tapping the screen places the mascot.
- Pressing `Place` also places the mascot.
- The mascot is positioned at the reticle's real-world surface pose.
- The mascot stands on the floor instead of being centered through it.
- The mascot remains anchored while the user walks around.
- iOS Safari still uses the in-browser camera overlay fallback.
- Unsupported browsers show clear fallback or unsupported messaging.

## Verification Commands

Run:

```bash
npm run typecheck
npm run test
npm run lint
npm run build
```

If dependencies are installed, also ensure:

```bash
npm install
```

or the appropriate package-manager install command has updated the lockfile cleanly.

## Physical Device Testing

Real WebXR floor placement cannot be fully validated in desktop tests.

You must test, or explicitly report that testing remains required, on:

- Android Chrome.
- ARCore-capable Android phone.
- HTTPS URL.
- Well-lit floor or table surface.

Also smoke test:

- iPhone Safari fallback.
- Desktop unsupported/development behavior.

## Final Response Requirements

When finished, report:

- Files changed.
- Dependencies installed, if any, and why.
- Whether `immersive-ar` starts.
- Whether `hit-test` is requested.
- Whether `local-floor` fallback logic exists.
- Whether reticle scanning works.
- Whether tap and `Place` placement work.
- Whether the mascot bottom aligns to the floor.
- Whether iOS fallback still works.
- Commands run and results.
- Physical devices tested.
- Any remaining limitations.

