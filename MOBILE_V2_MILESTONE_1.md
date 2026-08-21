# POJIDMUSIC Mobile v2 — milestone 1

Date: 2026-08-22  
PWA shell release: `pwa-v22`

## Audit findings

- Mobile presentation was the desktop shell compressed into two small breakpoints.
- The player and future navigation competed for the same bottom safe-area space.
- The mobile mini-player retained previous/next, modes, volume, time, and a full-width
  progress surface even though horizontal track gestures already existed.
- Search was embedded in Home, recreated all result cards on every input event, and had
  no separate artist-result surface or native Cancel flow.
- Account and my-tracks routes were parsed but redirected before their render branches,
  so a signed-in listener could not reach the existing account profile.
- Fullscreen already had one shared playback owner, interactive swipe-down, seek gesture
  exclusions, responsive artwork promotion, and Media Session synchronization, but its
  mobile presentation still showed desktop modes and decorative layers.

## Milestone scope

Implemented:

- stable mobile Home, Search, and Profile bottom tabs;
- safe-area-aware mobile shell spacing;
- compact glass mini-player above the navigation;
- dedicated Search mode with 180 ms local rendering debounce, Cancel, track results,
  and distinct artist results;
- linked Artist Profile or account fallback from the Profile tab;
- simplified mobile fullscreen with drag handle, artwork atmosphere, seek, previous,
  play/pause, next, and a functional Queue bottom sheet;
- explicit Track Card zone classes for artwork, information, artist, and actions;
- PWA shell release and critical module graph update.

Deferred until physical iPhone review:

- shared mini-to-fullscreen geometry transition;
- final interactive drag resistance and secondary-control interpolation polish;
- visual micro-tuning based on Dynamic Island and Safari chrome behavior;
- any backend, ratings, lyrics, playlist, or deployment migration work.

## Preserved contracts

- Existing active and transition `Audio` ownership is unchanged.
- Queue decisions, repeat/shuffle semantics, playback context, and versioned persistence
  are unchanged.
- Signed audio URL lazy resolution, expiry cache, and predicted-next preload are
  unchanged.
- Supabase queries, schema, RLS, Storage policies, Auth, and upload compensation paths
  are unchanged.
- Media Session metadata/actions and background-transition fix remain bound to the
  existing player commands.
- Desktop presentation keeps its existing header, search, mini-player controls,
  fullscreen modes, and collapse control.

## Performance comparison

The data layer is unchanged, so milestone 1 adds no Supabase request or signed-audio
request. Search remains entirely local. The production PWA graph increases from 28 to
29 local modules because `mobile-shell.js` is a new presentation owner.

Across the changed critical JavaScript files, the uncompressed source total changes
from 216,406 bytes to 218,902 bytes (`+2,496` bytes). The search rewrite removes 3,859
bytes while the shell and queue presentation add the new behavior. Artwork tiers remain
small for mini/queue and original-on-open for fullscreen.

## Automated and visual verification

- `tests/check-pwa-shell.py`: 29 production modules, 34 critical resources, release
  marker `pwa-v22`, pinned seven-resource Supabase SDK graph.
- Deterministic browser pages: playback context, artwork, queue decisions, mobile
  player UX, player persistence, data cache, audio URL resolver, and Media Session pass.
- Full player iframe runtime: 28 passed; real audible media remains blocked by the
  headless runtime exactly as documented by the harness.
- Mobile browser checks at 390 × 844: stable navigation, mini-player spacing, Search
  Cancel, track/artist results, fullscreen control reduction, Queue contents/current
  row, and interactive swipe-down pass.
- Desktop browser check at 1280 × 720: mobile navigation and Queue entry stay hidden;
  desktop search, mini-player, fullscreen collapse, shuffle, and repeat remain visible.
- Repository CDP screenshot and PWA runtime runners currently exit when the installed
  Chrome closes their DevTools socket at `Page.enable`. Screenshots and UI scenarios were
  therefore checked through the in-app browser using the repository's local preview
  fixture; the static PWA graph check passes independently.

Physical iPhone Safari, installed iPhone PWA, lock-screen/background playback, and a
real upgrade from the prior installed release remain the required live acceptance step.
