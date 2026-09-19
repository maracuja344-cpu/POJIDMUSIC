# Telegram viewport check — pwa-v98

Scope: existing header, bottom navigation, mini-player, search keyboard and window
geometry. No redesign, playback changes, database changes or persisted state.

Confirmed before the change: the shell had no Telegram SDK initialization or
viewport/safe-area subscriptions; CSS used browser `env()` insets only. Narrow
Telegram Desktop windows were excluded from the mobile shell by pointer detection.

Changes: combine system and Telegram content insets; use current host/visual viewport
height; measure existing fixed panels to reserve scrolling space; temporarily hide
them for a software keyboard; retain panels when a desktop window is resized with
search focused. Fullscreen falls back to expanded mode on unsupported clients.
SDK source: https://telegram.org/js/telegram-web-app.js (vendored 2026-09-19).
API reference: https://core.telegram.org/bots/webapps.

## Automated evidence

- `python tests/check-pwa-shell.py`: passes, 48 module entries/dependencies,
  75 critical resources, matching pwa-v98 marker, unchanged pinned Supabase graph.
  The checker now includes existing worker-injected module entries; its previous
  single-entry assumption falsely reported four active modules as unused.
- `python tests/telegram-viewport-runtime.py`: real Chromium DOM/CSS fixture at
  390×844, 360×640, 500×720 with mouse and 1200×800 with mouse. Tests header safe
  position, gap between panels, bottom inset, last-list-item scroll clearance,
  keyboard hide/restore, host inset updates, fullscreen height, ordinary desktop,
  and native safe-area events through the vendored SDK. Remote application modules
  are deliberately excluded from this layout fixture.
- Full application `tests/pwa-runtime.py` did not complete: Chromium's evaluation
  timed out during initial release activation. Upgrade/offline success is therefore
  **not claimed**. A separate isolated worker trial also did not complete.
  The cause has not been established; no unrelated runtime logic was changed.

## Required live checks

1. Close and reopen the Mini App on iOS/Android: header below Telegram buttons,
   bottom navigation above the system indicator, mini-player above navigation.
2. Play a track and scroll Home, search and artist lists to their last row; the last
   row and its actions must scroll fully above the player.
3. Focus search, type, scroll results, dismiss/reopen the keyboard. Panels should
   hide only with the software keyboard and return after dismissal.
4. Rotate the phone; change Telegram Desktop window height/width with search
   focused. Check expanded and fullscreen modes, including older-client fallback.
5. Open/close the fullscreen music player. On a short window all controls must remain
   reachable by scrolling.
6. Verify the ordinary desktop site, installed PWA upgrade, then fully close and
   relaunch the installed app offline after online caching. Full offline application
   behavior remains unverified by this phase's automated run.
