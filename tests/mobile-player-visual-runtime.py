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
