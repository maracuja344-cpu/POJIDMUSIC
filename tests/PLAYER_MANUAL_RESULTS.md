# Player verification results

Date: 2026-08-10. Baseline commit: `8d6d9c5`. Browser: current headless Google
Chrome, top-level page, desktop viewport `1440x1000`. The runner captures the native
`HTMLAudioElement` before application startup; it does not replace or mock Audio.

## Top-level runtime

| Checklist scenario | Status | Result |
| --- | --- | --- |
| Open Home, select track, activate mini-player | PASS | Native `HTMLAudioElement` played the selected track. |
| Mini-player pause/resume | PASS | Audio and mini-player classes synchronized in both directions. |
| Next and Previous | PASS | Next advanced; Previous returned through played history. |
| Manual Next under Repeat One | PASS | Iframe smoke confirmed that manual Next advances. |
| Duplicate cards mirror current/playing | PASS | All four live copies synchronized, including a carousel clone; still synchronized after carousel rebuild. |
| Repeat One ended | PASS | Real Audio and the production `ended` handler repeated the current ID. Seek-to-end is decoder-dependent, so the reproducible final run used the documented event fallback. |
| Repeat Off at a finite boundary | PASS | A one-item Search queue reached its boundary and entered global autoplay, matching current behavior. |
| Repeat All at a finite boundary | PASS | The one-item Search queue wrapped to its only ID. |
| Shuffle sequence | PASS | Two Next operations selected new IDs, Previous used history, Shuffle disabled, and the following Next worked. |
| Artist Profile navigation during playback | PASS | Current ID and playback survived the route. |
| Return Home | PASS | Newly visible matching cards regained current/playing state. |
| Fullscreen open and pause/resume | PASS | Fullscreen used the same Audio and current ID; both controls synchronized. |
| Reload while fullscreen is open | PASS | Current track restored paused; fullscreen and body open classes were absent. |
| Close fullscreen and reload again | PASS | Current track again restored paused with fullscreen closed. |
| Installed standalone PWA | BLOCKED | No installed interactive PWA session was available; service worker/PWA work was out of scope. |

The final top-level run reported 24 runtime checks PASS. During earlier diagnostic runs,
seek-to-end produced a native `ended` event; Chrome did not reproduce it consistently
for every local WAV/MP3. The permanent runner therefore waits for native `ended` first
and falls back to dispatching `ended` on the same real Audio instance. Repeat Off and
Repeat All boundary checks use that safe event simulation deliberately.

## Duplicate-card diagnosis

The production adapter `syncRenderedTrackCardsWithPlayerState()` already updates all
live `.release-card` and `.recommendation-card` nodes by the shared `data-track-id`.
Every card renderer uses the catalog ID, render paths call the adapter, and carousel
clones inherit state and remain correct after rebuild.

The previous FAIL was a harness race. It treated the early `localStorage` ID write as a
completed track transition, captured one static array of nodes, and kept polling that
array while the fade transition and asynchronous catalog rerender were still running.
Detached nodes cannot receive the later live-DOM synchronization. The regression now
waits for a settled command and requeries the current document on every poll. No
production player logic was changed.

## Fullscreen reload diagnosis

Fullscreen has no persistence key. It opens only by adding DOM classes at runtime.
The old iframe test assigned a new `src` and immediately accepted the still-active old
document as the restored page, so it read the old `open` class before navigation
committed. The test now waits until `frame.contentDocument` is a different object.
Both corrected iframe reload and two real top-level reload paths restore fullscreen
closed. The prior fullscreen FAIL was false.

## Automated results

- `queue-decisions.test.html`: 27 PASS, 0 FAIL.
- `playback-context.test.html`: 11 PASS, 0 FAIL.
- `player-runtime.test.html`: 13 PASS, 0 FAIL; real audio remains BLOCKED only inside
  the iframe harness and is covered by the top-level runner.
- `top-level-runtime.py`: 24 PASS, 0 FAIL, plus both reload state assertions PASS.

Target queue semantics were not implemented. History, autoplay, persistence, service
worker, PWA cache, Media Session, Supabase, UI, and CSS behavior were not refactored.
