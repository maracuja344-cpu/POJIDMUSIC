# POJIDMUSIC Mobile Player UX Audit

Audit date: 2026-08-10. This audit describes the executable code in the current
`POJIDMUSIC` Git repository before Mobile Player UX Polish implementation.

## Scope and invariants

The requested change is a mobile presentation and interaction pass for release
cards, Search, Artist Profile, the mini-player and fullscreen player. It must keep:

- the single `Audio` instance and all playback/queue/repeat/shuffle semantics;
- the existing catalog, Supabase and signed-audio data flows;
- the existing player persistence and Media Session command boundary;
- desktop player controls and card presentation;
- current artwork delivery, fullscreen gestures and safe-area handling.

No new playlist, like, queue or share behavior exists in the current card surface,
so none may be represented as a working action. The Service Worker is explicitly
outside this task even though `index.html`, `style.css` and `js/player.js` are critical
shell files. PWA shell release work therefore remains a deployment follow-up rather
than part of this UX patch.

## Measured baseline

Runtime checks used the current live catalog through the local application shell.

| Surface | Viewport | Baseline |
| --- | --- | --- |
| Home release card | 390 x 844 | 172.5 x 246.75 px; metadata 65.25 px; artist row forced to 44 px. |
| Search result | 390 x 844 | Horizontal card 110 px high; artist row still forced to 44 px. |
| Mini-player | 390 x 844 | 351 x 112 px; two rows; six visible buttons; volume visible; seek surface is 317 x 22 px. |
| Fullscreen portrait | 390 x 844 | Artwork 350 x 350 px; info 79.59 px; artist row 44 px; controls 68 px. |
| Fullscreen landscape | 844 x 390, fine-pointer harness | Content overflows vertically (`y = -11.14`, height 412.28 px). Actual mobile layout depends on `mobile-device` plus coarse pointer. |
| Artist navigation | 390 x 844 | Artist route renders seven release cards and playback continues. |

The same responsive rules apply at 393 x 852; final verification must exercise both
requested portrait sizes and 844 x 390 landscape with the mobile device class.

## Findings

### Release cards and Search

`createTrackCard()` in `js/render.js` is shared by Home, Search and Artist Profile.
Its title and artist credit are already adjacent in `.release-info`, with the requested
font sizes. The visible gap and excessive card height are caused by the global mobile
accessibility rule in `style.css` that gives every `.artist-name` a 44 px minimum height
and gives each `.artist-link` 15 px vertical padding with negative margins.

The artist text is already a real navigation link using `data-artist-slug`. A card
overflow menu does not exist. Owner-only edit/hide/delete actions exist separately in
`js/track-management.js`; the new artist action must not replace or imitate them.

### Mini-player

The mobile mini-player keeps the complete desktop control set in a second grid row:
shuffle, Previous, Play/Pause, Next and repeat. Volume/time occupy the first row. Its
112 px height obscures more catalog content than the requested compact controller.

Only the cover currently opens fullscreen. Title, artist and free surface do not.
The progress bar is a pointer/touch seek control wired to the singleton Audio. Mobile
polish must make it a non-interactive visual fill without removing desktop seeking.

### Fullscreen player

Fullscreen already preserves the single Audio, queue context, focus entry/return,
Escape close, keyboard progress, scroll lock, safe-area padding and swipe-to-close.
Portrait artwork already reaches the available 350 px width. The metadata/progress
spacing can be tightened without changing typography or playback controls.

The current mobile layout has no visible action menu. Artist metadata remains a direct
link. Existing landscape CSS provides a two-column mobile layout only when both the
`mobile-device` class and coarse pointer media query match; this needs regression
verification after adding the menu.

### Accessibility and menus

The app-navigation delegate already owns artist navigation. New menus need explicit
button labels, `aria-expanded`, `role="menu"`, menuitem semantics, outside-click close,
Escape close and focus return. Opening one menu must close another. Card clicks must
continue to ignore buttons and links so menu use cannot start playback.

## Implementation boundary

The smallest compatible change affects:

- `js/artist-utils.js`: reusable, DOM-only artist action menu construction and behavior;
- `js/render.js`: attach that menu to standard and recommendation cards;
- `index.html`: add the static fullscreen artist menu host;
- `js/player.js`: bind/update fullscreen menu and open fullscreen from the mobile mini surface;
- `style.css`: compact mobile metadata, mini-player fill/layout and mobile menu placement;
- focused browser tests and behavior documentation.

