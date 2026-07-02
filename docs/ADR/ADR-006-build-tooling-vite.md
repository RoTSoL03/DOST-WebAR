# ADR-006: Use Vite For Build Tooling

## Status

Accepted

## Context

The project is a frontend-only static application with no backend requirements. It needs fast iteration, TypeScript support, code splitting, and simple deployment.

## Decision

Use Vite.

## Consequences

- Fast development server and build times.
- Simple static output for GitHub Pages and Azure Static Web Apps.
- Good TypeScript and React support.
- Server-side rendering is not included, which is acceptable for this product.

## Alternatives

- Next.js: powerful but adds unnecessary server/application complexity.
- Parcel: simple but less aligned with current React/Vite ecosystem momentum.
- Webpack: flexible but more configuration-heavy.

