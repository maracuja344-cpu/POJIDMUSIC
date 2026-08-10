# POJIDMUSIC player behavior contract

Verified against commit `8d6d9c5572892c75b8d33c4446a4681223bf7c12` on
2026-08-10. This document records current behavior before player/queue refactoring.
It is descriptive, not a request to normalize music-player semantics.

Verification labels:

- **Automated**: exercised by the repository browser harness.
- **Code-confirmed**: followed through the current production control flow.
- **Manual**: requires real media, browser interaction, navigation, or backend mutation.

## Audio ownership

`js/player.js:26` creates one module-scoped `Audio` instance. The instance receives
all production audio sources and all media event listeners. Mini-player, fullscreen
player, and card playing state are UI projections over this instance. Navigation
switches persistent views and does not re-evaluate the player module, so it does not
create a second `Audio`.

## Playback

| Action | Current result | Verification |
| --- | --- | --- |
| Select a non-current card | Its DOM container defines a playback context; audio URL and cover are prepared; the track becomes current and starts. | Code-confirmed; manual checklist |
| Pause | Singleton audio pauses; mini/fullscreen toggles and all matching cards lose `playing`; state is saved. | Code-confirmed; manual checklist |
| Resume | The current Supabase URL is refreshed if near expiry, then the same audio resumes. | Code-confirmed; manual checklist |
| Select another track while playing | Cover/audio preparation completes, old audio fades out, source changes, new track starts. Stale async switches are rejected by `trackSwitchId`. | Code-confirmed; manual checklist |
| Select the current playing card | Playback pauses. | Code-confirmed; manual checklist |
| Select the current paused card | Playback resumes. | Code-confirmed; manual checklist |

The playing truth is `!audio.paused && !audio.ended`; no independent persisted
`isPlaying` boolean is authoritative.

## Queue

The current queue is a persisted playback context plus catalog resolution, not a
single player-state object.

On card selection, `setContextFromCard` takes unique `data-track-id` values from the
nearest relevant DOM container:

| Card location | Context type | Queue membership/order |
| --- | --- | --- |
| Artist releases | `artist` | Current artist-track cards in DOM order |
| My Tracks | `my-tracks` | Current My Tracks cards in DOM order |
| Search results | `search` | Current result cards in result order |
| Recommendations | `recommendations` | Non-clone recommendation cards in DOM order |
| Any other catalog card | `catalog` | All playable catalog tracks sorted newest first |

After creation, `playback-context.js` stores queue IDs and player navigation resolves
them through `catalog-state.js`; continued playback does not require the cards to stay
in the DOM. Duplicate and invalid IDs are removed during normalization/reconciliation
(Automated).

If a persisted catalog context is empty, reconciliation repopulates it from the
current catalog. Non-catalog empty contexts stay empty and can fall through to global
autoplay when Next is requested.

## Next

Next selection precedence is:

1. A valid forward-history entry, unless handling an audio error.
2. Shuffle candidate when shuffle is enabled; otherwise the next context-queue item.
3. Repeat All wrap is applied inside sequential/shuffle selection.
4. If nothing was selected, replace the source with a shuffled global `autoplay`
   context and take its first track.

| Scenario | Current result | Verification |
| --- | --- | --- |
| Home/global queue | Advances in newest-first catalog order, subject to forward history. | Code-confirmed; manual checklist |
| Search | Advances through the search-result snapshot. | Code-confirmed; manual checklist |
| Artist Profile | Advances through rendered artist releases. | Code-confirmed; manual checklist |
| Several-item queue | Advances until the source boundary, subject to mode/history. | Code-confirmed |
| Final item, Repeat Off | Starts a new shuffled global autoplay source; it does not simply stop. | Code-confirmed; **PRODUCT DECISION REQUIRED** |
| Final item, Repeat All | Wraps to the first item of the current context queue. | Code-confirmed |
| Repeat One, manual Next | Advances normally; it does not repeat the current track. | Code-confirmed |
| Shuffle on | Uses an unvisited random candidate or forward history. | Code-confirmed |
| Shuffle off after going backward | Forward history still wins before sequential order. | Code-confirmed; **PRODUCT DECISION REQUIRED** |

## Previous

Previous always requests the preceding item in the global playback history. It does
not use context queue order, current playback time, repeat mode, or a sequential
fallback.

| Scenario | Current result | Verification |
| --- | --- | --- |
| Immediately after the first selected track | No action: there is no earlier history entry. | Code-confirmed |
| After several Next operations | Moves to the previous valid history ID. | Code-confirmed; manual checklist |
| After shuffle | Moves backward through actual played history. | Code-confirmed |
| After one or more Previous actions | Next first moves forward through that history branch. | Code-confirmed |
| Repeat Off / All / One | Same history-only behavior in every repeat mode. Repeat All does not wrap backward. | Code-confirmed; **PRODUCT DECISION REQUIRED** |
| After reload | Restored history/cursor is used after IDs missing from the catalog are removed. | Code-confirmed; manual checklist |

