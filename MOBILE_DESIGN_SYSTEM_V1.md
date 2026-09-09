# Mobile Design System v1 — foundation

Base: `cc4a40e` (`origin/main`, fetched 2026-09-09). Work is isolated in
`codex/mobile-design-system-v1`; the older checkout's uncommitted player work is preserved.

## Read-only findings and ownership

| Surface | Current owner / contract |
| --- | --- |
| Persistent shell | `index.html`: header, dialogs, mini/fullscreen players, navigation container survive view changes. `js/mobile.js` sets `html.mobile-device` from coarse pointer and width <=932. |
| Navigation | `js/mobile-shell.js` renders five `data-mobile-tab` buttons; Auth subscription exposes Upload and Artist for artist/admin. `data-active-mobile-tab`, `.is-active`, `aria-current`, and `[hidden]` remain unchanged. |
| Home | `#catalog-view`: `#new`, `#recommendations`, `#all-tracks`. `home-discovery.js` places recommendations before All, refreshes recommendations and removes carousel clones. |
| Cards | `js/render.js` creates `.release-card`, `.cover-wrap`, `.release-info`, artist links and `data-track-id`. Shared by Search/Artist; player synchronizes current/playing classes. |
| Search | `js/search.js`, `.mobile-search-active`, `.search-wrap`, `#search-results`; catalog filtering with 180 ms debounce. |
| Profile | `#account-profile`, settings route; guest opens login. |
| Artist | `#artist-profile`, artist route; owner and public actions remain under existing navigation/auth owners. |
| Mini-player | Persistent `.mini-player`, `.active`, existing controls and gesture boundary; `js/player.js` unchanged. |
| Delivery | Worker `versionNavigationHtml()` injects styles and module entry points beyond `js/script.js`. `mobile-shell.js` also appends six styles. Raw first-load HTML and worker-composed HTML differ in the baseline. |

Read `index.html`, the relevant rules throughout `style.css`, `mobile-navigation.css`,
`mobile-polish.css`, `mobile-polish-final.css`, `player-mobile-polish.css`,
`artist-mobile-list.css`, `js/mobile-shell.js`, `js/render.js`, `js/search.js`,
`js/app-navigation.js`, `home-discovery.*`, recommendation hotfix, CODEMAP and the
mobile/player audit documents. Current code supersedes the historical audits.

Conflicts: navigation heights 62/72/66px, mini-player 64/62px with a 48px inner row,
Home heading sizes from 24 to 40px, accumulated section margin/padding, recommendation
card geometry in several stylesheets plus inline `!important`, and 760/768/932 breakpoints.

## Component ownership after this slice

- `mobile-navigation.css`: mobile-only `--m-*` tokens, body/header shell, navigation,
  mini-player exterior. Scope is `@media (max-width:932px)` + `html.mobile-device`.
- `home-discovery.css`: Home-specific layout, heading/card rhythm, recommendation rows.
  Existing desktop rules remain byte-for-byte unchanged.
- `mobile-polish.css` and `mobile-polish-final.css`: retain other screens and shared
  legacy card rules; Home/chrome-specific duplicate rules removed.
- `style.css`: retained behavior/visibility/player foundations; removed the superseded
  mobile three-column navigation component block only.

Tokens cover background/raised background, surface/elevated surface, three text levels,
border/accent, 4/8/12/16/24/32 spacing, 20px side padding, 10/16/24 radii, 10px artwork,
44px minimum and 48px standard controls, typography, motion, all four safe-area edges.
Navigation height is 64px; mini-player height is 64px; gap is 8px. Content clearance
derives from the same navigation/mini-player tokens. Desktop `:root` is unchanged.

No new stylesheet or product feature. The existing carousel, three recommendation rows,
and catalog grid are retained. Reference art informs density, surfaces and hierarchy;
no concept artwork or fake release is inserted into production.

## Removed overrides and retained compatibility

Removed Home/chrome rules from both polish files, the old navigation block in style.css,
and the runtime injection of `recommendations-hotfix-v93.css` from Home and worker HTML.
The hotfix is no longer precached in the new release. Its file remains in the repository
for previously deployed clients. Existing renderer inline styles remain unchanged to
avoid desktop differences; their elimination is a separate cross-platform cleanup.
Artist, Profile, Search, Upload, Admin and fullscreen-specific overrides stay in place.

## Verification

Local Playwright smoke uses the actual worker HTML composition, with service workers
blocked for deterministic visual comparisons. It injects historical real POJIDMUSIC
track metadata from `cf95112` into a test-only catalog, because the current guest catalog
request returns 401 and current production excludes local tracks. No backend mutation.

| Check | Result |
| --- | --- |
| 390x844, 430x932 Home | Pass; no horizontal page overflow before/after mini-player activation. |
| Mini-player and navigation | Pass; 64px each, 8px gap, aligned 20px side edges. |
| Search opening / Home return | Pass using existing event handlers. |
| Guest Profile | Pass; existing login dialog opens. |
| Listener/artist/admin layout | 3/5/5 button projections fit; every measured target >=44px. This is a layout projection, not authenticated role validation. |
| Standalone presentation | Pass in Chromium emulation, top 47px/bottom 34px safe area. Not a physical installed iOS PWA. |
| Desktop 1280x900 | Sampled Home geometry, padding, colors, type and radii match baseline within 0.1px; navigation remains hidden. Screenshots visually reviewed. |
| `tests/check-pwa-shell.py` | Pass: 47 module roots/closure entries, 71 critical resources, 7 pinned SDK resources, matching pwa-v98 marker. Checker now includes worker-injected entry points and checks file existence. |
| `tests/pwa-runtime.py` | Not passed: sandbox DevTools reset; with network access, timeout while waiting for release A activation. Upgrade/offline acceptance remains unverified. |

Run the visual harness with `PLAYWRIGHT_MODULE` pointing to an installed Playwright
package: `node tests/mobile-foundation-smoke.cjs <artifact-directory>`.
Use `BASELINE_REF=cc4a40e` for the prior revision comparison. The fixture is test-only.

## Existing risks outside scope — not silently fixed

1. `service-worker.js`, `handleShellAsset`: any `?v=` request tries the network before
   the release cache. An installed old shell can therefore obtain newer asset contents.
   Recommendation: a separate PWA delivery phase restoring immutable per-release assets
   and verifying old-client upgrade, one reload and mixed-version rejection.
2. `tracks.js` is empty; `js/catalog-state.js` explicitly filters out `source: local`.
   Historical CODEMAP's seven-track offline fallback no longer exists in this main.
   Offline shell acceptance must not require offline songs/catalog that production removed.
3. Guest remote catalog returned HTTP 401 during testing. No inference about deployed
   RLS/Auth correctness is made, and no backend changes were attempted.

## Handoff / deployment boundary

Candidate release marker: pwa-v98 (HTML and worker); no SDK change. No new queries,
persistence keys, audio instances, route state or cache mechanism. Only the redundant
recommendation CSS asset is removed from the new precache/composed HTML.

Live acceptance still requires authenticated artist/admin Artist navigation, signed-in
Profile, Upload visibility, physical iPhone/Telegram safe area, prior installed PWA
upgrade and offline shell startup. Given the unverified PWA upgrade path, the branch is
reviewable but must not be described as fully live-accepted.
