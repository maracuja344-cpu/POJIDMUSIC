# POJIDMUSIC fullscreen player audit

Date: 2026-08-10. This audit describes the existing fullscreen player before the
fullscreen UX polish stage. The current POJIDMUSIC visual language, singleton Audio,
queue semantics, persistence schema, artwork tiers and Media Session architecture remain
the source contracts.

## Method

`tests/fullscreen-visual-runtime.py` opened stable local track `local:5`, opened the
production fullscreen player, captured screenshots, measured DOM rectangles and then
stress-tested long title/artist strings. Headless Chromium used real pointer/media queries.
The 393x852 case additionally emulated safe-area insets of 47px top and 34px bottom through
CDP. Baseline artifacts are in `tests/screenshots/fullscreen/baseline/`.

## Baseline geometry

| Viewport | Artwork | Content vertical range | Controls bottom | Desktop collapse |
| --- | ---: | ---: | ---: | --- |
| 1920x1080 | 520px | 120-960 | 960 | 44x44, above artwork |
| 1440x900 | 520px | 30-870 | 870 | 44x44, above artwork |
| 1366x768 | 445px | 1-767 | 767 | 44x44, only 1px top/bottom margin |
| 1024x700 | 406px | 31-669 | 669 | 44x44, absolutely positioned |
| 390x844 | 355px | 61-723 | 723 | hidden as intended |
| 393x852 + safe area | 358px | 82-735 | 735 | hidden as intended |
| 360x740 | 311px | 93-647 | 647 | hidden as intended |
| 844x390 landscape | 133px | 23-367 | 367 | hidden as intended |

## Confirmed bugs

1. `body { overflow: hidden }` does not lock the root scrolling element in this layout;
   a page scrollbar remains visible behind fullscreen on desktop.
2. The desktop volume slider is positioned below the control row without reserved space.
   It is clipped at 1440x900, 1366x768 and 1024x700. At 1366x768 the main controls also
   finish at 766.9px in a 768px viewport.
3. Closing fullscreen does not return focus. The hidden collapse button can remain the
   active element, while the clickable mini-player cover is not keyboard-focusable.
4. The fullscreen progress control has pointer seeking but no slider semantics or keyboard
   operation. Play/Pause also keeps one static aria-label instead of describing its state.
5. At 360px the shuffle, Previous, Next and Repeat hit areas resolve to about 43x43px,
   below the intended 44px touch target.
6. A later mobile rule turns the artist row into flex without `justify-content: center`,
   so short artist metadata is not consistently centered with the title.

## Visual polish findings

- The landscape layout is valid and unclipped, but uses only 133px artwork despite ample
  horizontal space. A two-column orientation layout can use the same components and visual
  language without creating a separate player design.
- Title and artist currently remain one line with ellipsis. Stress strings overflow their
  internal scroll width but do not expand or clip surrounding layout. This behavior is
  acceptable; linked artist touch padding needs to keep the row centered.
- Desktop collapse already uses the correct down-arrow, 44px hit area and project styling.
  Only low-height placement needs adjustment so it does not consume the artwork budget.
- Pending signing/buffering has correct Audio truth (no premature `playing` class), but no
  explicit `aria-busy` state for fullscreen.

## Behaviors already correct

- Artwork remains square with stable aspect ratio and `object-fit: cover`; compact artwork
  is usable immediately and original artwork is promoted only after preload. The wrapper
  does not change dimensions during promotion.
- Normal mobile and emulated safe-area cases keep artwork and controls outside system
  insets. Computed padding was exactly 47px top / 34px bottom for the safe-area case.
- Desktop collapse is absent from coarse-pointer/mobile layout. Escape closes fullscreen.
- Gesture starts ignore buttons, links, inputs, role buttons and the progress control;
  horizontal-dominant movement does not start vertical closing.
- Opening fullscreen does not change track ID, Audio, queue or position. Reload restores
  the current track paused with fullscreen closed.

## Completed scoped corrections

1. Lock both root and body scrolling while fullscreen is open.
2. Reserve low-height desktop space through one viewport-aware artwork cap and move the
   existing collapse action out of the content flow on short desktop windows.
3. Keep mobile safe-area rules; raise narrow touch targets to 44px and center artist flex.
4. Add a single coarse-pointer landscape grid using the existing artwork/info/progress/
   controls components.
5. Add focus entry/return, keyboard opening/closing/playback, progress slider semantics,
   dynamic Play/Pause labels and non-visual busy state.
6. Characterize repeated open/close, gesture, seek and Media Session synchronization in
   runtime tests without changing player or queue semantics.

All six corrections were implemented. No queue decision, persistence schema, artwork tier,
Media Session adapter, catalog/data path, or service-worker file was changed.

## Final geometry and verification

| Viewport | Artwork | Content vertical range | Controls bottom | Result |
| --- | ---: | ---: | ---: | --- |
| 1920x1080 | 520px | 120-960 | 960 | no clipping |
| 1440x900 | 520px | 58-842 | 842 | volume visible |
| 1366x768 | 398px | 53-715 | 715 | volume visible |
| 1024x700 | 330px | 69-631 | 631 | volume visible |
| 390x844 | 355px | 122-723 | 723 | 44px+ controls |
| 393x852 + 47/34 safe area | 358px | 130-735 | 735 | insets preserved |
| 360x740 | 311px | 93-647 | 647 | 44px+ controls |
| 844x390 landscape | 300px | 45-345 | 310 | two-column layout |

Final artifacts are in `tests/screenshots/fullscreen/final/`. The responsive runner also
dispatches real CDP touch input: horizontal artwork movement and progress dragging keep the
player open, while a downward background gesture closes it in every mobile viewport.

`tests/top-level-runtime.py` now covers modal/focus/scroll contracts, three repeated cycles,
track and position continuity, fullscreen Play/Pause/Next/Previous, mode mirroring, Space,
Escape, keyboard seek, busy-state settling, persisted restore and reload-closed behavior.
The full run passed alongside data cache 10/10, audio resolver 13/13, queue 27/27,
persistence 17/17, playback context 11/11, Media Session 12/12 and iframe player 13/13.

Actual Safari browser chrome, installed iOS standalone mode, Dynamic Island/home-indicator
rendering and physical OS media buttons remain real-device checks. The implementation uses
the existing `env(safe-area-inset-*)` contract and does not add an unverified browser-specific
workaround.