## Repeat

| Mode | Natural `ended` | Manual Next | Manual Previous |
| --- | --- | --- | --- |
| Off | Selects next queue item; after the boundary starts global autoplay. | Same, without repeat-one handling. | History only. |
| All | Selects next queue item and wraps at the current context boundary. | Same. | History only; no backward wrap. |
| One | Returns the current track, sets time to zero, and starts it again. | Advances normally. | History only. |

For Repeat All, "the queue" means the current playback-context `queueIds` after
catalog reconciliation. It is not necessarily the full catalog and is not rebuilt
from a newly rendered view until another card is selected.

## Shuffle

Shuffle state changes candidate selection, not history recording. Every successful
track change is recorded in history in all modes.

- Enabling shuffle before playback leaves history empty until the first selection.
- Enabling/disabling it during playback preserves existing history and resets the
  current shuffle cycle to the current track.
- Previous traverses actual history; Next then traverses forward history first.
- A shuffle cycle excludes the current track and IDs already in `shuffleCycleIds`.
- With Repeat All, exhausting candidates begins a new cycle excluding the current
  track; without Repeat All it falls through to global autoplay.
- A one-track queue returns the same track only under Repeat All; otherwise it falls
  through to autoplay.
- A two-track queue avoids repetition until its candidate set is exhausted; subsequent
  behavior depends on Repeat All versus autoplay fallback.

Whether forward history should continue to override sequential order after shuffle is
disabled is a **PRODUCT DECISION REQUIRED**.

## Ended

The `ended` handler calls `playNextTrack({ reason: "ended" })`. Repeat One is checked
only for this reason. All other selection follows the Next precedence documented above.

| Source/mode | Current result |
| --- | --- |
| Artist/search/recommendation, more items | Next item from that context/history. |
| Artist/search/recommendation boundary, Repeat Off | Global autoplay replaces the source. |
| Any context boundary, Repeat All | Current context wraps. |
| Any context, Repeat One | Current track restarts from zero. |
| Global catalog boundary, Repeat Off | Global autoplay source is created. |
| Shuffle with candidates | Random unvisited candidate. |
| Shuffle exhausted, Repeat All | New shuffle cycle in the same context. |
| Shuffle exhausted, Repeat Off | Global autoplay source. |

## Navigation

Home/Artist/Search/Profile navigation does not intentionally pause audio, replace the
singleton, reset queue context, or clear current track. Selecting an artist from the
fullscreen artist credit or the mobile artist identity panel closes fullscreen so the destination
is visible; other route changes leave fullscreen state unchanged. Newly rendered cards
are synchronized by catalog ID. If the current card disappears, playback and Next/Previous
continue from stored IDs; returning to a view highlights any matching card again.

The manual router currently redirects `?view=account` and `?view=my-tracks` to the linked
artist or catalog before their own render branches. Therefore the requested playback
path through a distinct Profile view cannot be exercised as a separate view without
changing current navigation behavior. This audit does not change it.

## Catalog refresh

| Catalog change | Current player result |
| --- | --- |
| Metadata update for current track | Current track object/UI is replaced; audio and time are retained when the underlying audio path is unchanged. |
| New track | Context is reconciled. Existing non-catalog queue snapshots do not automatically gain the new ID; an empty catalog context can repopulate. |
| Hide/remove another track | Its ID is removed from the reconciled context; current playback continues. |
| Hide/remove current track | Audio pauses, source is removed, player state/history are cleared for the current track, mini-player deactivates, fullscreen closes. |
| Supabase URL changes but storage path does not | Existing still-valid current signed URL is retained. |

## Fullscreen UX

Fullscreen is an ephemeral modal view over the singleton Audio and current playback
context. Opening it never selects a track, replaces Audio, rebuilds a queue, or resets
position. Desktop uses the existing down-arrow collapse control; touch layouts keep the
swipe flow. Closing does not pause playback, removes root/body scroll locks and returns
focus to the opener. Reload always restores the track paused with fullscreen closed.

The version-1 player snapshot also stores the last finite track duration. This optional
field is backward compatible with existing snapshots and lets a lazily restored remote
track show its duration before a new signed audio URL is resolved. `loadedmetadata`
remains authoritative and updates both views and the persisted value.

The mini cover opens fullscreen by click, Enter, or Space. On the mobile layout, the cover,
metadata and free mini-player surface also open fullscreen, while Play/Pause only controls
audio. Mobile mini progress is a non-interactive visual fill; desktop mini progress and the
fullscreen progress slider keep their existing seeking behavior. While fullscreen is open,
Escape closes it and Space toggles playback when focus is not inside another interactive
control. The fullscreen progress bar supports pointer/touch seeking plus Home, End and
five-second arrow-key steps. Play/Pause labels follow actual playback state. `aria-busy`
mirrors pending audio resolution and media buffering without becoming a second playback
state.

