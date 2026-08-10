# POJIDMUSIC data performance baseline

Measured on 2026-08-10 against the live configured Supabase project. Browser: current
headless Google Chrome, top-level page, desktop viewport `1440x1000`, anonymous session.
The repeatable harness is `tests/data-performance-runtime.py`.

## Measurement method

The harness installs a wrapper around the page's native `fetch` before application
modules load. It records URL without query parameters or authorization headers, method,
start/end time, status, and scenario boundaries. It waits for the existing application
signals and DOM to become usable. Browser image/audio requests are not included in these
counts; Supabase REST and Storage signing calls are included because they use `fetch`.

Timing is affected by live network and backend latency. Request counts and ordering are
the reliable comparison. Milliseconds below describe individual runs and are not a
benchmark claim.

## Before optimization

| Scenario | Usable time | Supabase reads | Signed URL calls | Notes |
| --- | ---: | ---: | ---: | --- |
| Initial Home | 1156.6 ms | 1 | 11 | One `tracks` read completed first; 11 audio signing POSTs then ran in parallel. |
| Artist Profile, first open | 296.9 ms | 1 | 0 | One `artists?slug=...` read. |
| Artist Profile -> Home | 3.0 ms | 0 | 0 | Existing catalog DOM/state only. |
| Same Artist Profile, second open | 231.9 ms | 1 | 0 | Repeated the same artist read. |
| Second Artist Profile -> Home | 2.9 ms | 0 | 0 | No network. |
| Search | 0.5 ms | 0 | 0 | Filters the in-memory catalog. |
| Return from Search | 25.5 ms | 0 | 0 | Existing catalog/view state. |
| Forced catalog refresh | 101.2 ms | 1 | 0 | One `tracks` read; 11 valid signed URLs were reused from catalog state. |

Initial Home therefore made 12 data requests: one
`GET /rest/v1/tracks` followed by 11 overlapping
`POST /storage/v1/object/sign/track-audio/<path>` requests. The signed calls started
within roughly 2 ms of one another, after the tracks response completed. Artist opens
were sequential single requests. Search and Home returns were entirely memory-backed.

## Data already held in memory before optimization

- `catalog-state.js` owns merged local/Supabase track objects, nested artist credits,
  public artwork URLs, signed audio URLs, and their expiry timestamps.
- `script.js` coalesces active catalog refreshes and suppresses non-forced refreshes for
  60 seconds.
- `auth.js` owns the current session/user/profile after it has loaded.
- `app-navigation.js` owns only the currently rendered/linked artist. It previously did
  not retain artist rows by slug across route changes.
- Search filters `catalog-state` and does not query Supabase.
- Existing tracks supplied to `getPublishedTracks` allow signed audio URL reuse until
  one minute before expiry, but there was no path-keyed cache shared by all callers.

## Data access map

| Data | Caller and function | Query/parameters | Frequency and ordering | User/RLS dependency | Cache and invalidation decision |
| --- | --- | --- | --- | --- | --- |
| Profile | `auth.js` `refreshProfile` through `data-repository.js` `getProfileById` | `profiles`, own `id`, identity/display/role columns | Initial authenticated session, retries for a missing trigger-created row, explicit reload | Yes; own/admin profile RLS | Memory cache by profile ID, 60 s TTL + 4 min SWR. Force/invalidate after avatar mutation and explicit reload; clear on sign-out. |
| Upload permission | `track-upload.js` `getFreshUploaderIdentity` | `profiles(id,role)` for current session user | Every upload submission, after fresh Auth session read | Yes; security-sensitive | Intentionally not cached. Authorization must be fresh at mutation time. |
| Published catalog | `tracks-api.js` `getPublishedTracks` | `tracks` where `status=published`, nested `track_artists -> artists`; up to three serial legacy projection fallbacks only on schema errors | Startup and forced/stale catalog refresh | Public/RLS-filtered result | Existing 60 s catalog freshness and in-flight refresh coalescing retained. Force refresh after track mutations. No new SWR because current render cascade owns catalog replacement. |
| Owner tracks | `tracks-api.js` `getOwnedArtistTracks` | All RLS-visible `tracks`, ordered by date, then client filter by artist relation | Each owner Artist render | Strongly user/RLS dependent | Not cached in this phase. Mutations require immediate owner visibility; server-side artist filtering is the safer next optimization. |
| Artist by slug | `app-navigation.js` through `data-repository.js` `getArtistRow` | `artists`, `slug`, full profile/media metadata; serial legacy projections only after errors | Every Artist route render before; now first read per TTL | Public metadata | Memory cache, 5 min TTL + 25 min SWR. Artist mutations invalidate all artist lookup aliases. |
| Linked artist | `app-navigation.js`, `track-upload.js` through `getArtistRow` | `artists`, `linked_profile_id` | Auth state, account/my-tracks redirect, upload defaults | Result depends on current profile link; public artist row | Same artist policy; key includes profile ID. Cleared for user-scoped data on sign-out and invalidated by artist mutations. Concurrent callers deduplicate. |
| Artist suggestions | `track-upload.js` / `track-management.js` | `search_artists_for_credit` RPC with normalized query and limit | Debounced while typing | RLS/RPC policy | Not cached; query text is high-cardinality and results may change. Existing debounce retained. |
| Track/artist credits | Track catalog nested select; upload/update RPCs | `track_artists` nested relation; `set_track_artist_credits`, `update_managed_track` | Catalog reads and mutations | RLS and checked RPCs | Read result follows catalog policy. Mutations force catalog refresh. |
| Public covers | `tracks-api.js` `getCoverUrl` | `storage.getPublicUrl(track-covers, path)` | Mapping every row | No network request; public bucket | No data cache needed. Browser/CDN caching applies. |
| Public avatars/banners | `tracks-api.js`, `app-navigation.js`, `artist-media.js` | `getPublicUrl` for public artist/profile buckets, versioned by `updated_at` where available | Row mapping and post-upload | Public capability | No signing request. Metadata cache invalidates after upload/crop/profile edit. |
| Private audio URL | `audio-url-resolver.js` `resolveTrackAudio` | `createSignedUrl(path, 3600)` in private `track-audio` bucket | First play and at most one deterministic next-track prefetch | Temporary capability; Storage policy applies when signing | Memory cache by object path for 59 min, with in-flight dedup. Delete/error recovery invalidates the path. Never persisted. |
| Storage mutations | Upload, artist media, management modules | Upload/remove audio, cover, avatar, banner objects | User mutations only | Auth and Storage policy | No read caching. Compensation cleanup preserved. Related metadata/audio cache is invalidated after successful DB mutation. |

