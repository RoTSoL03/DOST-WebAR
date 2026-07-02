# TICKET-001: Project Scaffold

## Purpose

Create the initial React, TypeScript, and Vite project structure with quality gates.

## Dependencies

None.

## Implementation Notes

- Scaffold React + TypeScript + Vite.
- Enable strict TypeScript.
- Add linting and formatting.
- Add Vitest and React Testing Library.
- Add basic CI-ready scripts.
- Keep the app static-hosting friendly.

## Acceptance Criteria

- `npm install` succeeds.
- `npm run dev` starts the app.
- `npm run build` succeeds.
- `npm run test` succeeds.
- `npm run typecheck` succeeds.
- Initial app renders a placeholder mobile shell.

## Testing Requirements

- Add one smoke test for app render.
- Verify production build output.

## Risks And Pitfalls

- Avoid adding Next.js or server-side dependencies.
- Avoid premature AR implementation in this ticket.

## Complexity

Low

