# Requirements Clarifications

These clarifications extend the PRD and should be treated as approved project requirements unless superseded by DOST stakeholders.

## iPhone Safari Parity

The application should provide the best available experience on both Android and iOS.

Priority:

1. Markerless floor AR.
2. Alternative WebAR implementation.
3. Informative fallback as last resort.

If browser limitations prevent equivalent markerless AR on iOS, the app must gracefully degrade to the closest possible browser-based experience. A native app download must never be required.

## Commercial WebAR SDKs

The MVP should prioritize open web standards and open-source technologies.

Commercial SDKs such as 8th Wall may be evaluated in future phases if they significantly improve compatibility, tracking quality, or user experience. The MVP must avoid vendor lock-in and recurring licensing costs.

## Photo Storage

Photos shall remain entirely on the user's device.

The application shall not upload, store, or process user images on any server. Sharing can use the device's native share sheet.

## Mascot Model Specifications

The application will support four independent mascot models provided by DOST. Placeholder models may be used during development.

Target technical budget:

- Format: GLB.
- Compression: Draco.
- Texture format: KTX2/BasisU.
- Triangles: 20,000-50,000 per mascot.
- Texture resolution: 2048x2048 maximum, 1024x1024 preferred where quality allows.
- Required animation: idle.
- Recommended animation: wave.
- Optional animation: pose.

## Offline Behavior

The application shall require an internet connection on first launch.

After the initial visit, essential assets should be cached using a Progressive Web App strategy so subsequent launches can function with limited or no connectivity, provided the browser cache has not been cleared.

Cold-start offline is not required.

## Analytics And Privacy

Anonymous usage analytics may be collected only if approved by DOST.

No personally identifiable information, photographs, or camera imagery shall be collected, stored, or transmitted. Analytics should be disabled by default during development and production until explicitly approved.

Potential approved metrics:

- Number of AR sessions.
- Mascot selected.
- Session duration.
- Device/browser type.
- Errors encountered.

Prohibited metrics:

- GPS.
- Images.
- Faces.
- Names.
- Email addresses.

## Performance

- Initial page load: under 5 seconds on Wi-Fi.
- AR ready: under 10 seconds after opening.
- Frame rate: 30-60 FPS on mid-range devices.
- First mascot load: under 3 seconds after selection.

## Browser Support

Primary:

- Chrome on Android.
- Safari on iOS.

Secondary:

- Edge Mobile.
- Samsung Internet.

Not supported:

- Desktop browsers, except for development/debugging.

## Device Acceptance Matrix

Target modern mobile devices released within the last 4-5 years that support the required browser technologies.

Minimum OS versions:

- Android 13+.
- iOS 17+.

Representative devices:

| Platform | Minimum Test Device | Recommended Test Device |
| --- | --- | --- |
| Android | Samsung Galaxy A54 or equivalent mid-range | Samsung Galaxy S24/S25 |
| Android | Google Pixel 7 | Google Pixel 9 |
| Android | Xiaomi Redmi Note 13 Pro | Xiaomi 14 |
| iOS | iPhone 13 | iPhone 16 |
| iOS | iPhone SE 3rd Gen | Latest supported iPhone |

## iOS Quick Look

The MVP shall remain entirely browser-based.

Native Quick Look may be evaluated in future phases if it significantly improves compatibility without compromising the unified user experience.

## Hosting

Development and prototyping may use GitHub Pages.

Production deployment should target Azure Static Web Apps or another DOST-approved government hosting environment, subject to security review and procurement policies.

## Security

- HTTPS only.
- Camera permission requested only when starting AR.
- No user authentication.
- No account creation.

## Accessibility

- Large touch targets.
- High-contrast UI.
- Clear permission prompts.
- Simple navigation.

