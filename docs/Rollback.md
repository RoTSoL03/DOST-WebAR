# Rollback Plan

## Rollback Goals

Rollback must restore a known-good user experience quickly during live events.

## Rollback Requirements

- Keep previous production deployment available.
- Keep previous asset manifest available.
- Keep previous mascot asset files available.
- Avoid deleting old asset versions immediately after release.
- Confirm service worker cache version behavior before launch.

## Rollback Procedure

1. Identify the failing release version.
2. Confirm whether the issue is app code, asset manifest, or model assets.
3. Repoint production to the previous stable deployment.
4. Restore previous asset manifest if needed.
5. Confirm QR URL opens the restored version.
6. Test one Android and one iOS device.
7. Communicate status to event staff.

## Common Rollback Scenarios

### Broken App Shell

Rollback the static deployment.

### Broken Mascot Asset

Rollback the asset manifest to a previous mascot version.

### Service Worker Cache Issue

Deploy a cache-busting service worker update or restore the previous service worker depending on severity.

### Hosting Outage

Use a pre-approved alternate static hosting URL if available and update QR routing where possible.

