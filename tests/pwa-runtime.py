"""Exercise atomic POJIDMUSIC service-worker install, upgrade, and offline boot."""

from __future__ import annotations

import importlib.util
import json
import os
import socket
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[1]
SUPPORT_PATH = Path(__file__).with_name("top-level-runtime.py")
SPEC = importlib.util.spec_from_file_location("top_level_runtime", SUPPORT_PATH)
SUPPORT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SUPPORT)


class ReleaseHandler(SUPPORT.QuietHandler):
    release = "pwa-test-a"

    def do_GET(self):
        path = urlparse(self.path).path.lstrip("/") or "index.html"
        if self.release == "pwa-test-a" and path == "icons/favicon-16.png":
            self.send_error(503, "optional icon unavailable")
            return
        if self.release == "pwa-test-bad" and path == "style.css":
            self.send_error(503, "critical stylesheet unavailable")
            return
        if path not in {"service-worker.js", "index.html", "js/script.js", "style.css"}:
            super().do_GET()
            return

        source = (ROOT / path).read_text(encoding="utf-8")
        source = source.replace("pwa-v11", self.release)
        if path == "js/script.js":
            source += f'\nwindow.__pwaServedScriptRelease = "{self.release}";\n'
        elif path == "style.css":
            source += f'\n:root {{ --pwa-test-release: "{self.release}"; }}\n'

        body = source.encode("utf-8")
        content_type = {
            "service-worker.js": "text/javascript",
            "index.html": "text/html",
            "js/script.js": "text/javascript",
            "style.css": "text/css",
        }[path]
        self.send_response(200)
        self.send_header("Content-Type", f"{content_type}; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


class RecordingClient(SUPPORT.DevToolsSocket):
    def __init__(self, url):
        super().__init__(url)
        self.events = []

    def call(self, method: str, params: dict | None = None):
        self.next_id += 1
        message_id = self.next_id
        payload = json.dumps({"id": message_id, "method": method, "params": params or {}})
        self._send_frame(payload.encode())
        while True:
            response = self._receive()
            if "method" in response:
                self.events.append(response)
                continue
            if response.get("id") == message_id:
                if "error" in response:
                    raise RuntimeError(response["error"])
                return response.get("result", {})


LOAD_COUNTER = r"""
(() => {
    const count = Number(sessionStorage.getItem("pwa-test-load-count") || 0) + 1;
    sessionStorage.setItem("pwa-test-load-count", String(count));
})();
"""


PAGE_STATE = r"""
(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    const release = await new Promise((resolve) => {
        const worker = navigator.serviceWorker.controller;
        if (!worker) { resolve(null); return; }
        const channel = new MessageChannel();
        const timeout = setTimeout(() => resolve(null), 2000);
        channel.port1.onmessage = (event) => {
            clearTimeout(timeout);
            resolve(event.data?.releaseVersion || null);
        };
        worker.postMessage({ type: "GET_RELEASE_VERSION" }, [channel.port2]);
    });
    const cachesByName = {};
    for (const name of await caches.keys()) {
        cachesByName[name] = (await (await caches.open(name)).keys())
            .map((request) => request.url);
    }
    return {
        html: document.querySelector('meta[name="pojidmusic-release"]')?.content || null,
        script: window.__pwaServedScriptRelease || null,
        css: getComputedStyle(document.documentElement)
            .getPropertyValue("--pwa-test-release").replaceAll('"', "").trim(),
        controllerRelease: release,
        controller: navigator.serviceWorker.controller?.scriptURL || null,
        activeState: registration?.active?.state || null,
        waitingState: registration?.waiting?.state || null,
        installingState: registration?.installing?.state || null,
        loadCount: Number(sessionStorage.getItem("pwa-test-load-count") || 0),
        reloadGuard: sessionStorage.getItem("pojidmusic-sw-controller-release"),
        cards: document.querySelectorAll("#all-tracks .release-card").length,
        stylesheetLoaded: Boolean([...document.styleSheets].find((sheet) =>
            sheet.href?.includes("style.css"))),
        cacheNames: Object.keys(cachesByName),
        caches: cachesByName
    };
})()
"""


def wait_for(client, expression, label, timeout=30):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            if client.evaluate(expression):
                return
        except RuntimeError:
            pass
        time.sleep(0.05)
    raise AssertionError(f"Timeout: {label}")


def set_release(release):
    ReleaseHandler.release = release


def assert_release(state, release):
    assert state["html"] == release, state
    assert state["script"] == release, state
    assert state["css"] == release, state
    assert state["controllerRelease"] == release, state


def same_origin_module_failures(events, origin):
    requests = {}
    failures = []
    for event in events:
        params = event.get("params", {})
        if event.get("method") == "Network.requestWillBeSent":
            requests[params.get("requestId")] = params.get("request", {}).get("url", "")
        elif event.get("method") == "Network.loadingFailed":
            url = requests.get(params.get("requestId"), "")
            if url.startswith(origin) and urlparse(url).path.endswith(".js"):
                failures.append({"url": url, "error": params.get("errorText")})
    return failures


def main():
    os.chdir(ROOT)
    server = SUPPORT.ThreadingHTTPServer(("127.0.0.1", 0), ReleaseHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    debug_socket = socket.socket()
    debug_socket.bind(("127.0.0.1", 0))
    debug_port = debug_socket.getsockname()[1]
    debug_socket.close()
    origin = f"http://127.0.0.1:{server.server_port}"

    with tempfile.TemporaryDirectory(prefix="pojidmusic-pwa-runtime-") as profile:
        process = subprocess.Popen([
            str(SUPPORT.CHROME), "--headless=new", "--disable-gpu", "--no-first-run",
            "--no-default-browser-check", "--remote-allow-origins=*",
            f"--remote-debugging-port={debug_port}", f"--user-data-dir={profile}",
            "about:blank",
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            client = RecordingClient(SUPPORT.wait_for_debugger(debug_port))
            client.call("Page.enable")
            client.call("Runtime.enable")
            client.call("Network.enable")
            client.call("Page.addScriptToEvaluateOnNewDocument", {"source": LOAD_COUNTER})

            set_release("pwa-test-a")
            client.call("Page.navigate", {"url": f"{origin}/index.html?pwa-runtime=1"})
            wait_for(client,
                "document.querySelector('meta[name=pojidmusic-release]')?.content === 'pwa-test-a' && "
                "window.__pwaServedScriptRelease === 'pwa-test-a' && "
                "navigator.serviceWorker.controller !== null",
                "release A activation")
            wait_for(client,
                "document.querySelectorAll('#all-tracks .release-card').length > 0",
                "release A usable UI")
            release_a = client.evaluate(PAGE_STATE)
            assert_release(release_a, "pwa-test-a")
            assert "pojidmusic-shell-pwa-test-a" in release_a["cacheNames"]
            assert "pojidmusic-sdk-supabase-2.112.2" in release_a["cacheNames"]
            assert not any(url.endswith("favicon-16.png") for url in
                release_a["caches"]["pojidmusic-shell-pwa-test-a"])
            initial_load_count = release_a["loadCount"]

            set_release("pwa-test-bad")
            client.evaluate("navigator.serviceWorker.getRegistration().then((r) => r.update()).catch(() => null)")
            time.sleep(3)
            after_failed_install = client.evaluate(PAGE_STATE)
            assert_release(after_failed_install, "pwa-test-a")
            assert after_failed_install["loadCount"] == initial_load_count

            set_release("pwa-v11")
            client.evaluate("navigator.serviceWorker.getRegistration().then((r) => r.update())")
            wait_for(client,
                "document.querySelector('meta[name=pojidmusic-release]')?.content === 'pwa-v11' && "
                "window.__pwaServedScriptRelease === 'pwa-v11'",
                "release B controller reload", timeout=40)
            wait_for(client,
                "document.querySelectorAll('#all-tracks .release-card').length > 0",
                "release B usable UI")
            release_b = client.evaluate(PAGE_STATE)
            assert_release(release_b, "pwa-v11")
            assert release_b["loadCount"] == initial_load_count + 1, release_b
            assert release_b["reloadGuard"] == "pwa-v11", release_b
            assert "pojidmusic-shell-pwa-v11" in release_b["cacheNames"]
            assert "pojidmusic-shell-pwa-test-a" not in release_b["cacheNames"]
            assert "pojidmusic-shell-pwa-test-bad" not in release_b["cacheNames"]
            assert len(release_b["cacheNames"]) == 2, release_b["cacheNames"]
            cached_urls = [
                url for urls in release_b["caches"].values()
                for url in urls
            ]
            assert not any("/music/" in url for url in cached_urls)
            assert not any("supabase.co/storage/" in url for url in cached_urls)
            assert not any("supabase.co/rest/" in url for url in cached_urls)

            client.events = []
            before_offline_load_count = release_b["loadCount"]
            client.call("Network.emulateNetworkConditions", {
                "offline": True,
                "latency": 0,
                "downloadThroughput": 0,
                "uploadThroughput": 0
            })
            client.call("Page.reload", {"ignoreCache": True})
            wait_for(client,
                "document.querySelector('meta[name=pojidmusic-release]')?.content === 'pwa-v11' && "
                "window.__pwaServedScriptRelease === 'pwa-v11'",
                "offline shell")
            wait_for(client,
                "document.querySelectorAll('#all-tracks .release-card').length > 0",
                "offline local catalog", timeout=30)
            offline = client.evaluate(PAGE_STATE)
            assert_release(offline, "pwa-v11")
            assert offline["stylesheetLoaded"]
            assert offline["loadCount"] == before_offline_load_count + 1
            module_failures = same_origin_module_failures(client.events, origin)
            assert not module_failures, module_failures

            client.call("Emulation.setDeviceMetricsOverride", {
                "width": 390,
                "height": 844,
                "deviceScaleFactor": 3,
                "mobile": True
            })
            client.call("Emulation.setTouchEmulationEnabled", {
                "enabled": True,
                "maxTouchPoints": 5
            })
            client.call("Emulation.setEmulatedMedia", {
                "media": "",
                "features": [{"name": "display-mode", "value": "standalone"}]
            })
            client.call("Page.reload", {"ignoreCache": True})
            wait_for(client,
                "document.documentElement.classList.contains('mobile-device') && "
                "document.querySelectorAll('#all-tracks .release-card').length > 0",
                "mobile offline shell", timeout=30)
            mobile_standalone = client.evaluate(r"""
({
    width: innerWidth,
    height: innerHeight,
    dpr: devicePixelRatio,
    mobile: document.documentElement.classList.contains("mobile-device"),
    standalone: document.documentElement.classList.contains("standalone-mode"),
    cards: document.querySelectorAll("#all-tracks .release-card").length,
    release: document.querySelector('meta[name="pojidmusic-release"]')?.content
})
""")

            print(json.dumps({
                "initialInstall": {
                    "release": release_a["controllerRelease"],
                    "loadCount": initial_load_count,
                    "cacheNames": release_a["cacheNames"],
                    "optionalFailureDidNotBlock": True
                },
                "criticalInstallFailure": {
                    "controllerStayed": after_failed_install["controllerRelease"],
                    "reloadCountDelta": after_failed_install["loadCount"] - initial_load_count
                },
                "upgrade": {
                    "release": release_b["controllerRelease"],
                    "reloadCountDelta": release_b["loadCount"] - initial_load_count,
                    "cacheNames": release_b["cacheNames"],
                    "oldCachesRemoved": True,
                    "mixedVersion": False
                },
                "offline": {
                    "release": offline["controllerRelease"],
                    "cards": offline["cards"],
                    "stylesheetLoaded": offline["stylesheetLoaded"],
                    "sameOriginModuleFailures": module_failures
                },
                "mobileStandaloneEmulation": mobile_standalone
            }, ensure_ascii=False, indent=2))
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
            server.shutdown()


if __name__ == "__main__":
    main()
