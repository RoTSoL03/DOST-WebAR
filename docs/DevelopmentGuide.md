# Development Guide

## Project Intent

This project is a production-quality mobile WebAR experience for DOST events. Implementation agents should optimize for maintainability, privacy, predictable performance, and clear fallback behavior.

## Recommended Stack

- React
- TypeScript
- Vite
- Three.js
- Zustand
- Vitest
- React Testing Library
- Playwright
- Vite PWA / Workbox

## Engineering Principles

- Treat the PRD and stakeholder clarifications as source of truth.
- Use capability detection instead of browser sniffing whenever possible.
- Keep Three.js mutable frame state outside React state.
- Load only the selected mascot during the first interaction.
- Keep photos local to the device.
- Do not add backend services unless a future requirement explicitly needs them.
- Keep iOS MVP fallback inside the web application.
- Do not introduce commercial WebAR SDKs in MVP.

## Initial Implementation Order

1. Scaffold React + TypeScript + Vite.
2. Add linting, formatting, testing, and strict TypeScript settings.
3. Add mobile app shell and unsupported desktop route.
4. Implement capability detection.
5. Implement state store and session state model.
6. Implement Three.js rendering engine with placeholder model support.
7. Implement WebXR runtime adapter.
8. Implement camera-composition fallback adapter.
9. Implement mascot selection and lazy model loading.
10. Implement transform controls.
11. Implement local capture and share/download.
12. Add service worker caching.
13. Add performance instrumentation behind feature flags.
14. Complete real-device testing.

## Runtime Adapter Contract

Runtime adapters should expose a shared interface similar to:

```ts
interface RuntimeAdapter {
  readonly kind: "webxr" | "camera-composition" | "unsupported";
  isSupported(): Promise<boolean>;
  start(options: RuntimeStartOptions): Promise<void>;
  placeMascot?(input: PlacementInput): void;
  updateMascotTransform(transform: MascotTransform): void;
  capture(): Promise<CaptureResult>;
  end(): Promise<void>;
}
```

Exact names may change during implementation, but the boundary should remain.

## State Management

Use Zustand for application and UI state:

- selected mascot
- active runtime kind
- session status
- loading status
- capture status
- user-facing error
- cache status

Do not store Three.js objects, video tracks, WebXR sessions, or animation mixers in Zustand. Those belong in runtime services.

## Performance Guardrails

- Initial page load must stay under 5 seconds on Wi-Fi.
- First selected mascot load must stay under 3 seconds.
- AR ready must stay under 10 seconds.
- Minimum target frame rate is 30 FPS.
- Do not load all four mascots at startup.
- Do not use heavy post-processing.
- Cap device pixel ratio on mobile.
- Dispose model resources when they are no longer active.

## Privacy Guardrails

Implementation agents must not:

- Upload photos.
- Upload camera frames.
- Collect faces, names, emails, GPS, or device identifiers.
- Add authentication.
- Enable production analytics without explicit approval.

## Local Development

Camera and WebXR features require secure contexts. Local development should use HTTPS or device-specific secure debugging workflows.

Recommended workflows:

- Local HTTPS dev server for iOS Safari camera testing.
- Chrome remote debugging for Android.
- Android device with ARCore support for WebXR validation.
- Desktop browser only for UI and non-AR debugging.

## Definition Of Done

A feature is done only when:

- It works on at least one target Android device and one target iOS device where applicable.
- It handles unsupported capability paths.
- It has automated tests where feasible.
- It has no privacy regression.
- It does not violate performance budgets.
- It is documented if it changes architecture or runtime behavior.

