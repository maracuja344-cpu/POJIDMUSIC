# POJIDMUSIC test harness

No package installation is required. From the repository root, start a local server:

```powershell
python -m http.server 8765 --bind 127.0.0.1
```

Then open:

```text
http://127.0.0.1:8765/tests/playback-context.test.html
http://127.0.0.1:8765/tests/artwork.test.html
http://127.0.0.1:8765/tests/queue-decisions.test.html
http://127.0.0.1:8765/tests/mobile-player-ux.test.html
http://127.0.0.1:8765/tests/player-runtime.test.html
```

The page reports each assertion and sets `data-test-status="passed"` on `<body>` when
all checks pass. The harness temporarily uses `pojidmusic-player-state` and restores
the previous value in `finally`.

Run all deterministic browser pages in headless Chrome with:

```powershell
python tests/browser-page-tests.py
```

Run the real top-level Audio/player regression, including fullscreen focus, keyboard,
control synchronization, repeated cycles, persistence/reload and all deterministic pages:

```powershell
python tests/top-level-runtime.py
```

Capture and measure the fullscreen desktop/mobile/safe-area matrix, including CDP touch
gesture checks, with:

```powershell
python tests/fullscreen-visual-runtime.py --label final
```

Capture Home, card menu, mini-player, fullscreen, Artist Profile and Search for the
mobile player UX at 390 x 844 with:

```powershell
python tests/mobile-player-visual-runtime.py
```

Capture and verify the mobile Artist Profile header at the target and narrow
viewports, including owner controls and exclusive popup behavior, with:

```powershell
python tests/artist-profile-mobile-runtime.py --width 390 --height 844
python tests/artist-profile-mobile-runtime.py --width 393 --height 852
python tests/artist-profile-mobile-runtime.py --width 360 --height 740
```

Verify the production PWA dependency manifest and release marker with:

```powershell
python tests/check-pwa-shell.py
```

Exercise clean install, optional/critical install failure, an atomic A-to-B update,
old-cache cleanup, the controller reload guard, and offline boot with:

```powershell
python tests/pwa-runtime.py
```

The queue page exercises the pure production decision module. The iframe runtime remains
the deterministic fallback; `top-level-runtime.py` exercises real local Audio and top-level
reload. Backend mutation, installed standalone PWA and physical iOS/OS media controls still
require `PLAYER_MANUAL_CHECKLIST.md`.
