# ADR-001: Use React And TypeScript

## Status

Accepted

## Context

The application needs a maintainable mobile UI for mascot selection, permission prompts, AR controls, capture preview, error states, and offline messaging. The AR rendering loop must remain separate from UI rendering.

## Decision

Use React with TypeScript for the application UI and domain modeling.

## Consequences

- Strong component ecosystem and hiring familiarity.
- Type-safe modeling for runtime adapters, asset manifests, and session states.
- React must not own per-frame Three.js state.
- Engineering discipline is required to avoid unnecessary re-renders during AR sessions.

## Alternatives

- Vanilla TypeScript: smaller runtime but more custom UI structure.
- Svelte: strong performance and simpler reactivity, but less common in many enterprise teams.
- Next.js: useful for server-rendered apps, but unnecessary for this frontend-only static application.

