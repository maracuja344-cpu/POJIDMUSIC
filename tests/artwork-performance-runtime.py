"""Measure artwork requests, bytes, intrinsic sizes, and rendered usage."""

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


class RecordingDevToolsSocket(SUPPORT.DevToolsSocket):
    def __init__(self, websocket_url):
        super().__init__(websocket_url)
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

    def take_events(self):
        self.call("Runtime.evaluate", {"expression": "0", "returnByValue": True})
        events, self.events = self.events, []
        return events


INVENTORY_SCRIPT = r"""
(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const waitStarted = performance.now();
    while ([...document.images].some((image) => image.src && !image.complete) &&
        performance.now() - waitStarted < 20000) await sleep(50);
    await sleep(500);

    const classify = (element) => {
        if (element.matches(".recommendation-cover")) return "recommendation-cover";
        if (element.matches(".release-card .cover")) return "track-cover";
        if (element.matches(".player-cover")) return "mini-player-cover";
        if (element.matches(".fullscreen-player-cover, .fullscreen-player-cover-next")) {
            return "fullscreen-cover";
        }
        if (element.matches("[data-artist-avatar]")) return "artist-avatar";
        if (element.matches("[data-artist-banner]")) return "artist-banner";
        if (element.matches("[data-account-avatar]")) return "account-avatar";
        return "other-image";
    };
    const backgroundUrl = (element) => {
        const value = getComputedStyle(element).backgroundImage;
        const match = value.match(/^url\(["']?(.*?)["']?\)$/);
        return match?.[1] || "";
    };
    const absolute = (url) => {
        if (!url) return "";
        try { return new URL(url, location.href).href; } catch { return ""; }
    };
    const usages = [];
    document.querySelectorAll("img").forEach((element) => {
        const rect = element.getBoundingClientRect();
        const url = absolute(element.currentSrc || element.src);
        if (!url) return;
        usages.push({
            type: classify(element),
            url,
            tag: "img",
            renderedWidth: Math.round(rect.width * 10) / 10,
            renderedHeight: Math.round(rect.height * 10) / 10,
            naturalWidth: element.naturalWidth,
            naturalHeight: element.naturalHeight,
            inViewport: rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth,
            loading: element.loading || "auto",
            decoding: element.decoding || "auto",
            fetchPriority: element.fetchPriority || "auto"
        });
    });
    document.querySelectorAll("[data-artist-avatar], [data-artist-banner], [data-account-avatar]")
        .forEach((element) => {
            const url = absolute(backgroundUrl(element));
            if (!url) return;
            const rect = element.getBoundingClientRect();
            usages.push({
                type: classify(element),
                url,
                tag: "background",
                renderedWidth: Math.round(rect.width * 10) / 10,
                renderedHeight: Math.round(rect.height * 10) / 10,
                naturalWidth: 0,
                naturalHeight: 0,
                inViewport: rect.bottom > 0 && rect.top < innerHeight,
                loading: "css",
                decoding: "css",
                fetchPriority: "auto"
            });
        });

    const assets = {};
    for (const url of new Set(usages.map((usage) => usage.url))) {
        const related = usages.filter((usage) => usage.url === url);
        let fileBytes = null;
        let width = Math.max(...related.map((usage) => usage.naturalWidth || 0));
        let height = Math.max(...related.map((usage) => usage.naturalHeight || 0));
        try {
            const response = await fetch(url);
            const blob = await response.blob();
            fileBytes = blob.size;
            if (!width || !height) {
                const bitmap = await createImageBitmap(blob);
                width = bitmap.width;
                height = bitmap.height;
                bitmap.close();
            }
        } catch {}
        assets[url] = {
            fileBytes,
            width,
            height,
            estimatedRgbaBytes: width && height ? width * height * 4 : null,
            usageCount: related.length,
            types: [...new Set(related.map((usage) => usage.type))],
            belowFoldUsages: related.filter((usage) => !usage.inViewport).length,
            maxRenderedWidth: Math.max(...related.map((usage) => usage.renderedWidth)),
            maxRenderedHeight: Math.max(...related.map((usage) => usage.renderedHeight))
        };
    }
    const lcpEntries = performance.getEntriesByType("largest-contentful-paint");
    const lcp = lcpEntries.at(-1);
    return {
        viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
        usages,
        assets,
        lcp: lcp ? {
            startTime: lcp.startTime,
            size: lcp.size,
            url: lcp.url || "",
            element: lcp.element?.className || lcp.element?.tagName || ""
        } : null
    };
})()
"""


