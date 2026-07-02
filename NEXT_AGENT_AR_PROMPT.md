# Prompt For Next Agent: Implement Real WebXR AR Functionality

You are an experienced WebXR, Three.js, React, and TypeScript implementation agent.

Your task is to validate and harden the DOST WebAR Mascot Experience's real markerless AR path on supported Android devices. Focus specifically on WebXR floor scanning, hit testing, reticle placement, and anchored mascot placement. Preserve the existing camera-composition fallback for iOS and unsupported browsers.

## Current Status

The project now has:

- React + TypeScript + Vite scaffold.
- Zustand session state.
- Capability detection.
- One tested GLB mascot: `public/models/mascot_solido.glb`.
- Current mascot manifest in `src/config/mascots.ts`.
- Current camera overlay fallback session in `src/ar/CameraARSession.tsx`.
- Initial WebXR session implementation in `src/ar/WebXRSession.tsx`.
- Runtime adapter contract in `src/ar/runtimeAdapter.ts`.
- Placeholder shared rendering engine in `src/rendering/renderingEngine.ts`.

Previous user testing confirmed:

- Camera permission and camera feed work.
- Mascot overlay renders over the camera.
- The camera fallback is not true AR.
- The model can look stuck near the screen when the fallback path is used.
- The desired behavior is floor scanning, reticle detection, tap-to-place, and world-anchored placement.

Recent implementation status:

- `src/ar/WebXRSession.tsx` starts an `immersive-ar` WebXR session.
- The WebXR session requests `hit-test`.
- The session prefers `local-floor` reference space and falls back to `local`.
- A reticle is updated from WebXR hit-test results.
- The selected mascot is hidden until placement.
- Tapping the screen or pressing Place copies the reticle position into the mascot root.
- The mascot bottom is aligned to the placement surface rather than centered on the surface.
- iOS/non-WebXR browsers still use the camera-composition fallback.

Recent verification:

- `npm run typecheck` passes.
- `npm run test` passes: 3 test files, 12 tests.
- `npm run build` passes.
- Build warning: `GLTFLoader` chunk is larger than 500 kB. Do not solve this unless it blocks the AR work.

## Required Reading

Read these files before making changes:

1. `docs/PRD.md`
2. `docs/RequirementsClarifications.md`
3. `docs/Architecture.md`
4. `docs/DevelopmentGuide.md`
5. `docs/ADR/ADR-003-ar-runtime-strategy.md`
6. `tickets/TICKET-007-webxr-runtime-adapter.md`
7. `tickets/TICKET-010-placement-transform-controls.md`
8. `src/app/App.tsx`
9. `src/ar/CameraARSession.tsx`
10. `src/ar/runtimeAdapter.ts`
11. `src/services/capabilities.ts`
12. `src/state/sessionStore.ts`
13. `src/config/mascots.ts`

## Objective

Validate and harden the Android WebXR path:

- Confirm a real WebXR `immersive-ar` session starts when the capability service recommends `webxr`.
- Confirm hit-test scanning works on a real ARCore-capable Android device.
- Confirm the reticle appears only on detected surfaces.
- Confirm tapping places the selected mascot at the hit-test pose.
- Confirm the mascot remains anchored to the floor/world as the user walks around.
- Keep the existing iOS/browser camera-composition fallback working.
- Maintain the no-upload privacy model.

This task should make the app behave like actual AR on supported Android Chrome devices instead of only rendering a model over the camera feed.

## In Scope

Implement, fix, or refine:

- WebXR session start/end lifecycle.
- Three.js `WebGLRenderer` configured for XR.
- `renderer.xr.enabled = true`.
- `navigator.xr.requestSession("immersive-ar", ...)`.
- WebXR hit-test source.
- Reticle mesh that follows detected surfaces.
- Tap-to-place behavior.
- Selected mascot GLB loading in WebXR mode.
- Basic mascot placement at reticle transform.
- Clean session teardown and resource disposal.
- Integration with existing Zustand session state.
- App routing/branching so:
  - `runtimeKind === "webxr"` starts WebXR.
  - `runtimeKind === "camera-composition"` starts existing camera fallback.

