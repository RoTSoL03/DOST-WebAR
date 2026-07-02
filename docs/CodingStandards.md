# Coding Standards

## TypeScript

- Use strict TypeScript settings.
- Prefer explicit domain types for session states, runtime kinds, and asset metadata.
- Avoid `any` unless a browser API type gap requires it and the usage is documented.

## React

- Keep components focused and small.
- Keep Three.js objects out of React state.
- Use React for UI, not per-frame rendering state.
- Prefer hooks for UI-to-service integration.

## Three.js

- Centralize renderer and scene lifecycle.
- Dispose geometries, textures, and materials.
- Avoid creating objects inside the frame loop unless necessary.
- Keep model normalization and animation setup deterministic.

## Error Handling

- Use typed application errors.
- Map technical errors to user-facing messages.
- Do not expose stack traces in production UI.

## Privacy

- Do not add network calls from capture code.
- Do not add analytics without using the analytics service gate.
- Do not store photos in persistent browser storage.

## Testing

- Add tests for logic-heavy services.
- Mock browser APIs in unit tests.
- Use real devices for camera and WebXR behavior.

