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

- Android Chrome WebXR markerless floor scanning for the prototype.
- iOS Safari MindAR image tracking for the prototype.
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

Testers should open the Vercel HTTPS URL on a mobile device:

- Android: use Chrome on an ARCore-capable phone for WebXR floor scanning.
- iOS: use Safari and scan the target image at `public/targets/mindar-card.png` for image-tracked mascot placement.

Desktop browsers show the mobile-device fallback screen.

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
