# ADR-003: Use WebXR Primary With In-Browser Camera Fallback

## Status

Accepted

## Context

The PRD requires Android Chrome and iPhone Safari. The preferred experience is markerless floor AR. Stakeholder clarification requires best available experience per platform, no native app download, no Quick Look in MVP, and no commercial WebAR SDK for the initial implementation.

## Decision

Use WebXR as the primary runtime where `immersive-ar` and hit testing are supported. Use an in-browser camera-composition fallback where WebXR AR is unavailable, especially on iPhone Safari.

## Consequences

- Android Chrome can provide true markerless floor AR on supported devices.
- iOS remains in the same web app flow, preserving branding, mascot selection, transform controls, and capture.
- iOS fallback will not be as spatially accurate as WebXR floor anchoring.
- Runtime adapter abstraction is required.

## Alternatives

- Apple Quick Look/USDZ: rejected for MVP because it breaks the unified web flow and capture workflow.
- Commercial SDK such as 8th Wall: deferred because MVP should avoid vendor lock-in and recurring licensing costs.
- Marker-based AR: possible fallback, but it changes event logistics and user behavior.

