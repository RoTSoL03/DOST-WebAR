# Field Testing Runbook

## Purpose

Field testing verifies the experience under real event conditions that automated tests cannot reproduce.

## Required Materials

- Production-like QR code.
- Staging deployment URL.
- Representative Android devices.
- Representative iPhones.
- Portable charger.
- Network fallback plan.
- Test mascot assets.
- Issue tracking sheet.

## Pre-Test Checklist

- Staging build deployed.
- Asset manifest version confirmed.
- Service worker cache version confirmed.
- Analytics disabled unless explicitly approved.
- QR code points to the correct staging URL.
- Rollback deployment is available.

## Test Scenarios

### First-Time User

1. Scan QR code.
2. Open app.
3. Select mascot.
4. Start AR.
5. Grant permission.
6. Place mascot.
7. Rotate and scale.
8. Capture photo.
9. Download or share.

### Repeat User With Cache

1. Load app once online.
2. Close browser tab.
3. Reduce or disable connectivity.
4. Reopen QR URL.
5. Confirm cached assets and clear offline behavior.

### Poor Conditions

Test:

- Low light.
- Bright backlight.
- Reflective floor.
- Carpeted floor.
- Crowded background.
- Slow Wi-Fi.
- Cellular data.

## Pass Criteria

- App opens from QR reliably.
- Primary Android WebXR path works on supported Android devices.
- iOS fallback remains fully in-browser.
- Users can capture a photo without help.
- Frame rate remains acceptable.
- Error messages are understandable.
- No images are uploaded.

## Issue Severity

- P0: Blocks QR launch, camera access, placement, or capture on primary devices.
- P1: Major performance or UX issue that affects many users.
- P2: Minor visual, copy, or edge-case issue.
- P3: Nice-to-have improvement.