No new state owner, query, persistence key, Audio instance, queue command or Supabase
dependency is required. Menu navigation reuses the existing `data-artist-slug` route.
No Service Worker edit is authorized by this task.

## Verification plan

1. Home, Search and Artist Profile at 390 x 844 and 393 x 852.
2. Mini-player contents, non-seek progress fill, surface-to-fullscreen and isolated
   Play/Pause behavior.
3. Fullscreen portrait and 844 x 390 mobile landscape geometry, existing controls,
   artist link and artist menu navigation.
4. Menu labels, focus, Escape, outside click and one-open-menu behavior.
5. Playback continuity across Artist/Home navigation and unchanged queue controls.
6. Desktop regression, standalone/safe-area CSS checks and existing player/PWA tests,
   while leaving `service-worker.js` untouched.

## Implemented result

- A 390 x 844 Home card decreased from 246.75 px to 220.75 px; the artist row
  decreased from the forced 44 px to 20 px without changing the 15/12 px fonts.
- Mobile mini-player decreased from 112 px to 72 px. Only Play/Pause has a visible
  button rect; volume, shuffle, Previous, Next and repeat remain in the desktop DOM
  and production command boundary but are hidden on mobile.
- Mini progress now fills a non-interactive layer behind the mini-player contents.
  Mobile pointer events cannot seek through it; fullscreen keeps the existing slider.
- Card and fullscreen menus expose only `Перейти к артисту`, use a 36/44 px toggle,
  move focus into the menu, close on outside pointer or Escape, and restore focus.
- Selecting an artist from fullscreen closes the modal, renders Artist Profile and
  preserves playback/current queue. The direct artist credit remains tappable.
- Fullscreen artwork measured 354.5 px at 390 x 844, 357.8 px at the 393 x 852
  safe-area case and 300 px in the existing 844 x 390 two-column layout. No measured
  control or artwork rect was clipped.

## Verification evidence

- `python tests/browser-page-tests.py`: all deterministic pages passed, including
  `mobile-player-ux.test.html` (9 assertions).
- `python tests/top-level-runtime.py`: native Audio, Play/Pause, Next, Previous,
  Repeat, Shuffle, fullscreen, Artist/Home routing, Media Session and reload passed.
- `python tests/fullscreen-visual-runtime.py --label mobile-ux`: desktop, portrait,
  safe-area, narrow mobile and 844 x 390 landscape matrix passed; touch gestures passed.
- `python tests/mobile-player-visual-runtime.py`: Home, card menu, mini-player,
  fullscreen, Artist Profile and Search screenshots captured at 390 x 844.
- `python tests/check-pwa-shell.py` and `python tests/pwa-runtime.py`: graph, release
  marker, clean install/update and offline boot passed without editing the Service Worker.

Screenshots are stored in `tests/screenshots/mobile-player-ux/` and
`tests/screenshots/fullscreen/mobile-ux/`.

The original pass intentionally left controlled `pwa-v7` clients on their cached shell.
The authorized live-correction release below resolves that deployment caveat with an
atomic release-version bump.

## Live correction

The follow-up live pass removes the fullscreen ellipsis action from artwork. Mobile
fullscreen now renders a 56 px dark-glass artist identity link below the controls, with
avatar, name and route affordance. Title and artist use a 3 px metadata gap; the mobile
artist hit area no longer forces the previous 36 px separation.

The player snapshot keeps an optional finite `duration`. This preserves the displayed
duration across a paused lazy remote restore without assigning `audio.src`; a later
`loadedmetadata` event remains authoritative and immediately saves the refreshed value.

All release, profile and managed-track popup/dropdown surfaces use one exclusive-open DOM
signal. Opening a second release menu, the profile dropdown/editor or a managed-track
menu closes the previous surface.

Verification added 18 persistence assertions and 11 focused Mobile UX assertions.
`mobile-player-visual-runtime.py` now proves `1:15` before and after reload and captures
`restored-mini-player-390x844.png`. The fullscreen `live-correction` matrix passed from
360 x 740 portrait through 844 x 390 coarse-pointer landscape without clipping; the
artist panel remains outside artwork in both orientations. The deployment release marker
is advanced atomically from `pwa-v7` to `pwa-v8`.
