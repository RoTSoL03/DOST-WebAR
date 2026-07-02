# DOST WebAR Mascot Experience

This repository contains the implementation-ready architecture package and downstream development backlog for the DOST WebAR Mascot Experience.

## Source Of Truth

The product requirements document at `docs/PRD.md` and stakeholder clarifications at `docs/RequirementsClarifications.md` define the business requirements. The architecture documents in this repository translate those requirements into implementation guidance.

## Start Here

1. Read `docs/Architecture.md`.
2. Review the ADRs in `docs/ADR/`.
3. Read `docs/DevelopmentGuide.md`.
4. Follow the ticket order in `tickets/README.md`.

## Key MVP Decisions

- Android Chrome WebXR markerless AR for the prototype.
- iOS is intentionally unsupported for this prototype.
- No Quick Look in MVP.
- No native app download.
- No commercial WebAR SDK in MVP.
- No photo upload or server-side image processing.
- Production analytics disabled unless DOST approves.
- Vercel for prototype hosting.
- Azure Static Web Apps, or DOST-approved equivalent, for production hosting.

## Prototype Deployment On Vercel

This prototype is configured as a Vite static site for Vercel. The production build output is `dist`.

Recommended local checks before deploying:

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

Deploy a preview:

```bash
npm install -g vercel
vercel login
vercel
```

Deploy production after the preview is validated:

```bash
vercel --prod
```

Testers should open the Vercel HTTPS URL on an ARCore-capable Android phone using Chrome. The WebXR scanner will not run on desktop or iOS for this prototype.

## Documentation Index

- `docs/Architecture.md`
- `docs/PRD.md`
- `docs/RequirementsClarifications.md`
- `docs/DevelopmentGuide.md`
- `docs/DeviceSupportMatrix.md`
- `docs/PerformanceBudget.md`
- `docs/Testing.md`
- `docs/FieldTestingRunbook.md`
- `docs/Deployment.md`
- `docs/Rollback.md`
- `docs/PrivacyAndSecurity.md`
- `docs/Accessibility.md`
- `docs/AnalyticsPlan.md`
- `docs/CodingStandards.md`
- `docs/ADR/`
- `tickets/`
