"""Run POJIDMUSIC browser test pages in headless Chrome."""

from __future__ import annotations

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
TEST_PAGES = [
    "data-cache.test.html",
    "artwork.test.html",
    "audio-url-resolver.test.html",
    "queue-decisions.test.html",
    "player-persistence.test.html",
    "playback-context.test.html",
    "media-session.test.html",
    "mobile-player-ux.test.html",
    "player-runtime.test.html",
]


def main():
    server = SUPPORT.ThreadingHTTPServer(("127.0.0.1", 0), SUPPORT.QuietHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    debug_socket = socket.socket()
    debug_socket.bind(("127.0.0.1", 0))
    debug_port = debug_socket.getsockname()[1]
    debug_socket.close()
    base_url = f"http://127.0.0.1:{server.server_port}/tests"

    with tempfile.TemporaryDirectory(prefix="pojidmusic-browser-tests-") as profile:
        process = subprocess.Popen([
            str(SUPPORT.CHROME),
            "--headless=new",
            "--disable-gpu",
            "--no-first-run",
            "--no-default-browser-check",
            "--autoplay-policy=no-user-gesture-required",
            "--remote-allow-origins=*",
            f"--remote-debugging-port={debug_port}",
            f"--user-data-dir={profile}",
            "about:blank",
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            client = SUPPORT.DevToolsSocket(SUPPORT.wait_for_debugger(debug_port))
            client.call("Page.enable")
            client.call("Runtime.enable")
            failed = False
            for page in TEST_PAGES:
                client.call("Page.navigate", {"url": f"{base_url}/{page}"})
                deadline = time.time() + 30
                status = "running"
                while time.time() < deadline:
                    status = client.evaluate("document.body?.dataset.testStatus || 'loading'")
                    if status in {"passed", "failed"}:
                        break
                    time.sleep(0.05)
                output = client.evaluate("document.querySelector('#test-output')?.textContent || ''")
                print(f"{page}: {status}\n{output}")
                failed = failed or status != "passed"
            if failed:
                raise SystemExit(1)
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
            server.shutdown()


if __name__ == "__main__":
    main()
