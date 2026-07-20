# Device Support Matrix

## Support Philosophy

Support is defined by capability, not by an exhaustive list of models. The project targets modern mobile devices released within the last 4-5 years that support the required browser technologies.

Required capabilities:

- Mobile browser.
- HTTPS secure context.
- WebGL2.
- WebAssembly.
- Camera access.
- WebXR `immersive-ar` and hit testing for markerless AR path.

## Primary Browsers

- Chrome on Android.
- Safari on iOS.

## Secondary Browsers

- Edge Mobile.
- Samsung Internet.

## Unsupported Production Browsers

- Desktop browsers.
- Legacy mobile browsers without WebGL2 or camera support.
- In-app browsers that block camera or required APIs.

## Minimum OS Versions

- Android 13+.
- iOS 17+.

## Representative Acceptance Devices

| Platform | Minimum Test Device | Recommended Test Device |
| --- | --- | --- |
| Android | Samsung Galaxy A54 or equivalent mid-range | Samsung Galaxy S24/S25 |
| Android | Google Pixel 7 | Google Pixel 9 |
| Android | Xiaomi Redmi Note 13 Pro | Xiaomi 14 |
| iOS | iPhone 13 | iPhone 16 |
| iOS | iPhone SE 3rd Gen | Latest supported iPhone |

## Expected Runtime By Platform

| Platform | Expected Runtime | Notes |
| --- | --- | --- |
| Android Chrome | WebXR markerless AR | Requires WebXR and ARCore-compatible device. |
| Samsung Internet | WebXR if available, otherwise fallback | Validate behavior during QA. |
| Edge Mobile Android | WebXR if available, otherwise fallback | Validate behavior during QA. |
| iPhone Safari | Camera-composition fallback | MVP remains fully in-browser. |

## Markerless Occlusion Tiers

| Available capability | First Experience behavior |
| --- | --- |
| WebXR depth sensing | Geometry and people in front of the mascot occlude it per pixel. |
| Camera access but no readable depth | On-device person segmentation lets people occlude the mascot; room geometry does not. |
| Neither depth nor camera texture access | Stable hit-test placement and anchors remain available without real-world occlusion. |

iPhone Safari continues to use the camera-composition fallback and does not gain equivalent world-locked placement or WebXR depth from this change.

## Acceptance Criteria

- Android WebXR path starts, detects a placement surface, places mascot, transforms mascot, captures photo.
- On a depth-capable Android test device, a person and nearer room geometry correctly pass in front of the mascot without obvious edge flicker.
- On an Android device without exposed depth, the person-mask fallback correctly places a person in front of the mascot.
- iOS fallback starts camera, displays mascot overlay, transforms mascot, captures photo.
- Unsupported devices receive clear guidance.
- No browser path requires native app installation.
