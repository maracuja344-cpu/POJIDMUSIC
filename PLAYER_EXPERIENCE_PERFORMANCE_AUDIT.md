# Player Experience + Mobile PWA Performance Audit

Audit date: 2026-08-12.

## Smooth app/startup stage (pwa-v14)

- Next and Previous now carry an explicit direction through the existing production
  commands. Fullscreen rotates only the artwork card to a near-edge midpoint; the
  mobile mini-player rotates only its thumbnail. Metadata fades at the same midpoint,
  controls remain stationary, and reduced-motion uses opacity without rotation.
- The existing `trackSwitchId` remains the cancellation boundary for signing,
  preload, audio fade, visual midpoint, and cleanup. No Audio instance, queue command,
  repeat rule, or persistence key was added.
- Home now renders the bundled local catalog before remote catalog I/O. Navigation,
  auth, and refresh begin after first paint; track upload is imported on user intent;
  the Supabase client is imported by audio resolution only when a signed remote path
  is actually requested.
- Delayed (130 ms) Home and Artist Profile skeletons match release-card geometry.
  Fast local and memory-cache paths cancel the delay, preventing skeleton flash.
  Below-fold All Tracks and Recommendations use `content-visibility: auto` with an
  intrinsic fallback size.
- Listener track cards no longer create an artist-only overflow menu. Artist links in
  metadata remain direct; owner management continues to decorate only manageable
  cards.

## Before/after evidence

| Measurement | Before | After | Result |
| --- | ---: | ---: | --- |
| Static `script.js` import closure | 26 local modules | 18 local modules | -31% |
| Home usable-data gate | remote request, up to 10 s timeout | synchronous bundled catalog | network removed from first render |
| Supabase SDK in static closure | yes | no | deferred until remote/auth/signed-audio work |
| Skeleton delay | none | 130 ms | no flash on fast local/cache path |
| Directional visual duration | generic 110 ms + 430 ms cover cleanup | 155 ms + 185 ms (340 ms total) | bounded 280–360 ms transition |

The repository shell check passes with 28 production modules, 33 critical resources,
and the pinned seven-resource Supabase SDK graph. The bundled headless Chrome process
still disconnects before page execution on this machine; interactive checks therefore
use the in-app browser, while installed-phone cold/warm and foreground-return timings
remain live-device checks after deployment.

## UX implementation

- Fullscreen artist identity has three layouts: one direct centered artist link,
  two equal direct artist zones, and one 3+ artist summary that opens the existing
  selector. No avatar node is rendered.
- The existing 32 x 32 artwork sampler, normalization, request-id race guard, and
  accent promise cache remain the only color-analysis path. Neutral, black, white,
  and missing artwork use the safe fallback; saturated colors are lightness and
  saturation bounded.
- Mobile controls use five equal grid columns. Measured touch targets at 390 px were
  48, 48, 68, 48, and 48 px; Play/Pause and the controls container shared the same
  horizontal center.
- Fullscreen opening is two-phase: the neutral shell moves first, then artwork,
  metadata, controls, background, and ambient layers reveal. Closing removes the
  reveal state before the shell exits. Original artwork promotion remains async and
  never gates opening.
- Media Session registers play, pause, previous, next, and seekto. Relative seek
  handlers are deliberately not registered. The OS/browser decides the visible lock
  screen layout.

## Verified performance baseline

The live URL was `https://maracuja344-cpu.github.io/POJIDMUSIC/`. At audit time it
served release `pwa-v8`, so live observations describe the previous deployed shell,
not this `pwa-v12` change.

The browser-observed live asset inventory contained 57 assets: 36 scripts, 19 images,
1 stylesheet, and 1 other asset. Origins were 38 GitHub Pages assets, 7 esm.sh assets,
and 12 Supabase assets. This confirms that the wide startup module graph and remote
SDK graph remain the principal boot cost. No production data query or artwork policy
was changed in this stage.

Local player runtime passed 23 scenarios including fullscreen open/close, Next,
Previous, horizontal swipe, progress/control exclusions, navigation, and reload.
The deterministic artist, accent, Media Session, artwork, queue, persistence, and
playback-context suites also passed.

## Measurement limitations

- Installed Android/iOS PWA, lock-screen appearance, cold/warm device timing, and
  background-to-foreground timing require a real phone after deployment.
- The installed Chrome/Edge CDP processes on the audit machine crashed before loading
  the app, so the repository visual/PWA automation could not produce trustworthy
  timing traces. Static shell graph checks and browser page runtime checks passed.
- Do not infer iOS Media Session button layout from registered handlers; Safari may
  ignore supported actions.

## Recommended next performance stage

Measure the deployed `pwa-v12` shell on an Android Chromium browser and installed PWA,
then on iOS Safari/PWA if available. Capture cold, warm, and foreground-return traces.
Prioritize the wide startup graph (36 observed scripts plus the 7-resource esm.sh SDK
graph) before changing blur/glow: the mobile effect radii are already constrained and
the current evidence does not establish them as the leading bottleneck. Do not begin
that refactor without a separate scope.
