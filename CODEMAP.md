# POJIDMUSIC: architectural codemap

Audit date: 2026-08-10. This document describes the code currently present in the
repository. It is not a description of an intended or older architecture.

## 1. Project summary

POJIDMUSIC is a buildless browser SPA/PWA. `index.html` contains the persistent
application shell and all views. Native ES modules render and replace track cards,
manage History API navigation, authentication, uploads, and one module-scoped
`HTMLAudioElement`. The runtime catalog merges a global local array from `tracks.js`
with published rows from Supabase. There is no package manifest, bundler,
server-side application, or framework router. Lightweight browser/CDP tests live in
`tests/` and run without a package manager.

The current visual language in `index.html` and `style.css` is the product source of
truth. Architectural changes must preserve it unless a task explicitly requests a
visual change.

## 2. Main file tree

```text
.
|-- index.html                  persistent shell, views, dialogs, both players
|-- style.css                   all desktop/mobile/PWA and component styling
|-- tracks.js                   global fallback/local catalog (`tracks`)
|-- manifest.webmanifest        PWA identity, scope, icons, standalone display
|-- service-worker.js           atomic shell generation and pinned SDK cache
|-- PWA_BASELINE.md             measured SW/PWA before/after and release contract
|-- FULLSCREEN_PLAYER_AUDIT.md  fullscreen baseline, fixes and viewport evidence
|-- MOBILE_PLAYER_UX_AUDIT.md   measured mobile cards/player UX and verification
|-- PLAYER_EXPERIENCE_PERFORMANCE_AUDIT.md  player UX and live/PWA baseline
|-- SETUP_SUPABASE.md           setup notes, not runtime code
|-- icons/                      install and favicon assets
|-- img/                        local artwork and fallback cover
|-- music/                      local audio files
|-- js/
|   |-- script.js               application composition and catalog refresh
|   |-- catalog-state.js        in-memory catalog store
|   |-- data-cache.js           generic memory TTL/SWR/in-flight cache
|   |-- data-repository.js      cached profile and artist reads/invalidation
|   |-- tracks-api.js           track metadata queries and catalog mapping
|   |-- audio-url-resolver.js   private audio signing adapter and shared cache
|   |-- audio-url-resolver-core.js DOM-free resolution/cache policy
|   |-- artwork.js              responsive Supabase artwork URL/delivery policy
|   |-- tracks-utils.js         playable-release predicate
|   |-- render.js               catalog cards, mobile artist actions and rendering
|   |-- search.js               client-side search and search-result rendering
|   |-- player.js               audio engine, modes, player UI, persistence
|   |-- player-persistence.js   versioned snapshot, legacy migration, reconciliation
|   |-- media-session.js        fail-open OS media controls/metadata adapter
|   |-- queue-decisions.js      pure queue/repeat/shuffle/reconciliation decisions
|   |-- playback-context.js     persisted queue source and queue IDs
|   |-- app-navigation.js       query-string routes and profile/artist views
|   |-- navigation.js           hash/section navigation; currently not initialized
|   |-- carousel.js             recommendation cloning, scrolling, cleanup
|   |-- auth.js                 Supabase Auth and profile state
|   |-- track-upload.js         validation and multi-step track upload
|   |-- track-management.js     owner/admin edit, visibility, delete actions
|   |-- artist-media.js         avatar/banner processing and persistence
|   |-- artist-utils.js         artist credits, identity link and exclusive action menus
|   |-- image-cropper.js        reusable crop modal and focal backgrounds
|   |-- mobile.js               device/standalone detection and gesture guards
|   |-- pull-to-refresh.js      mobile/PWA catalog refresh gesture
|   `-- supabase/
|       |-- config.js           public project URL and anon key
|       `-- client.js           singleton client; exact bundled esm.sh dependency
`-- supabase/migrations/        schema, functions, RLS, and Storage policies
```

Largest and most overloaded files: `player.js` (4125 lines), `track-upload.js`
(1452), `auth.js` (888), `app-navigation.js` (791), `carousel.js` (557),
`search.js` (495), `script.js` (488), and `style.css` (about 116 KB).

## 3. Entry points and module graph

`index.html:1261` first loads classic `tracks.js`, creating the global local catalog.
`index.html:1265` then loads `js/script.js` as the only module entry point.
`script.js:486-488` starts core initialization, auth initialization, and service-worker
registration independently.

Core initialization order (`script.js:367-400`):

1. Load local and remote catalogs, then merge them.
2. Detect the mobile/standalone environment.
3. Render New, All tracks, and Recommendations.
4. Initialize reveal animation, search, the player, query-string navigation,
   recommendation carousel, and refresh lifecycle listeners.
5. Auth and upload are dynamically imported in a parallel initialization branch.

Direct dependency map:

```text
index.html -> tracks.js (global `tracks`)
           -> script.js