Mobile safe-area padding continues to use `env(safe-area-inset-*)`. Coarse-pointer landscape
uses the same artwork, metadata, progress and controls in a two-column grid. Gesture starts
on controls/progress are ignored, horizontal-dominant movement does not close, and a valid
downward gesture closes without changing playback. See `FULLSCREEN_PLAYER_AUDIT.md` for the
viewport matrix, screenshots, limits and runtime evidence.

On mobile, artwork contains no action button. A compact dark-glass artist identity link
is placed after the controls, outside the artwork. Release action menus, the header
profile dropdown, profile editor and managed-track menus announce the same exclusive
popup event, so opening one closes any previously open popup/dropdown.

Mobile release cards keep direct artist links and add one universal action,
`Исполнители`. A solo track delegates directly to its only `data-artist-slug` route. A
collaboration opens an in-menu selector containing every structured artist credit and
navigates only after an explicit choice. The menu closes and resets after selection.
Mobile mini-player hides shuffle, Previous, Next, repeat and volume; the same production
controls remain visible in fullscreen and on the desktop mini-player. Artist menus own no
player or route state and reuse the existing navigation boundary.

## Persistence Audit (legacy state)

Before schema v1, application player state used only `localStorage`. Application code did
not use `sessionStorage` or IndexedDB; the PWA release guard and Supabase Auth persistence
are separate contracts. The audit found this legacy layout:

| State | Current key / format | Written where | Read where | Reload / restart | Safe to persist? |
| --- | --- | --- | --- | --- | --- |
| Current track ID | `player-track-id`, string | `player.js` | `player.js` | Yes / yes | Yes |
| Local audio fallback | `player-track`, path string | `player.js` | `player.js` | Yes / yes | Local only; obsolete |
| Position | `player-time`, numeric string | `player.js` | `player.js` | Yes / yes | Yes, validated |
| Paused/playing intent | none | n/a | n/a | No / no | Safe, but never authorizes autoplay |
| Volume | `player-volume`, numeric string | `player.js` | `player.js` | Yes / yes | Yes |
| Repeat | `player-repeat`, enum string | `player.js` | `player.js` | Yes / yes | Yes |
| Shuffle | `player-shuffle`, boolean string | `player.js` | `player.js` | Yes / yes | Yes |
| Queue IDs | `player-playback-context-v2.queueIds`, JSON | `playback-context.js` | same | Yes / yes | Yes |
| Queue source | same key, `type/id/label` | `playback-context.js` | same | Yes / yes | Yes |
| Current index | same key, integer | `playback-context.js` | same | Yes / yes | Yes, reconciled |
| History | `player-history-v2.ids`, JSON array | `player.js` | `player.js` | Yes / yes | Yes, max 100 |
| Forward history | IDs after `player-history-v2.index` | `player.js` | `player.js` | Yes / yes | Yes |
| Fullscreen state | none | n/a | n/a | No / no | No; ephemeral UI |
| Last signed audio URL | none | n/a | n/a | No / no | No |
| Timestamp/version | none | n/a | n/a | No / no | Required in replacement |

All legacy keys survive browser restart because they are in `localStorage`. Session-only
PWA state does not enter player migration. Auth tokens, email, DOM/Audio references and
signed URLs are never part of the player contract.

## Persistence Contract

`js/player-persistence.js` owns one key, `pojidmusic-player-state`, independently versioned
from the service-worker release:

```json
{
  "version": 1,
  "currentTrackId": "supabase:uuid",
  "position": 42.5,
  "volume": 0.1,
  "repeatMode": "off",
  "shuffle": false,
  "queue": { "ids": [], "currentIndex": -1 },
  "history": { "ids": [], "index": -1 },
  "source": { "type": "catalog", "id": "catalog", "label": "Каталог" },
  "paused": true,
  "savedAt": 0
}
```

`history.index` divides backward and forward history without duplicating two arrays.
Serialization clamps numbers/enums, caps history at 100, removes duplicate queue IDs and
rejects malformed JSON or an unknown version. Legacy state is normalized and written as
v1 first; obsolete keys are removed only after that write succeeds. A failed write leaves
legacy state intact. A legacy local audio path is mapped to its catalog ID during migration;
no URL/path becomes the durable source of truth for remote audio.

Position writes are limited to once per five seconds during playback. Immediate writes
also occur on pause, committed track switch, seek completion, `pagehide`, and transition to
hidden visibility. Volume `input` writes are debounced. `beforeunload` is not the sole or
primary lifecycle boundary.

## Restore Behavior

