# TICKET-012: PWA Offline Cache

## Purpose

Implement repeat-visit offline behavior after an initial successful online launch.

## Dependencies

- TICKET-001
- TICKET-006

## Implementation Notes

- Add web app manifest.
- Add service worker through Vite PWA or Workbox.
- Cache app shell and essential runtime chunks.
- Cache mascot metadata and previously loaded assets.
- Version caches.
- Show clear messaging for unavailable offline assets.

## Acceptance Criteria

- First launch requires internet.
- Repeat launch can load app shell with limited or no connectivity.
- Previously loaded mascot can be reused if cached.
- Cache update does not trap users on stale broken builds.

## Testing Requirements

- Browser offline test.
- Service worker update test.
- Asset cache version test.

## Risks And Pitfalls

- Aggressive caching can make rollbacks harder.
- Large model caches may be evicted by the browser.

## Complexity

Medium