def summarize_network(events):
    requests = {}
    for event in events:
        method = event.get("method")
        params = event.get("params", {})
        request_id = params.get("requestId")
        if method == "Network.requestWillBeSent" and params.get("type") == "Image":
            requests[request_id] = {
                "url": params.get("request", {}).get("url", ""),
                "encodedDataLength": 0,
                "status": None,
                "mimeType": "",
                "fromDiskCache": False,
                "fromServiceWorker": False,
            }
        elif method == "Network.responseReceived" and request_id in requests:
            response = params.get("response", {})
            requests[request_id].update({
                "status": response.get("status"),
                "mimeType": response.get("mimeType", ""),
                "fromDiskCache": response.get("fromDiskCache", False),
                "fromServiceWorker": response.get("fromServiceWorker", False),
            })
        elif method == "Network.loadingFinished" and request_id in requests:
            requests[request_id]["encodedDataLength"] = params.get("encodedDataLength", 0)
    values = list(requests.values())
    return {
        "requestCount": len(values),
        "transferredBytes": int(sum(item["encodedDataLength"] for item in values)),
        "diskCacheRequests": sum(bool(item["fromDiskCache"]) for item in values),
        "serviceWorkerRequests": sum(bool(item["fromServiceWorker"]) for item in values),
        "requests": values,
    }


def wait_for_app(client):
    return client.evaluate(r"""
(async () => {
    const started = performance.now();
    const module = await import("./js/script.js");
    while ((module.getIsCatalogRefreshing() ||
        document.querySelectorAll("#all-tracks .release-card").length < 2) &&
        performance.now() - started < 30000) {
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return document.querySelector("[data-artist-slug]")?.dataset.artistSlug || null;
})()
""")


def capture(client, name):
    inventory = client.evaluate(INVENTORY_SCRIPT)
    events = client.take_events()
    return name, {"network": summarize_network(events), **inventory}


def compact(results):
    compacted = {}
    for viewport, scenarios in results.items():
        compacted[viewport] = {}
        for name, scenario in scenarios.items():
            assets = scenario["assets"]
            by_type = {}
            for url, asset in assets.items():
                if not asset["width"] or not asset["height"]:
                    continue
                for image_type in asset["types"]:
                    item = by_type.setdefault(image_type, {
                        "uniqueAssets": 0,
                        "fileBytes": 0,
                        "estimatedRgbaBytes": 0,
                        "intrinsicWidths": [],
                        "intrinsicHeights": [],
                        "maxRenderedWidths": [],
                        "maxRenderedHeights": [],
                    })
                    item["uniqueAssets"] += 1
                    item["fileBytes"] += asset["fileBytes"] or 0
                    item["estimatedRgbaBytes"] += asset["estimatedRgbaBytes"] or 0
                    item["intrinsicWidths"].append(asset["width"])
                    item["intrinsicHeights"].append(asset["height"])
                    item["maxRenderedWidths"].append(asset["maxRenderedWidth"])
                    item["maxRenderedHeights"].append(asset["maxRenderedHeight"])
            for item in by_type.values():
                for field in (
                    "intrinsicWidths", "intrinsicHeights",
                    "maxRenderedWidths", "maxRenderedHeights"
                ):
                    values = item.pop(field)
                    item[field.removesuffix("s") + "Range"] = [min(values), max(values)]
            oversized = sorted((
                {
                    "url": url,
                    "types": asset["types"],
                    "fileBytes": asset["fileBytes"],
                    "width": asset["width"],
                    "height": asset["height"],
                    "maxRenderedWidth": asset["maxRenderedWidth"],
                    "maxRenderedHeight": asset["maxRenderedHeight"],
                    "usageCount": asset["usageCount"],
                    "belowFoldUsages": asset["belowFoldUsages"],
                }
                for url, asset in assets.items()
                if asset["width"] and asset["maxRenderedWidth"] and
                asset["width"] > asset["maxRenderedWidth"] * scenario["viewport"]["dpr"] * 1.5
            ), key=lambda item: item["fileBytes"] or 0, reverse=True)
            compacted[viewport][name] = {
                "viewport": scenario["viewport"],
                "network": {
                    key: value for key, value in scenario["network"].items()
                    if key != "requests"
                },
                "uniqueArtworkAssets": sum(
                    bool(asset["width"] and asset["height"]) for asset in assets.values()
                ),
                "uniqueArtworkFileBytes": sum(
                    asset["fileBytes"] or 0 for asset in assets.values()
                    if asset["width"] and asset["height"]
                ),
                "estimatedDecodedRgbaBytes": sum(
                    asset["estimatedRgbaBytes"] or 0 for asset in assets.values()
                    if asset["width"] and asset["height"]
                ),
                "usageCount": len(scenario["usages"]),
                "belowFoldUsages": sum(not usage["inViewport"] for usage in scenario["usages"]),
                "byType": by_type,
                "oversizedCount": len(oversized),
                "lcp": scenario["lcp"],
            }
    return compacted