Do not consider the task complete if the mascot only follows the screen/camera overlay. Success requires world-anchored WebXR placement on an Android ARCore device.

## Out Of Scope

Do not implement these yet unless absolutely necessary:

- Full photo capture for WebXR.
- Native share/download polish.
- PWA offline caching.
- Four production mascots.
- Draco/KTX2 production pipeline.
- Commercial WebAR SDKs.
- Apple Quick Look.
- Backend services.
- Analytics.
- Authentication.

## Technical Guidance

The WebXR runtime should follow this shape:

1. Confirm `navigator.xr` exists.
2. Start session only from a user gesture.
3. Request an `immersive-ar` session with:
   - required `hit-test`
   - optional `dom-overlay`
4. Create a Three.js scene, camera, lights, renderer, mascot root, and reticle.
5. Create local reference space.
6. Create viewer reference space.
7. Request hit-test source from viewer space.
8. In the XR animation loop:
   - get hit-test results
   - update reticle visibility and matrix
   - render scene
9. On user tap:
   - if reticle is visible, copy reticle transform to mascot root
   - mark mascot as placed
10. On session end:
   - cancel hit-test source
   - dispose model resources
   - dispose renderer
   - update session state

## Suggested WebXR Session Options

Use equivalent options to:

```ts
{
  requiredFeatures: ["hit-test"],
  optionalFeatures: ["dom-overlay"],
  domOverlay: overlayRoot ? { root: overlayRoot } : undefined
}
```

Adjust only as needed for browser compatibility. Do not require optional features that would prevent session startup.

## TypeScript Notes

If TypeScript does not expose all WebXR types, add a small local type declaration file such as:

```text
src/types/webxr.d.ts
```

Keep type declarations minimal and specific to the APIs used.

## UX Requirements

During WebXR:

- Show concise scanning guidance.
- Show reticle only when a surface is detected.
- Disable placement button or tap placement until reticle is available.
- After placement, show simple controls or at least an "End" button.
- Do not imply iOS fallback has true floor anchoring.

## Privacy And Security Constraints

Do not:

- Upload photos.
- Upload camera frames.
- Add analytics network calls.
- Request camera before the user presses Start AR.
- Add native app install prompts.
- Add Quick Look as MVP behavior.
- Add commercial WebAR SDKs.

## Acceptance Criteria

The task is complete when:

- On a supported Android Chrome / ARCore device, `runtimeKind === "webxr"` launches a real WebXR `immersive-ar` session.
- The app shows a scanning state while looking for a surface.
- A reticle appears when hit testing finds a placement surface.
- Tapping places the Solido mascot at the reticle pose.
- The mascot remains in world space as the user moves the phone.
- Ending the session exits WebXR and releases resources.
- iPhone Safari or non-WebXR browsers still use the existing camera-composition fallback.
- Typecheck, tests, and build pass.
- Any unsupported WebXR path falls back cleanly or shows an actionable error.

## Testing Requirements

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Also perform manual testing:

- Android Chrome on an ARCore-capable phone over HTTPS.
- iPhone Safari to confirm the fallback still works.
- Desktop browser to confirm unsupported/development behavior is not broken.

If you cannot test on physical Android hardware, implement the WebXR path behind capability checks, add mock-based tests where possible, and clearly state that physical WebXR validation remains required.

## Important Files To Preserve

Do not remove or break:

- `src/ar/CameraARSession.tsx`
- `src/services/capabilities.ts`
- `src/state/sessionStore.ts`
- `src/config/mascots.ts`
- `docs/ADR/ADR-003-ar-runtime-strategy.md`

Refactor them only if it makes the WebXR boundary cleaner and tests remain passing.

## Final Response Requirements

When finished, report:

- Files changed.
- Whether WebXR floor scanning was implemented.
- Whether reticle placement was implemented.
- Whether mascot anchoring was implemented.
- Whether iOS camera fallback still works.
- Commands run and results.
- Real devices tested.
- Any known limitations or browser-specific issues.
- Recommended next ticket.