script.js -> render -> player -> catalog-state, playback-context, queue-decisions,
                              artist-utils, audio-url-resolver
          -> search -> render + player + catalog-state
          -> app-navigation -> render + search + player + tracks-api
                            -> track-management + artist-media + data-repository
          -> carousel, mobile, pull-to-refresh, catalog-state
          -> dynamic auth -> data-repository + Supabase
          -> dynamic track-upload -> auth + data-repository + Supabase

data-repository, tracks-api, auth, track-upload, track-management, artist-media,
app-navigation -> supabase/client -> remote esm.sh Supabase SDK

data-repository -> data-cache
audio-url-resolver -> audio-url-resolver-core -> data-cache
```

There is no strict import cycle through `player.js`, but the graph is strongly coupled:
`render.js` and `search.js` directly call player UI synchronization, while navigation
imports rendering, search, player, data access, media mutation, and management. The
result is a wide startup graph: `script.js` statically imports `app-navigation.js`, so
the remote Supabase SDK is required even before the dynamic Auth branch runs.

`navigation.js` exports section/hash navigation but is not imported or initialized by
the current entry point. Its behavior is effectively dead code.

## 4. Architectural flows

### UI -> data -> Supabase

```text
tracks.js local rows ------------------------------+
                                                   v
script.prepareCatalog -> tracks-api.getPublishedTracks -> tracks table
                                                   -> track_artists/artists relation
                                                   -> public cover/artist-media URLs
                                                   v
                                      catalog-state (memory)
                                                   v
render/search/app-navigation -> DOM track cards -> player click delegation
                                                   v
                         audio-url-resolver -> signed track-audio URL -> Audio.src