def run_viewport(width, height, mobile=False):
    server = SUPPORT.ThreadingHTTPServer(("127.0.0.1", 0), SUPPORT.QuietHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    debug_socket = socket.socket()
    debug_socket.bind(("127.0.0.1", 0))
    debug_port = debug_socket.getsockname()[1]
    debug_socket.close()
    base_url = f"http://127.0.0.1:{server.server_port}"
    results = {}

    with tempfile.TemporaryDirectory(prefix="pojidmusic-artwork-") as profile:
        process = subprocess.Popen([
            str(SUPPORT.CHROME), "--headless=new", "--disable-gpu", "--no-first-run",
            "--no-default-browser-check", "--autoplay-policy=no-user-gesture-required",
            f"--window-size={width},{height}", "--remote-allow-origins=*",
            f"--remote-debugging-port={debug_port}", f"--user-data-dir={profile}",
            "about:blank",
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            client = RecordingDevToolsSocket(SUPPORT.wait_for_debugger(debug_port))
            client.call("Page.enable")
            client.call("Runtime.enable")
            client.call("Network.enable")
            client.call("Performance.enable")
            if mobile:
                client.call("Emulation.setDeviceMetricsOverride", {
                    "width": width, "height": height, "deviceScaleFactor": 3, "mobile": True
                })
                client.call("Emulation.setUserAgentOverride", {
                    "userAgent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36"
                })
            client.call("Page.navigate", {"url": f"{base_url}/index.html?artwork-runtime=1"})
            time.sleep(0.5)
            client.evaluate("""
(async () => {
    localStorage.clear();
    await Promise.all((await caches.keys()).map((key) => caches.delete(key)));
    await Promise.all((await navigator.serviceWorker.getRegistrations()).map((item) => item.unregister()));
})()
""")
            client.call("Network.clearBrowserCache")
            client.events = []
            client.call("Page.reload", {"ignoreCache": True})
            slug = wait_for_app(client)
            name, value = capture(client, "cold-home")
            results[name] = value

            client.events = []
            client.call("Page.reload", {"ignoreCache": False})
            slug = wait_for_app(client) or slug
            name, value = capture(client, "warm-home")
            results[name] = value

            client.events = []
            client.evaluate(f"""
(() => {{
    history.pushState({{}}, "", "?artist={slug}");
    window.dispatchEvent(new PopStateEvent("popstate"));
}})()
""")
            client.evaluate(r"""
(async () => {
    const started = performance.now();
    while (document.querySelector("#artist-profile")?.hidden && performance.now() - started < 20000) {
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
})()
""")
            name, value = capture(client, "artist-first")
            results[name] = value

            client.events = []
            client.evaluate("document.querySelector('[data-nav-home]').click()")
            client.evaluate(f"""
(() => {{
    history.pushState({{}}, "", "?artist={slug}");
    window.dispatchEvent(new PopStateEvent("popstate"));
}})()
""")
            client.evaluate(r"""
(async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
})()
""")
            name, value = capture(client, "artist-repeat")
            results[name] = value

            client.events = []
            client.evaluate(r"""
(() => {
    document.querySelector("[data-nav-home]").click();
    const input = document.querySelector(".search-input");
    input.value = document.querySelector("#all-tracks .track-title")?.textContent?.trim() || "Avario";
    input.dispatchEvent(new Event("input", { bubbles: true }));
})()
""")
            name, value = capture(client, "search")
            results[name] = value

            client.events = []
            client.evaluate(r"""
(async () => {
    const input = document.querySelector(".search-input");
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const card = document.querySelector("#all-tracks .release-card");
    card.click();
    const started = performance.now();
    while (!document.querySelector(".mini-player.active") && performance.now() - started < 20000) {
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
    document.querySelector(".player-cover").click();
    while (!document.querySelector(".fullscreen-player.open") && performance.now() - started < 20000) {
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
})()
""")
            name, value = capture(client, "fullscreen")
            results[name] = value
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
            server.shutdown()
    return results


def main():
    os.chdir(ROOT)
    results = {
        "desktop": run_viewport(1440, 1000),
        "mobile": run_viewport(390, 844, mobile=True),
    }
    print(json.dumps(compact(results), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