## Cache architecture

`js/data-cache.js` is a data-source-agnostic memory cache. Each entry contains:

- cache key;
- cached value and `hasValue` marker;
- timestamp;
- at most one in-flight Promise.

`get()` supports fresh hits, blocking misses/expiry, optional stale-while-revalidate,
force refresh, background update callbacks, and shared in-flight work. Rejected promises
always clear `inFlight`; an old stale value is not destroyed by a failed revalidation.
Invalidation can target an exact key or predicate. No values are persisted to
`localStorage` or IndexedDB.

`js/data-repository.js` owns Supabase profile and artist query shapes, legacy artist
fallbacks, policy constants, and domain invalidation. Cache keys are:

- `profile:<profileId>`;
- `artist:slug:<slug>`;
- `artist:linked_profile_id:<profileId>`.

When an artist entry is stale but still usable, the cached row is returned immediately,
one background refresh starts, and the existing route renderer is called only if the
value changed and the related route is still active. The refreshed entry is fresh before
that render, preventing a refresh/render loop.

## TTL policy

| Data | Fresh TTL | Additional SWR window | Reason |
| --- | ---: | ---: | --- |
| Current profile | 60 s | 4 min | User-specific role/display data should converge quickly; mutations force refresh. |
| Artist metadata | 5 min | 25 min | Public display metadata is relatively stable and benefits most on repeated routes. |
| Catalog metadata | 60 s | none | Existing catalog coordinator already coalesces reads and controls a broad render cascade. |
| Signed audio capability | 59 min effective | none | Server TTL is 60 min; one-minute safety leeway is retained. |

## Invalidation policy

| Mutation | Cache action |
| --- | --- |
| Upload track | New paths cannot be stale; emit `managedtrackchange` so an active owner route rereads owner tracks. |
| Edit track / change cover | Existing forced catalog refresh and `managedtrackchange`; signed audio remains valid because audio path is unchanged. |
| Hide / restore | Existing forced catalog refresh and owner-route rerender. |
| Delete | Invalidate signed audio path, remove Storage objects, force catalog refresh, rerender owner route. |
| Edit artist profile | Invalidate all artist aliases before forced catalog refresh and route render. |
| Edit artist avatar/banner/crop | Invalidate artist aliases before `artistmediachange` rerender. |
| Edit account avatar | Invalidate the profile ID before forced profile reload. |
| Sign out | Clear profile and linked-artist entries. |

## Signed URL analysis

- Only audio in private `track-audio` is signed. Track covers, profile avatars, and
  artist media use public URLs; artwork is not signed.
- Catalog rows now retain a stable Storage path and do not need a signed URL to render.
- URLs live for one hour and remain reusable until one minute before expiry.
- The resolver memory map lets playback and prefetch reuse
  `object path -> signed URL + expiry` and deduplicates simultaneous signing.
- The runtime Supabase Storage client exposes `createSignedUrls(paths, expiresIn)`, so a
  batch request is technically available. It was not adopted here because it would
  change failure granularity and catalog mapping behavior; it should be evaluated with
  partial-failure tests.
- The private audio bucket was not made public. Public artwork buckets already use
  `getPublicUrl`, which is a local URL construction operation rather than a signing call.

## After data-cache optimization (stage 1)