Boot loads/migrates v1, reconciles queue and history against playable catalog IDs, restores
track metadata, position, volume, repeat, shuffle, source and history, then presents the
player paused. The stored `paused` value is descriptive only and never permits autoplay.
Fullscreen always remains closed.

Stale queue/history IDs are removed and `currentIndex` is recalculated from
`currentTrackId`. If the current ID no longer exists or is not playable, current track and
position are cleared and the UI remains idle; no replacement track is selected. A restored
remote track gets no `audio.src`. On user/system Play, the existing lazy resolver obtains a
current signed URL and the pending position is applied after metadata. Local tracks can load
their stable local source immediately, still paused.

## Media Session Behavior

`js/media-session.js` is a fail-open adapter enabled only when `navigator.mediaSession`
exists. It publishes real title and artist plus 320, 512 and 768 artwork variants from the
existing artwork system. Album is omitted unless the track really supplies it. Metadata is
updated on track selection, restore and runtime current-track metadata refresh; it is cleared
with the current track.

Actions `play`, `pause`, `nexttrack`, `previoustrack`, `seekto`, `seekbackward`, and
`seekforward` delegate to the existing singleton-Audio/player commands. Unsupported action
registrations are ignored. Seek defaults to ten seconds and clamps to duration.
`setPositionState()` receives only finite positive duration/rate and a clamped position, is
throttled to one update per second, and is forced after metadata/seek. `playbackState` mirrors
the Audio/player truth as `playing`, `paused`, or `none`; Media Session owns no queue, repeat,
shuffle, or playback truth.

## Browser/OS Limitations

Chromium can route Android lock-screen notifications, Bluetooth/headset buttons and desktop
media keys when the OS/browser exposes them. Availability is not guaranteed by the app.
Safari/iOS expose Media Session and action subsets differently by OS version; every action is
registered independently and the player remains functional when registration or metadata
artwork validation fails. Desktop headless Chrome validates API integration only through a
mock. Actual iPhone Safari and installed iOS PWA lock-screen/background behavior require a
real-device manual test; no unverified Safari-specific workaround is included.

## Known Bugs

No player behavior in this document is classified as an unquestionable bug without a
product decision. The unusual Repeat Off/autoplay, Previous, and forward-history rules
are confirmed control-flow behavior but could be intentional. The unreachable account
and my-tracks route branches are a confirmed navigation defect outside player logic and
remain unchanged.

## Product Decision Inputs (Resolved Below)

1. Should Repeat Off stop at a finite source boundary or intentionally enter global
   autoplay?
2. Should global autoplay be a distinct user mode instead of an unconditional fallback?
3. Should Previous mean history traversal, queue predecessor, restart-after-threshold,
   or a combination?
4. Should Repeat All wrap Previous at the queue boundary?
5. Should forward history override sequential order after shuffle is disabled?
6. Should a one-track queue under Repeat Off stop or enter autoplay?
7. Should newly added tracks join an already active catalog queue snapshot?
8. Should account and My Tracks be independent routes or aliases of Artist Profile?

## Target Queue Semantics

These decisions describe target behavior for later migrations. They do not overwrite
the Current Behavior sections above and are not implemented by the pure-logic extraction.

1. **Repeat Off:** a finite queue stops at its boundary. It must not automatically enter
   global autoplay.
2. **Autoplay:** continuous playback must be a separate explicit source or mode.
3. **Previous:** above approximately three seconds, the first press restarts the current
   track. Below the threshold it uses backward history; without history it selects the
   previous current-queue item.
4. **Repeat All Previous:** Previous from the first finite-queue item wraps to the last.
5. **Shuffle -> Off:** backward history remains available, but forward shuffle history
   no longer controls Next; Next follows current queue order.
6. **One-track queue:** Repeat Off stops; Repeat All and Repeat One repeat the track.
7. **New catalog tracks:** an active finite queue is a snapshot. New tracks join only a
   new or explicitly rebuilt playback context.
8. **Account / My Tracks:** both should eventually be full routes in a separate task.

Runtime smoke after extraction confirmed card selection, Next, history Previous, manual
Next under Repeat One, fullscreen opening, Artist/Home continuity, and paused track
restoration on desktop and mobile viewports. Real audio playing was blocked in headless
Chrome. Incomplete duplicate-card mirroring and an open fullscreen after iframe reload
remain unchanged and are recorded in `tests/PLAYER_MANUAL_RESULTS.md`.

## Test coverage boundary

`tests/playback-context.test.html` automates only the production exports that are already
DOM/audio independent: normalization, deduplication, current index, reconciliation,
catalog fallback, persistence, and change notification. Next/Previous/repeat/shuffle
selection functions are private inside `player.js`; automating them as units now would
require the prohibited architectural extraction or brittle duplication. Those scenarios
remain in `tests/PLAYER_MANUAL_CHECKLIST.md`.
