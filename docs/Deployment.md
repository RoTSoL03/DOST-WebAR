# Deployment Strategy

## Environments

### Development

- Local Vite dev server.
- HTTPS required for camera and WebXR workflows.
- Device debugging through Android Chrome DevTools and iOS Safari Web Inspector.

### Prototype

- GitHub Pages.
- Used for early stakeholder demos and prototype validation.
- Not the final production environment unless DOST approves it.

### Staging

- Azure Static Web Apps staging environment.
- Uses production-like HTTPS, CDN behavior, and QR test URL.
- Used for device testing and field rehearsals.

### Production

- Azure Static Web Apps or another DOST-approved government hosting environment.
- Must pass security and procurement review.

## CI/CD Pipeline

Required checks:

- Install dependencies.
- Lint.
- Typecheck.
- Unit tests.
- Build.
- Asset manifest validation.
- Asset budget validation.
- Generate deployment artifact.

Optional checks:

- Playwright smoke tests.
- Lighthouse performance checks.

## Environment Variables

Expected variables:

- `VITE_APP_VERSION`
- `VITE_ASSET_BASE_URL`
- `VITE_ENABLE_ANALYTICS`
- `VITE_DEPLOYMENT_ENV`
- `VITE_FEATURE_WEBXR`
- `VITE_FEATURE_CAMERA_FALLBACK`

Production analytics flag must remain disabled unless approved.

## Versioning

- Application builds should have immutable version identifiers.
- Mascot assets should be versioned through the asset manifest.
- Service worker cache names should include app or manifest versions.

## Monitoring

Monitor privacy-safe events only:

- App load failures.
- Asset load failures.
- AR start failures.
- Capture failures.
- Browser/runtime kind.

Do not monitor or transmit:

- Photos.
- Camera frames.
- Faces.
- GPS.
- Names.
- Emails.

## Release Checklist

- Device matrix test completed.
- Field rehearsal completed.
- Asset budget check passed.
- Service worker update behavior verified.
- Rollback deployment available.
- Production analytics approval status confirmed.
- QR code target verified.

