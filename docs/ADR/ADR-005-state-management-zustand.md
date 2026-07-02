# ADR-005: Use Zustand For App State

## Status

Accepted

## Context

The application needs lightweight state for selected mascot, session status, loading status, runtime kind, errors, and capture state. Three.js objects and browser sessions should not live in React state.

## Decision

Use Zustand for app and UI state, with explicit session state names.

## Consequences

- Low ceremony and easy integration with React.
- Suitable for a small frontend-only app.
- Runtime services remain independent from UI state.
- Less formal transition enforcement than a full state machine library.

## Alternatives

- Redux Toolkit: robust but heavier than needed.
- XState: excellent for complex state machines, but likely too much ceremony for MVP.
- Jotai: good atomic model, but less direct for central session orchestration.

