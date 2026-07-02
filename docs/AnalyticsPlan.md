# Analytics Plan

## Default Position

Production analytics are disabled by default. Analytics may be enabled only after explicit DOST approval and privacy review.

## Development Analytics

Development builds may log local diagnostic events to help validate implementation. These logs must not contain photos, camera frames, GPS, or PII.

## Potential Production Metrics

If approved, collect only anonymous metrics:

- App loaded.
- AR session started.
- Runtime selected: WebXR, camera fallback, unsupported.
- Mascot selected.
- Capture completed.
- Session duration bucket.
- Error code.
- Browser family.
- OS family.

## Prohibited Metrics

Do not collect:

- Photos.
- Camera frames.
- Faces.
- Names.
- Emails.
- GPS.
- Precise device identifiers.
- Free-form user input.

## Implementation Requirements

- Analytics provider must be isolated behind an internal analytics service.
- Analytics service must be disabled by default.
- Events must use an allowlist.
- Error events must use sanitized error codes, not raw exception payloads.
- Production enablement must be controlled by configuration.

