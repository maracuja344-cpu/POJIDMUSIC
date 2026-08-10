"""Capture the current POJIDMUSIC service-worker and offline baseline."""

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


ROOT = Path(__file__).resolve().parents[1]
SUPPORT_PATH = Path(__file__).with_name("top-level-runtime.py")
SPEC = importlib.util.spec_from_file_location("top_level_runtime", SUPPORT_PATH)
SUPPORT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SUPPORT)


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


STATE_SCRIPT = r"""
(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    const keys = await caches.keys();
    const cachesByName = {};
    for (const key of keys) {
        cachesByName[key] = (await (await caches.open(key)).keys()).map((request) => request.url);
    }
    const resources = performance.getEntriesByType("resource").map((entry) => ({
        url: entry.name,
        initiator: entry.initiatorType,
        transfer: entry.transferSize,
        encoded: entry.encodedBodySize
    }));
    return {
        controller: navigator.serviceWorker.controller?.scriptURL || null,
        registration: registration ? {
            scope: registration.scope,
            active: registration.active?.state || null,
            waiting: registration.waiting?.state || null,
            installing: registration.installing?.state || null
        } : null,
        caches: cachesByName,
        cards: document.querySelectorAll("#all-tracks .release-card").length,
        stylesheetLoaded: Boolean([...document.styleSheets].find((sheet) =>
            sheet.href?.includes("style.css"))),
        resources
    };
})()
"""


def wait_for(client, expression, timeout=20):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if client.evaluate(expression):
            return
        time.sleep(0.05)
    raise RuntimeError(f"Timed out: {expression}")


def failed_requests(events):
    requests = {}
    failures = []
    for event in events:
        method = event.get("method")
        params = event.get("params", {})
        if method == "Network.requestWillBeSent":
            requests[params.get("requestId")] = params.get("request", {}).get("url")
        elif method == "Network.loadingFailed":
            failures.append({
                "url": requests.get(params.get("requestId")),
                "error": params.get("errorText"),
                "blocked": params.get("blockedReason")
            })
    return failures


def main():
    os.chdir(ROOT)
    server = SUPPORT.ThreadingHTTPServer(("127.0.0.1", 0), SUPPORT.QuietHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    debug_socket = socket.socket()
    debug_socket.bind(("127.0.0.1", 0))
    debug_port = debug_socket.getsockname()[1]
    debug_socket.close()
    app_url = f"http://127.0.0.1:{server.server_port}/index.html?pwa-baseline=1"

    with tempfile.TemporaryDirectory(prefix="pojidmusic-pwa-baseline-") as profile:
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
            client.call("Page.navigate", {"url": app_url})
            wait_for(client, "document.readyState === 'complete'")
            wait_for(client, "navigator.serviceWorker.getRegistration().then(Boolean)")
            wait_for(client, "navigator.serviceWorker.controller !== null")
            first_load = client.evaluate(STATE_SCRIPT)

            client.events = []
            client.evaluate("performance.clearResourceTimings()")
            client.call("Page.reload", {"ignoreCache": False})
            wait_for(client, "document.readyState === 'complete'")
            wait_for(client, "document.querySelectorAll('#all-tracks .release-card').length > 0")
            controlled = client.evaluate(STATE_SCRIPT)
            controlled_failures = failed_requests(client.events)

            client.events = []
            client.call("Network.emulateNetworkConditions", {
                "offline": True,
                "latency": 0,
                "downloadThroughput": 0,
                "uploadThroughput": 0
            })
            client.call("Page.reload", {"ignoreCache": True})
            time.sleep(5)
            offline = client.evaluate(STATE_SCRIPT)
            offline_failures = failed_requests(client.events)

            print(json.dumps({
                "firstLoad": first_load,
                "controlledReload": controlled,
                "controlledFailures": controlled_failures,
                "offlineReload": offline,
                "offlineFailures": offline_failures,
                "standaloneInstalled": "not reproducible in headless Chromium"
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
