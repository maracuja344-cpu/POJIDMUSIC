"""Capture the Mobile Player UX Polish surfaces at the target phone viewport."""

from __future__ import annotations

import base64
import importlib.util
import json
import socket
import subprocess
import tempfile
import threading
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SUPPORT_PATH = Path(__file__).with_name("top-level-runtime.py")
SPEC = importlib.util.spec_from_file_location("top_level_runtime", SUPPORT_PATH)
SUPPORT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SUPPORT)


def wait_for(client, expression, message, timeout=30):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if client.evaluate(expression):
            time.sleep(0.25)
            return
        time.sleep(0.05)
    raise RuntimeError(message)


def capture(client, path):
    result = client.call("Page.captureScreenshot", {
        "format": "png",
        "captureBeyondViewport": False,
        "fromSurface": True,
    })
    path.write_bytes(base64.b64decode(result["data"]))


def main():
    output_dir = ROOT / "tests" / "screenshots" / "mobile-player-ux"
    output_dir.mkdir(parents=True, exist_ok=True)
    server = SUPPORT.ThreadingHTTPServer(("127.0.0.1", 0), SUPPORT.QuietHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    debug_socket = socket.socket()
    debug_socket.bind(("127.0.0.1", 0))
    debug_port = debug_socket.getsockname()[1]
    debug_socket.close()

    with tempfile.TemporaryDirectory(prefix="pojidmusic-mobile-ux-") as profile:
        process = subprocess.Popen([
            str(SUPPORT.CHROME), "--headless=new", "--disable-gpu", "--no-first-run",
            "--no-default-browser-check", "--autoplay-policy=no-user-gesture-required",
            "--window-size=390,844", "--remote-allow-origins=*",
            f"--remote-debugging-port={debug_port}", f"--user-data-dir={profile}",
            "about:blank",
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            client = SUPPORT.DevToolsSocket(SUPPORT.wait_for_debugger(debug_port))
            client.call("Page.enable")
            client.call("Runtime.enable")
            client.call("Emulation.setDeviceMetricsOverride", {
                "width": 390,
                "height": 844,
                "deviceScaleFactor": 1,
                "mobile": True,
            })
            client.call("Emulation.setTouchEmulationEnabled", {
                "enabled": True,
                "maxTouchPoints": 5,
            })
            client.call("Page.navigate", {
                "url": (
                    f"http://127.0.0.1:{server.server_port}/"
                    "index.html?mobile-player-visual=1"
                )
            })
            wait_for(
                client,
                "document.querySelectorAll('#new .release-card').length >= 4",
                "Home cards did not render",
            )
            wait_for(
                client,
                "[...document.querySelectorAll('#new .release-card img')]"
                ".slice(0, 4).every((image) => image.complete && image.naturalWidth)",
                "Home artwork did not finish loading",
            )
            client.evaluate("document.documentElement.classList.add('mobile-device')")
            capture(client, output_dir / "home-390x844.png")

            collaboration_menu = client.evaluate("""
                (() => {
                    const card = [...document.querySelectorAll(
                        '#catalog-view .release-card'
                    )]
                        .find((candidate) => candidate.querySelectorAll(
                            '.artist-name [data-artist-slug]'
                        ).length > 1);
                    if (!card) throw new Error('Collaboration card not found');

                    document.documentElement.style.scrollBehavior = 'auto';
                    window.scrollTo(0, Math.max(
                        0,
                        card.getBoundingClientRect().top + scrollY - 260
                    ));
                    card.querySelector('.artist-action-menu-toggle').click();
                    card.querySelector('.artist-action-menu-primary').click();

                    const menu = card.querySelector('.artist-action-menu-popover');
                    const bounds = menu.getBoundingClientRect();
                    return {
                        title: card.querySelector('.track-title').textContent.trim(),
                        label: menu.querySelector(
                            '.artist-action-menu-selector-label'
                        ).textContent.trim(),
                        artists: [...menu.querySelectorAll(
                            '.artist-action-menu-selector-item'
                        )].map((item) => item.textContent.trim()),
                        open: card.querySelector('.artist-action-menu')
                            .classList.contains('is-open'),
                        bounds: {
                            top: bounds.top,
                            right: bounds.right,
                            bottom: bounds.bottom,
                            left: bounds.left
                        },
                        withinViewport: bounds.left >= 0
                            && bounds.right <= innerWidth
                            && bounds.top >= 0
                            && bounds.bottom <= innerHeight
                    };
                })()
            """)
            assert collaboration_menu["label"] == "Выберите артиста:", collaboration_menu
            assert len(collaboration_menu["artists"]) > 1, collaboration_menu
            assert collaboration_menu["open"], collaboration_menu
            assert collaboration_menu["withinViewport"], collaboration_menu
            capture(client, output_dir / "collaboration-selector-390x844.png")
            client.evaluate(
                "document.dispatchEvent(new KeyboardEvent('keydown', "
                "{key:'Escape', bubbles:true, cancelable:true}));"
                "document.querySelector('#new').scrollIntoView({block:'start'});"
                "document.querySelector('#new .tracks-row').scrollLeft = 0;"
            )

            client.evaluate(
                "document.querySelector('#new .artist-action-menu-toggle').click()"
            )
            capture(client, output_dir / "home-menu-390x844.png")
            client.evaluate(
                "document.querySelector('#new .artist-action-menu-toggle').click()"
            )

            client.evaluate("document.querySelector('#new .release-card').click()")
            wait_for(
                client,
                "document.querySelector('.mini-player.active') !== null",
                "Mini-player did not activate",
            )
            mini_geometry = client.evaluate("""
                (() => {
                    const rect = (selector) => {
                        const value = document.querySelector(selector)
                            .getBoundingClientRect();
                        return {
                            top: value.top,
                            bottom: value.bottom,
                            height: value.height,
                            center: value.top + value.height / 2
                        };
                    };
                    return {
                        cover: rect('.mini-player .player-cover'),
                        info: rect('.mini-player .player-info'),
                        title: rect('.mini-player .player-title'),
                        artist: rect('.mini-player .player-artist')
                    };
                })()
            """)
            assert abs(
                mini_geometry["cover"]["center"] - mini_geometry["info"]["center"]
            ) <= 1, mini_geometry
            assert mini_geometry["artist"]["top"] >= mini_geometry["title"]["bottom"], mini_geometry
            capture(client, output_dir / "mini-player-390x844.png")

            client.evaluate("document.querySelector('.mini-player').click()")
            wait_for(
                client,
                "document.querySelector('.fullscreen-player.open') !== null",
                "Fullscreen did not open",
            )
            wait_for(
                client,
                "document.querySelector('.fullscreen-duration-time')?.textContent.trim() !== '0:00'",
                "Fullscreen duration did not load",
            )
            wait_for(
                client,
                "!document.querySelector('.fullscreen-player-artist-identity').hidden",
                "Fullscreen artist panel did not render",
            )
            fullscreen_geometry = client.evaluate("""
                (() => {
                    const rect = (selector) => {
                        const value = document.querySelector(selector)
                            .getBoundingClientRect();
                        return {
                            top: value.top,
                            right: value.right,
                            bottom: value.bottom,
                            left: value.left,
                            width: value.width,
                            height: value.height
                        };
                    };
                    const controls = rect('.fullscreen-player-controls');
                    const panel = rect('.fullscreen-player-artist-identity');
                    return {
                        controls,
                        panel,
                        gap: panel.top - controls.bottom,
                        viewport: [innerWidth, innerHeight]
                    };
                })()
            """)
            assert fullscreen_geometry["gap"] >= 12, fullscreen_geometry
            assert fullscreen_geometry["panel"]["height"] >= 56, fullscreen_geometry
            assert fullscreen_geometry["panel"]["bottom"] <= 844 - 8, fullscreen_geometry
            capture(client, output_dir / "fullscreen-390x844.png")

            client.evaluate(
                "document.dispatchEvent(new KeyboardEvent('keydown', "
                "{key:'Escape', bubbles:true, cancelable:true}))"
            )
            wait_for(
                client,
                "document.querySelector('.fullscreen-player.open') === null",
                "Fullscreen did not close",
            )

            duration_before_reload = client.evaluate(
                "document.querySelector('.duration-time')?.textContent.trim()"
            )
            client.call("Page.reload", {"ignoreCache": True})
            wait_for(
                client,
                "document.querySelector('.mini-player.active') !== null",
                "Persisted mini-player did not restore",
            )
            wait_for(
                client,
                "document.querySelector('.duration-time')?.textContent.trim() !== '0:00'",
                "Persisted duration did not restore",
            )
            restored_duration = client.evaluate(
                "document.querySelector('.duration-time')?.textContent.trim()"
            )
            capture(client, output_dir / "restored-mini-player-390x844.png")

            client.evaluate(
                "document.querySelector('#new .artist-action-menu-toggle').click();"
                "document.querySelector('#new [role=menuitem]').click()"
            )
            wait_for(
                client,
                "document.querySelector('#artist-profile:not([hidden])') !== null",
                "Artist Profile did not open",
            )
            artist_profile_state = client.evaluate("""
                (() => ({
                    cards: document.querySelectorAll(
                        '#artist-profile [data-artist-tracks] .release-card'
                    ).length,
                    artistActions: document.querySelectorAll(
                        '#artist-profile .artist-action-menu'
                    ).length
                }))()
            """)
            assert artist_profile_state["cards"] > 0, artist_profile_state
            assert artist_profile_state["artistActions"] == 0, artist_profile_state
            capture(client, output_dir / "artist-profile-390x844.png")

            client.evaluate("document.querySelector('.logo').click()")
            wait_for(
                client,
                "document.querySelector('#catalog-view:not([hidden])') !== null",
                "Home did not reopen",
            )
            client.evaluate("""
                const input = document.querySelector('.search-input');
                input.value = 'Hola';
                input.dispatchEvent(new Event('input', { bubbles: true }));
            """)
            wait_for(
                client,
                "document.querySelector('#search-results .release-card') !== null",
                "Search result did not render",
            )
            capture(client, output_dir / "search-390x844.png")

            metrics = client.evaluate("""
                (() => {
                    const card = document.querySelector('#search-results .release-card');
                    const mini = document.querySelector('.mini-player');
                    const rect = (element) => element ? {
                        width: element.getBoundingClientRect().width,
                        height: element.getBoundingClientRect().height
                    } : null;
                    return {
                        viewport: [innerWidth, innerHeight],
                        mobileClass: document.documentElement.classList.contains('mobile-device'),
                        mini: rect(mini),
                        searchCard: rect(card),
                        visibleMiniButtons: [...mini.querySelectorAll('button')]
                            .filter((button) => button.getClientRects().length > 0)
                            .map((button) => button.getAttribute('aria-label'))
                    };
                })()
            """)
            metrics["durationBeforeReload"] = duration_before_reload
            metrics["restoredDuration"] = restored_duration
            metrics["miniGeometry"] = mini_geometry
            metrics["fullscreenGeometry"] = fullscreen_geometry
            metrics["artistProfile"] = artist_profile_state
            metrics["collaborationMenu"] = collaboration_menu
            (output_dir / "metrics.json").write_text(
                json.dumps(metrics, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            print(output_dir)
            print(json.dumps(metrics, ensure_ascii=False, indent=2))
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
            server.shutdown()


if __name__ == "__main__":
    main()