```

The catalog is immutable by convention (`Object.freeze`) but has no subscription API.
Callers mutate it through `setCatalogTracks`/`replaceCatalogTrack`, then manually call
all affected render/reconcile functions.

### Navigation

`app-navigation.js` is a small manual router. It maps `?artist=slug`,
`?view=account`, and `?view=my-tracks`; `history.pushState/replaceState` changes the
URL and `hidden` switches among persistent `<main>` elements. Track-card children are
recreated inside views, but the page shell, player DOM, JS modules, and `Audio` survive.

Current behavior of `renderRoute` redirects both account and my-tracks routes to the
linked artist (or catalog) before their render branches. Consequently the account and
my-tracks render functions/views are currently unreachable through this router. Search
is not a URL route; it hides catalog sections and recreates result cards in place.

### Storage

Player state uses one localStorage key, `pojidmusic-player-state`, with schema `version: 1`.
It contains current track ID/position/volume/modes, queue/current index/source,
history/cursor, paused state and `savedAt`. `player-persistence.js` owns validation,
serialization, legacy migration and catalog reconciliation; `playback-context.js` updates
only the queue/source slice through that contract. The eight old player keys are migration
inputs and are deleted only after a successful v1 write.

There is no application player use of `sessionStorage` or IndexedDB. Supabase Auth and the
PWA session reload guard are separate. Restore never auto-plays, fullscreen is ephemeral,
and signed audio URLs are deliberately absent from durable state.

### PWA

The manifest supplies standalone display and 192/512/maskable icons. The release-atomic
service-worker contract is documented in `PWA_BASELINE.md`; audio, artwork/data APIs and
other cross-origin application data bypass shell caches.

## 5. Player architecture

### State and responsibilities

`player.js:26` creates exactly one module-scoped `Audio`. Mini-player and fullscreen
player are two views/controllers over it; they do not create audio instances.

Fullscreen remains an ephemeral view over that same state. Its modal semantics, focus
entry/return, root scroll lock, keyboard progress, pending/buffering accessibility state,
safe-area layout, mobile artist identity and gestures are implemented in `index.html`,
`style.css`, `artist-utils.js` and `player.js`. Baseline/final measurements and screenshots are documented in
`FULLSCREEN_PLAYER_AUDIT.md` and `PLAYER_EXPERIENCE_PERFORMANCE_AUDIT.md`; no
fullscreen-owned queue or Audio state exists. The fullscreen artist identity renders
one direct zone, two equal direct zones, or a 3+ selector summary.

Core state is split across:

- `player.js`: `currentTrack`, playing truth from `audio.paused/audio.ended`, volume,
  repeat, shuffle, shuffle/history cursor, transitions, artwork state, and DOM refs.
- `playback-context.js`: queue source metadata, ordered queue IDs, current index.
- `catalog-state.js`: canonical track objects used to resolve queue IDs.
- DOM: the clicked card determines the initial source queue; card classes mirror state.
- `localStorage`: restoration data listed above.

`playTrack` resolves the latest track audio URL on demand, prepares the cover, fades the
old track, assigns `audio.src`, updates both player UIs, saves state, and calls `play()`.
Play/pause buttons and clicking the current card toggle the singleton audio.

### Queue engine as implemented

There is a real persisted queue context, but not yet one cohesive queue-state object.
When a card is selected, `setContextFromCard` inspects its nearest DOM container and
copies current card IDs for artist, my-tracks, search, or recommendations. Otherwise it
uses the full catalog. Playback after that resolves IDs from data, so removing the card
does not stop audio. The initial queue snapshot nevertheless depends on which cards
happen to exist in the DOM at click time.

The engine functions are:

- `getPlaybackQueue`: resolves context IDs, with a catalog fallback.
- `getSequentialTrack`: ordered navigation and repeat-all wrapping.
- `getShuffledTrack`: random unplayed selection and shuffle-cycle reset.
- `getHistoryTrack`: backward/forward history traversal.
- `getTrackForNavigation`: precedence among history, repeat-one, queue, and autoplay.
- `beginAutoplay`: replaces the source with a shuffled global catalog context.
- `playNextTrack` / `playPreviousTrack`: transition commands.

History is separate from context, is recorded for every changed track (not only while
shuffle is enabled), is capped at 100 IDs, and is persisted independently.

### Scenario matrix

| Scenario | Current behavior |
| --- | --- |
| Normal playback | One audio instance; card sets source queue; both player UIs sync. |
| Next | Uses forward history first, then shuffled/sequential queue. |
| Previous | Uses history only; no sequential fallback or repeat-all wrap. |
| Shuffle | Avoids IDs in the current cycle; previous/forward traverse history. |
| Repeat Off | End of source queue starts global autoplay instead of stopping. |
| Repeat All | Sequential Next wraps; shuffle begins a new cycle. |
| Repeat One, natural end | Restarts current track at time zero. |
| Repeat One, manual Next | Moves to the next track; repeat-one is ignored as intended. |
| Last artist track | With repeat off, source changes to global autoplay. |
| Artist navigation | Artist/query fetch and card rerender; audio continues. |
| Page/view transition | Shell and audio persist; card mirror is resynchronized. |
| Reload | Track/UI/position/modes/queue/history restore paused. |
| Current card removed | Audio continues; `currentCard` can be detached; new cards sync by ID. |
| Current catalog row removed on refresh | Audio is paused and cleared; fullscreen closes. |

### Conflicting/risky player branches

- **High:** Repeat Off does not mean stop at queue end because `beginAutoplay()` is an
  unconditional final fallback (`player.js:617-624`). Product semantics must be fixed
  in tests before changing this.
- **High:** Previous always uses history (`player.js:602`, `2652-2658`), so the first
  played item cannot go to a preceding queue item and Repeat All cannot wrap backward.
- **High:** Forward history takes precedence even after shuffle is disabled, since
  history is recorded in every mode. Mode changes can therefore produce surprising Next.
- **Medium:** context `currentIndex` is persisted but navigation recomputes index from
  `currentTrack`; two representations can temporarily disagree.
- **Medium:** queue creation reads DOM card order. Data playback is resilient after the
  snapshot, but filtered/incompletely rendered cards define source membership.
- **Medium:** `startAudio` catches a rejected `play()` without invoking autoplay-error
  continuation, while media-element `error` does. Failure behavior depends on failure path.
- **Low:** current-card references may remain detached until the next lookup, although
  visible state synchronization is ID-based and remains functional.

No Media Session API integration exists despite a comment mentioning it. There are no
OS lock-screen metadata or play/pause/next/previous action handlers.

## 6. Supabase and data inventory

### Tables, relations, buckets, and RPCs

Tables: `profiles`, `tracks`, `artists`, `track_artists`; Auth uses `auth.users`.
Storage buckets: `track-audio` (private), `track-covers` (public), `profile-avatars`
(public), `artist-media` (public).

RPCs called by the frontend: `search_artists_for_credit`, `set_track_artist_credits`,
`update_artist_profile`, `set_artist_crop`, `set_artist_media_with_crop`,
`update_managed_track`, `set_managed_track_visibility`, and `delete_managed_track`.

### Query flows

- Home/startup: one published `tracks` query with nested `track_artists -> artists`.
  On schema/column error it retries up to three older projections sequentially. Remote
  catalog rows retain `audio_path`; startup does not create signed audio URLs.
- Search: no Supabase query; it filters the in-memory catalog and recreates cards.
- Artist Profile: an `artists` query by slug with up to two legacy projection retries.
  Owners additionally query all RLS-visible tracks, filter artist association in the
  browser, and map matching rows without signing audio.
- Profile/settings: Auth loads `profiles`; linked-artist resolution queries `artists` by
  `linked_profile_id`. Route/auth/media events can repeat these queries.
- Upload: fresh Auth session, `profiles(id,role)`, sequential audio and cover uploads,
  `tracks` insert, then credits RPC; failures attempt row/object cleanup.
- Edit/manage: artist suggestion RPC; optional cover upload; update/visibility/delete
  RPC; then forced full catalog refresh. Media deletion follows successful delete RPC.
- Avatar/banner: client canvas processing, Storage upload, profile update or artist RPC,
  then best-effort removal of superseded object.

Signed track-audio URLs have a one-hour TTL. `audio-url-resolver.js` creates them only
for playback or a single deterministic next-track prefetch. Its DOM-free core shares
URLs and in-flight requests by Storage object path until one minute before expiry.
Catalog rows remain playable metadata with a stable `storageAudioPath` and an optional
runtime `audio`/`audioExpiresAt`; signed capabilities are never persisted.

### Memory data repository

`data-cache.js` owns generic cache entries (`value`, timestamp, in-flight Promise), TTL,
stale-while-revalidate, force refresh, statistics, and invalidation. It has no Supabase
or DOM dependency. `data-repository.js` owns cached `profiles` reads by ID and `artists`
reads by slug/linked profile, including the existing legacy artist projection ladder.

Profile entries use a 60-second TTL plus four-minute SWR and are cleared/forced after
profile mutations or sign-out. Public artist metadata uses a five-minute TTL plus
25-minute SWR and all lookup aliases invalidate after artist profile/media changes.
Security-sensitive upload role validation remains an uncached direct query. Catalog
reads retain the existing 60-second freshness window and active-refresh coalescing in
`script.js`; owner-track reads remain uncached. `PERFORMANCE_BASELINE.md` contains the
complete query/invalidation inventory and measured before/after request counts.

### Auth and authorization

Email/password login and signup use Supabase Auth. A profile trigger creates the public
profile; the client retries briefly if replication/API visibility lags. Roles are
`listener`, `artist`, and `admin`. The frontend hides upload and owner controls based on
profile role, linked artist, owner ID, or admin state.

These frontend checks are presentation guards, not the security boundary. The included
migrations enable RLS on core tables, protect privileged profile fields, gate track
mutations by role/owner/status, gate Storage paths by `auth.uid()`, and put management
operations behind security-checked RPCs. No obvious frontend-only mutation permission
was found. Deployment drift remains a risk: the repository cannot prove that the live
Supabase project has every migration applied.

## 7. Performance and reliability findings

| Priority | Location | Finding and consequence | Recommended direction (not implemented) |
| --- | --- | --- | --- |
| Addressed (PWA phase) | `service-worker.js`, `supabase/client.js` | Precache omitted eight required modules and the unpinned cross-origin SDK graph was not in Cache Storage. | The verified 28-module closure and exact seven-resource SDK bundle graph now install before activation; graph drift fails an automated check. |
| Addressed (PWA phase) | `service-worker.js`, `script.js`, `index.html` | Stale-while-revalidate could mix fresh HTML with old JS/CSS and claim without reloading an open graph. | Release-matched navigation, immutable cache-first shell generations, exact controller tokens, and one guarded reload make update atomic. |
| Addressed (phase 2) | `audio-url-resolver.js`, `tracks-api.js`, `player.js` | Startup previously made O(track count) signed-URL API calls. | Catalog mapping is metadata-only; play resolves one URL and may prefetch one deterministic next track. |
| High | `tracks-api.js:390-402` | Owner artist view selects all RLS-visible tracks then filters by artist client-side. | Query the relation/artist ID server-side and select only required rows. |
| High | `render.js:205-305`, `script.js:225-233` | Any changed catalog fully destroys and rebuilds three lists, search, carousel clones, player mirrors, and active route. | Introduce keyed/incremental rendering after behavior tests exist. |
| Addressed (artwork phase) | `artwork.js`, `render.js`, `player.js` | Cards previously used public originals at every size. | Supabase transforms now provide measured responsive tiers; fullscreen promotes to original on demand. |
| Addressed (phase 1) | `data-repository.js`, `app-navigation.js` | Repeated artist route reads used to repeat per render. | Memory TTL/SWR cache now removes immediate repeated reads; legacy fallbacks remain serial only after errors. |
| Addressed (phase 1) | `data-repository.js`, `auth.js`, `track-upload.js` | Profile and linked-artist reads were independent. | Shared repository and in-flight dedup now cover display profile and linked artist; upload permission remains deliberately fresh. |
| Medium | `search.js:264-334` | Each keystroke scans all tracks, clears results, recreates cards, observers, and images; no debounce. | Index normalized searchable fields and debounce/incrementally update. |
| Medium | `player.js:1337-1380` | Play/pause synchronization repeatedly queries and updates every card in the document. | Maintain an ID-to-rendered-cards registry in the UI adapter. |
| Medium | `player.js:198-227`, `catalog-state.js` | Deduplication and repeated ID lookups are linear; queue building can be O(n^2). | Keep a catalog ID map and derive ordered lists once per catalog version. |
| Medium | `script.js:172-193,279-282` | Full-object JSON fingerprints sort and serialize the catalog on refresh. | Use revision metadata or a cheaper stable version/hash at the data boundary. |
| Addressed (artwork phase) | images in `render.js` | Dynamically created cards lacked explicit lazy loading, responsive sources, and decoded-size policy. | Cards now use `srcset`/`sizes`, below-fold lazy loading, async decoding, intrinsic ratio, and original fallback. |
| Low | artist ambient/player accent | Canvas color sampling costs CPU, but both paths have in-memory caches and small sample canvases. | Retain caching; move work off critical render only if profiling justifies it. |
| Low | lifecycle refresh | focus, pageshow, and visibility listeners can all fire, but a shared in-flight promise and 60-second freshness window suppress most duplication. | Preserve coalescing; document invalidation events. |

There is no data prefetch beyond browser module fetching and cover preloading for the
selected track. There is no durable catalog cache. Audio intentionally bypasses the
service worker. Recommendation rendering is random and rebuilt on changed refreshes.

## 8. PWA release contract

`service-worker.js` owns two caches: one `pojidmusic-shell-<release>` generation and one
exact-version Supabase SDK bundle cache. Critical local resources and the SDK graph must
all install successfully before `skipWaiting`; optional icons cannot block activation.
Activation deletes only obsolete `pojidmusic-*` caches and leaves unrelated caches alone.

Root/`index.html` navigation is network-first but accepts network HTML only when its
`pojidmusic-release` meta matches the controlling worker. Otherwise it returns that
worker's cached HTML until the new generation activates. JS/CSS are cache-first from the
active immutable generation and never receive runtime overwrites. `script.js` registers
with `updateViaCache: none`, asks each new controller for its exact release token, and
reloads once per new token. Other documents inside scope are not treated as SPA routes.

The complete local import closure is enforced by `tests/check-pwa-shell.py`; upgrade,
optional/critical install failure, cleanup, one-reload, mixed-version, and offline boot
are exercised by `tests/pwa-runtime.py`. Release procedure and measured results are in
`PWA_BASELINE.md`.

Offline behavior provides the full app shell, pinned SDK code, CSS, and seven local
catalog rows after the existing network timeout. Supabase data/auth/mutations, remote
artwork, signed audio, and uncached local media remain unavailable. This is still not an
offline music player.

## 9. Artwork and media loading

Covers come from public `track-covers` URLs (or local paths/fallback). Avatars and banners
come from public profile/artist buckets and use `updated_at` as a query-string version.
Audio uses private one-hour signed URLs. Uploads enforce type/size client-side and
Storage policies enforce the backend boundary.

Account/artist images are converted client-side to WebP at bounded master dimensions;
crop/focal metadata is saved separately. `artwork.js` derives stable Supabase render URLs
without replacing originals: track cards use 320/512 px tiers, recommendations may use
768 px, avatar uses a 320 px bound, and banner uses a 1200 px bound. CSS still owns the
visible crop/focal behavior. Mini-player uses 320 px; fullscreen loads the original only
after it opens. Local/legacy images remain unchanged and transformed-image errors fall
back to the original. Measurements and live endpoint verification are recorded in
`ARTWORK_PERFORMANCE.md`.

## 10. Risk register

- **Addressed:** clean-install shell and pinned SDK dependency graphs are complete and tested.
- **Addressed:** service-worker releases use matched atomic generations and guarded reload.
- **High:** player end-of-queue and Previous semantics conflict with conventional mode
  names; lock current expected behavior in tests before refactoring.
- **High:** `player.js` mixes audio engine, queue, persistence, artwork analysis,
  animations, gestures, mini/fullscreen UI, and DOM discovery.
- **Addressed:** signed URL fan-out was removed from catalog and owner-track loads.
- **High:** browser tests now cover core player transitions, route continuity, and the
  data-cache primitive, but no automated tests cover live RLS contracts or PWA
  update/offline flows.
- **Medium:** manual router contains unreachable account/my-tracks branches.
- **Medium:** query fallback ladders conceal schema drift and multiply failure latency.
- **Medium:** data store has no events; refresh correctness depends on a manual cascade.
- **Medium:** direct UI-to-player imports couple rendering to engine state.
- **Medium:** live backend policy/migration parity cannot be verified from this client repo.

## 11. Recommended refactoring order

No step below is implemented by this audit.

1. **Stabilize and characterize.** Add deterministic tests for the scenario matrix,
   catalog refresh, route transitions, auth roles/RLS integration, and PWA update/offline
   behavior. Decide explicit Repeat Off/autoplay and Previous semantics.
2. **Split low-risk UI concerns out of `player.js`.** Extract pure formatting, artwork
   color analysis, fullscreen gestures/animation, and DOM adapters without changing the
   audio/queue state machine.
3. **Create one observable player state boundary.** Keep the singleton `Audio`; expose
   commands/events and move mini/fullscreen/card synchronization behind adapters.
4. **Consolidate the queue engine.** Make `currentTrack`, ordered queue, current index,
   history, source, repeat, and shuffle one tested state machine independent of DOM.
5. **Addressed: version persistence.** Schema v1 validates the player snapshot, migrates
   existing localStorage keys, reconciles catalog IDs and always restores paused.
6. **Expand the data repository/cache.** Profile/artist caching and lazy signed-audio
   resolution are in place. Add measured owner-track/catalog reads only where RLS and
   mutation invalidation can remain explicit.
7. **Fix PWA asset delivery.** Produce a complete, versioned, atomic same-origin asset
   graph and explicit update strategy; verify desktop, mobile, and standalone installs.
8. **Optimize artwork.** Add derivatives, responsive loading, lazy decoding, and cache
   policy without visual redesign.
9. **Extend source-aware prefetch.** Audio now prefetches at most one deterministic
   sequential candidate. Consider metadata/artwork only after measuring their benefit
   and network cost.
10. **Addressed: Media Session.** Metadata, position/playback state and OS actions bind to
    the existing singleton-Audio commands without owning parallel player logic.
11. **Only then evolve UX.** Preserve the existing POJIDMUSIC design unless separately
    requested.

PWA stabilization is placed before artwork/prefetch because the current deployment model
can invalidate test results and ship mixed code. Queue consolidation follows the state
boundary so behavior is observable and testable during migration.

## 12. Files to split first

1. `player.js`: engine/state machine, queue policy, persistence, DOM adapter,
   mini/fullscreen views, artwork analysis, gestures/transitions.
2. `track-upload.js`: form/controller, file validation, artist picker, upload transaction,
   cleanup/error mapping.
3. `app-navigation.js`: route parser/history, view controller, artist repository,
   profile editor/media controller.
4. `auth.js`: auth session service, profile repository, modal/form UI.
5. `script.js`: bootstrap, catalog repository/refresh coordinator, PWA registration.
6. `style.css`: split only after component ownership is established; preserve output.

## 13. Things not to change yet

- Do not redesign the interface or imitate external music clients.
- Do not create another `Audio` instance or replace the singleton before engine tests.
- Do not change repeat/shuffle/autoplay/previous behavior until product semantics are
  explicitly accepted and captured in tests.
- Do not remove the local `tracks.js` fallback until offline/degraded requirements are
  decided.
- Do not delete legacy Supabase projection fallbacks before deployment schema parity is
  proven.
- Do not alter schema/RLS/Storage policies as part of a frontend cleanup.
- Do not combine router, player, data, and visual changes in one migration.
- Do not remove working paths until their replacements pass desktop, mobile, and
  standalone PWA scenarios.