| Scenario | Usable time | Supabase reads | Signed URL calls | Cache observation |
| --- | ---: | ---: | ---: | --- |
| Initial Home | 1403.6 ms | 1 | 11 | Cold cache: 11 signed misses/loads. |
| Artist Profile, first open | 321.3 ms | 1 | 0 | Repository miss/load. |
| Artist Profile -> Home | 4.2 ms | 0 | 0 | Existing state. |
| Same Artist Profile, second open | 127.0 ms | 0 | 0 | Repository fresh hit. |
| Second Artist Profile -> Home | 3.3 ms | 0 | 0 | Existing state. |
| Search | 0.5 ms | 0 | 0 | In-memory catalog. |
| Return from Search | 26.2 ms | 0 | 0 | Existing state. |
| Forced catalog refresh | 101.2 ms | 1 | 0 | Existing signed URLs remain valid. |

Final cache counters for this scenario were:

```text
repository: hits=1 misses=1 loads=1 staleHits=0 deduplicated=0 entries=1
signedAudio: hits=0 misses=11 loads=11 staleHits=0 deduplicated=0 entries=11
```

The repeated Artist Profile request count improved from `1` to `0`. The complete
Home -> Artist -> Home -> same Artist -> Home sequence decreased from two artist reads
to one. Search and Home return stayed at zero. Cold Home and forced catalog refresh
request counts did not change. The startup timing difference is within live-network
variation and is not claimed as an improvement.

## After lazy audio resolution (stage 2)

Measured on the same date and live project with the updated
`tests/data-performance-runtime.py` harness:

| Scenario | Time to `audio.play()` | Supabase reads | Signed URL calls | Observation |
| --- | ---: | ---: | ---: | --- |
| Initial Home | n/a | 1 | 0 | Home rendered from metadata plus stable Storage paths. |
| First remote Play | 224.6 ms | 0 | 1 | One resolver miss/load; signing request took 218.5 ms. |
| Repeat Play, same track | 0.5 ms | 0 | 0 | Valid URL/cache reused. |
| Next-track prefetch window | background | 0 | 1 | Exactly one deterministic sequential candidate signed. |
| Next click | 238.6 ms | 0 | 0 | Prefetched URL reused; no signing request after the click. |
| Forced catalog refresh | n/a | 1 | 0 | Metadata refresh does not sign audio. |

Cold Home usable time in this run was `778.9 ms`; the prior eager-signing playback
baseline run was `1169.1 ms`. Live timing varies, so request counts are the primary
result: startup changed from `1 GET + 11 POST` to `1 GET + 0 POST`.

Final resolver counters after First Play, Repeat, Next, and two one-track prefetches:

```text
signedAudio: hits=4 misses=3 loads=3 staleHits=0 deduplicated=0 entries=3
```

An expired/invalid signed source can trigger one recovery attempt for media error code
2 or 4: invalidate the object-path entry, sign again, restore the source/time, and retry
playback. The `trackSwitchId` version check prevents late resolution or recovery from
committing after a newer track request.

Remote reload was also exercised live: the same `supabase:<id>` restored paused with no
persisted `Audio.src`; Resume signed the current Storage path, playback continued with
no media error, and the saved position was restored before time advanced normally.

## Verification

- `data-cache.test.html`: 10 PASS, covering miss, hit, TTL expiry, stale return,
  concurrent non-blocking SWR, background update, in-flight deduplication, rejected
  Promise cleanup, invalidation, and force refresh.
- `audio-url-resolver.test.html`: 13 PASS, covering playable metadata, static audio, lazy signing, cache,
  in-flight deduplication, expiry, invalidation, failure/retry, retry eligibility,
  stale A-to-B resolution, and repeated Play.
- `queue-decisions.test.html`: 27 PASS.
- `playback-context.test.html`: 11 PASS.
- `player-runtime.test.html`: 13 PASS.
- Top-level real-Audio runtime: 24 PASS; reload state checks PASS.
- `data-performance-runtime.py`: completed the same BEFORE/AFTER scenario sequence
  against the configured live read APIs.

No destructive live mutation was performed. Upload/edit/hide/restore/delete and
profile/media invalidation were verified through their production success paths,
forced refreshes, events, and cache calls. Live RLS/mutation integration remains a
separate authenticated test requirement.

## Remaining bottlenecks

1. `getOwnedArtistTracks` selects every RLS-visible track and filters by artist client-side.
2. Catalog projection fallbacks are serial on schema mismatch.
3. Changed catalog data still triggers full destruction/rerender of multiple lists.
4. Original cover files are used at card, mini-player, and fullscreen sizes.
5. Profile/artist/audio caches are memory-only and reset on reload by design.

The next highest-return data-only step is server-side filtering for owner artist tracks,
provided the relation query and deployed RLS behavior are verified. The likely largest
visual-loading gain is responsive artwork derivatives, but that is a separate explicitly
approved thumbnail phase. Service-worker work also remains separate and untouched.
