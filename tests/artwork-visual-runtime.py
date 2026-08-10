"""Capture desktop/mobile artwork regression screenshots in the system temp directory."""

from __future__ import annotations

import base64
import importlib.util
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


def wait_for_cards(client):
    deadline = time.time() + 30
    while time.time() < deadline:
        if client.evaluate("document.querySelectorAll('#new .release-card').length === 4"):
            time.sleep(1)
            return
        time.sleep(0.05)
    raise RuntimeError("Home artwork did not render")


def capture(client, path):
    result = client.call("Page.captureScreenshot", {
        "format": "png",
        "captureBeyondViewport": False,
        "fromSurface": True,
    })
    path.write_bytes(base64.b64decode(result["data"]))


def capture_viewport(server_port, width, height, mobile):
    debug_socket = socket.socket()
    debug_socket.bind(("127.0.0.1", 0))
    debug_port = debug_socket.getsockname()[1]
    debug_socket.close()
    label = "mobile" if mobile else "desktop"

    with tempfile.TemporaryDirectory(prefix="pojidmusic-artwork-visual-") as profile:
        process = subprocess.Popen([
            str(SUPPORT.CHROME), "--headless=new", "--disable-gpu", "--no-first-run",
            "--no-default-browser-check", "--autoplay-policy=no-user-gesture-required",
            f"--window-size={width},{height}", "--remote-allow-origins=*",
            f"--remote-debugging-port={debug_port}", f"--user-data-dir={profile}",
            "about:blank",
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            client = SUPPORT.DevToolsSocket(SUPPORT.wait_for_debugger(debug_port))
            client.call("Page.enable")
            client.call("Runtime.enable")
            if mobile:
                client.call("Emulation.setDeviceMetricsOverride", {
                    "width": width,
                    "height": height,
                    "deviceScaleFactor": 3,
                    "mobile": True,
                })
            client.call("Page.navigate", {
                "url": f"http://127.0.0.1:{server_port}/index.html?artwork-visual=1"
            })
            wait_for_cards(client)
            home_path = Path(tempfile.gettempdir()) / f"pojidmusic-artwork-{label}-home.png"
            capture(client, home_path)

            client.evaluate("document.querySelector('#new .release-card').click()")
            deadline = time.time() + 20
            while time.time() < deadline:
                if client.evaluate("document.querySelector('.mini-player.active') !== null"):
                    break
                time.sleep(0.05)
            client.evaluate("document.querySelector('.player-cover').click()")
            time.sleep(1)
            fullscreen_path = (
                Path(tempfile.gettempdir()) /
                f"pojidmusic-artwork-{label}-fullscreen.png"
            )
            capture(client, fullscreen_path)
            return home_path, fullscreen_path
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()


def main():
    server = SUPPORT.ThreadingHTTPServer(("127.0.0.1", 0), SUPPORT.QuietHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        paths = [
            *capture_viewport(server.server_port, 1440, 1000, False),
            *capture_viewport(server.server_port, 390, 844, True),
        ]
        print("\n".join(str(path) for path in paths))
    finally:
        server.shutdown()


if __name__ == "__main__":
    main()
