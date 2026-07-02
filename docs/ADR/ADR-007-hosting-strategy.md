# ADR-007: Use GitHub Pages For Prototype And Azure Static Web Apps For Production

## Status

Accepted

## Context

The app requires HTTPS, CDN distribution, simple rollback, and a government-friendly production path. The prototype needs quick public hosting.

## Decision

Use GitHub Pages for prototype deployments. Use Azure Static Web Apps, or a DOST-approved equivalent government hosting environment, for production.

## Consequences

- Prototype can be shared quickly.
- Production has a stronger enterprise/government alignment.
- Azure provides managed HTTPS, CI/CD integration, and integration paths for monitoring.
- Final deployment still depends on DOST security review and procurement.

## Alternatives

- Firebase Hosting: technically strong but may be less aligned with government procurement.
- Vercel/Cloudflare Pages: excellent developer experience, but production choice should prioritize DOST approval.
- Self-hosted static server: more operational burden.

