# Privacy And Security

## Privacy Position

The application is privacy-preserving by design. Photos and camera imagery remain on the user's device.

## Prohibited Data Collection

The application must not collect:

- Photos.
- Camera frames.
- Faces.
- Names.
- Email addresses.
- GPS coordinates.
- Account credentials.
- Persistent personal identifiers.

## Allowed Data Collection

Anonymous analytics may be collected only after explicit DOST approval.

Potential approved metrics:

- Number of AR sessions.
- Mascot selected.
- Session duration.
- Device/browser type.
- Errors encountered.

Analytics must be disabled by default in production until approval is granted.

## Security Requirements

- HTTPS only.
- Camera permission requested only when starting AR.
- No user authentication.
- No account creation.
- No backend image processing.
- No unnecessary third-party scripts.
- Human segmentation runs locally in a Web Worker using self-hosted model and WASM assets; camera-frame buffers are never transmitted.
- Content Security Policy should be configured before production.

## Threat Considerations

### Accidental Image Upload

Mitigation: keep capture service local-only and prohibit network transmission of image blobs.

### Third-Party Analytics Overreach

Mitigation: analytics off by default; use allowlisted events only after review.

### Asset Tampering

Mitigation: immutable asset URLs, deployment review, and strict asset manifest validation.

### Camera Permission Confusion

Mitigation: request camera only from an explicit user action and explain why it is needed.

## Compliance Notes

The implementation should be designed to support review under the Philippine Data Privacy Act and DOST organizational security policies.
