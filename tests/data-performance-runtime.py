"""Measure POJIDMUSIC data requests in repeatable top-level Chrome scenarios."""

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


CAPTURE_FETCH = r"""
(() => {
    const nativeFetch = window.fetch.bind(window);
    window.__dataRequestLog = [];
    window.fetch = async (input, init) => {
        const request = input instanceof Request ? input : null;
        const entry = {
            url: String(request?.url || input),
            method: String(init?.method || request?.method || "GET").toUpperCase(),
            startMs: performance.now(),
            endMs: null,
            status: null,
            error: null
        };
        window.__dataRequestLog.push(entry);
        try {
            const response = await nativeFetch(input, init);
            entry.endMs = performance.now();
            entry.status = response.status;
            return response;
        } catch (error) {
            entry.endMs = performance.now();
            entry.error = error?.name || "Error";
            throw error;
        }
    };
})();
"""


CAPTURE_AUDIO_PLAY = r"""
(() => {
    const CapturedAudio = window.Audio;
    window.__audioPlayLog = [];
    function MeasuredAudio(...args) {
        const audio = new CapturedAudio(...args);
        const nativePlay = audio.play.bind(audio);
        audio.play = (...playArgs) => {
            window.__audioPlayLog.push({ atMs: performance.now(), src: audio.src });
            return nativePlay(...playArgs);
        };
        return audio;
    }
    MeasuredAudio.prototype = CapturedAudio.prototype;
    Object.setPrototypeOf(MeasuredAudio, CapturedAudio);
    window.Audio = MeasuredAudio;
})();
"""


def classify(url: str) -> str:
    if "/storage/v1/object/sign/" in url:
        return "signed-url"
    if "/storage/v1/" in url:
        return "storage"
    if "/rest/v1/" in url or "/rpc/" in url:
        return "supabase"
    if "/auth/v1/" in url:
        return "auth"
    return "other"


def summarize(entries):
    counts = {}
    for entry in entries:
        category = classify(entry["url"])
        counts[category] = counts.get(category, 0) + 1
    intervals = sorted(
        (entry["startMs"], entry["endMs"] or entry["startMs"])
        for entry in entries
    )
    overlap = any(
        intervals[index][0] < intervals[index - 1][1]
        for index in range(1, len(intervals))
    )
    paths = []
    for entry in entries:
        url = entry["url"].split("?", 1)[0]
        paths.append({
            "category": classify(entry["url"]),
            "method": entry["method"],
            "path": url,
            "startMs": round(entry["startMs"], 1),
            "durationMs": round((entry["endMs"] or entry["startMs"]) - entry["startMs"], 1),
            "status": entry["status"]
        })
    return {"requestCount": len(entries), "counts": counts, "overlap": overlap, "requests": paths}


def main():
    os.chdir(ROOT)
    server = SUPPORT.ThreadingHTTPServer(("127.0.0.1", 0), SUPPORT.QuietHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    debug_socket = socket.socket()
    debug_socket.bind(("127.0.0.1", 0))
    debug_port = debug_socket.getsockname()[1]
    debug_socket.close()
    base_url = f"http://127.0.0.1:{server.server_port}"

    with tempfile.TemporaryDirectory(prefix="pojidmusic-performance-") as profile:
        process = subprocess.Popen([
            str(SUPPORT.CHROME), "--headless=new", "--disable-gpu", "--no-first-run",
            "--no-default-browser-check", "--autoplay-policy=no-user-gesture-required",
            "--window-size=1440,1000",
            "--remote-allow-origins=*", f"--remote-debugging-port={debug_port}",
            f"--user-data-dir={profile}", "about:blank",
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            client = SUPPORT.DevToolsSocket(SUPPORT.wait_for_debugger(debug_port))
            client.call("Page.enable")
            client.call("Runtime.enable")
            client.call("Page.addScriptToEvaluateOnNewDocument", {"source": CAPTURE_FETCH})
            client.call("Page.addScriptToEvaluateOnNewDocument", {"source": SUPPORT.CAPTURE_AUDIO})
            client.call("Page.addScriptToEvaluateOnNewDocument", {"source": CAPTURE_AUDIO_PLAY})
            client.call("Page.navigate", {"url": f"{base_url}/index.html?performance-runtime=1"})
            time.sleep(0.5)
            client.evaluate("localStorage.clear(); caches.keys().then(keys => Promise.all(keys.map(key => caches.delete(key))))")
            client.call("Page.reload", {"ignoreCache": True})

            initial = client.evaluate(r"""
(async () => {
    const started = performance.now();
    const module = await import("./js/script.js");
    while ((module.getIsCatalogRefreshing() ||
        document.querySelectorAll("#all-tracks .release-card").length < 2) &&
        performance.now() - started < 30000) {
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return {
        usableMs: performance.now(),
        requestEnd: window.__dataRequestLog.length,
        slug: document.querySelector("[data-artist-slug]")?.dataset.artistSlug || null,
        title: document.querySelector("#all-tracks .track-title")?.textContent?.trim() || "Avario"
    };
})()
""")

            cursor = 0
            scenarios = {}

            def record(name, expression):
                nonlocal cursor
                result = client.evaluate(expression)
                entries = client.evaluate(
                    f"window.__dataRequestLog.slice({cursor}, {result['requestEnd']})"
                )
                cursor = result["requestEnd"]
                usable_ms = result.get("usableMs")
                scenarios[name] = {
                    "usableMs": round(usable_ms, 1) if usable_ms is not None else None,
                    **summarize(entries)
                }
                return result

            initial_entries = client.evaluate(f"window.__dataRequestLog.slice(0, {initial['requestEnd']})")
            cursor = initial["requestEnd"]
            scenarios["initial-home"] = {
                "usableMs": round(initial["usableMs"], 1),
                **summarize(initial_entries)
            }

            play_script = r"""
(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const card = [...document.querySelectorAll("#all-tracks .release-card")]
        .find((candidate) => candidate.dataset.trackId?.startsWith("supabase:"));
    if (!card) throw new Error("No Supabase track card available for playback measurement");
    const started = performance.now();
    const playStart = window.__audioPlayLog.length;
    card.click();
    while ((window.__audioPlayLog.length === playStart || window.__testAudio.paused) &&
        performance.now() - started < 20000) await sleep(20);
    return {
        usableMs: window.__audioPlayLog[playStart]?.atMs - started,
        requestEnd: window.__dataRequestLog.length,
        trackId: card.dataset.trackId
    };
})()
"""
            first_play = record("first-play", play_script)

            repeat_play_script = r"""
(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    document.querySelector(".player-toggle").click();
    while (!window.__testAudio.paused) await sleep(10);
    const started = performance.now();
    const playStart = window.__audioPlayLog.length;
    document.querySelector(".player-toggle").click();
    while ((window.__audioPlayLog.length === playStart || window.__testAudio.paused) &&
        performance.now() - started < 10000) await sleep(10);
    return { usableMs: window.__audioPlayLog[playStart]?.atMs - started,
        requestEnd: window.__dataRequestLog.length };
})()
"""
            record("repeat-play", repeat_play_script)

            prefetch_wait_script = r"""
(async () => {
    const started = performance.now();
    await new Promise((resolve) => setTimeout(resolve, 900));
    return { usableMs: performance.now() - started,
        requestEnd: window.__dataRequestLog.length };
})()
"""
            record("next-prefetch", prefetch_wait_script)

            next_script = r"""
(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const currentId = () => JSON.parse(
        localStorage.getItem("pojidmusic-player-state"))?.currentTrackId || null;
    const previousId = currentId();
    const started = performance.now();
    const playStart = window.__audioPlayLog.length;
    document.querySelector(".player-next").click();
    while ((window.__audioPlayLog.length === playStart ||
        currentId() === previousId) &&
        performance.now() - started < 20000) await sleep(20);
    return { usableMs: window.__audioPlayLog[playStart]?.atMs - started,
        requestEnd: window.__dataRequestLog.length };
})()
"""
            record("next", next_script)
            record("post-next-prefetch", prefetch_wait_script)
            slug = json.dumps(initial["slug"])

            artist_script = rf"""
(async () => {{
    const started = performance.now();
    history.pushState({{}}, "", `?artist=${{{slug}}}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
    while ((document.querySelector("#artist-profile")?.hidden ||
        document.title === "POJIDMUSIC" ||
        window.__dataRequestLog.some((entry) => entry.endMs === null)) &&
        performance.now() - started < 20000) {{
        await new Promise((resolve) => setTimeout(resolve, 25));
    }}
    await new Promise((resolve) => setTimeout(resolve, 100));
    return {{ usableMs: performance.now() - started,
        requestEnd: window.__dataRequestLog.length }};
}})()
"""
            record("artist-first-open", artist_script)

            home_script = r"""
(async () => {
    const started = performance.now();
    document.querySelector("[data-nav-home]").click();
    while (document.querySelector("#catalog-view")?.hidden && performance.now() - started < 10000) {
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return { usableMs: performance.now() - started,
        requestEnd: window.__dataRequestLog.length };
})()
"""
            record("artist-to-home", home_script)
            record("artist-second-open", artist_script)
            record("second-artist-to-home", home_script)

            title = json.dumps(initial["title"])
            search_script = rf"""
(async () => {{
    const started = performance.now();
    const input = document.querySelector(".search-input");
    input.value = {title};
    input.dispatchEvent(new Event("input", {{ bubbles: true }}));
    while (!document.querySelector("#search-results") ||
        document.querySelector("#search-results").hidden) {{
        await new Promise((resolve) => setTimeout(resolve, 10));
    }}
    return {{ usableMs: performance.now() - started,
        requestEnd: window.__dataRequestLog.length }};
}})()
"""
            record("search", search_script)
            search_return_script = r"""
(async () => {
    const started = performance.now();
    const input = document.querySelector(".search-input");
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 25));
    return { usableMs: performance.now() - started,
        requestEnd: window.__dataRequestLog.length };
})()
"""
            record("search-return", search_return_script)

            refresh_script = r"""
(async () => {
    const started = performance.now();
    const { refreshCatalog } = await import("./js/script.js");
    const result = await refreshCatalog({ force: true, source: "performance-runtime" });
    return { usableMs: performance.now() - started, result,
        requestEnd: window.__dataRequestLog.length };
})()
"""
            refresh = record("catalog-force-refresh", refresh_script)
            cache_stats = client.evaluate(r"""
(async () => {
    const repository = await import("./js/data-repository.js");
    const audioResolver = await import("./js/audio-url-resolver.js");
    const { supabase } = await import("./js/supabase/client.js");
    return {
        repository: repository.getDataRepositoryStats(),
        signedAudio: audioResolver.getSignedAudioCacheStats(),
        batchSigningAvailable:
            typeof supabase.storage.from("track-audio").createSignedUrls === "function"
    };
})()
""")

            remote_reload_setup = client.evaluate(r"""
(() => {
    const snapshot = JSON.parse(localStorage.getItem("pojidmusic-player-state"));
    const expectedId = snapshot?.currentTrackId;
    const audio = window.__testAudio;
    if (!expectedId?.startsWith("supabase:")) {
        throw new Error(`Expected remote current track, received ${expectedId}`);
    }
    if (Number.isFinite(audio.duration) && audio.duration > 2) audio.currentTime = 1;
    audio.pause();
    return { expectedId, savedTime: Number(snapshot?.position) || 0 };
})()
""")
            client.call("Page.reload", {"ignoreCache": True})
            remote_reload = client.evaluate(r"""
(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const started = performance.now();
    while ((!document.querySelector(".mini-player.active") || !window.__testAudio) &&
        performance.now() - started < 20000) await sleep(25);
    const restoredId = JSON.parse(
        localStorage.getItem("pojidmusic-player-state"))?.currentTrackId || null;
    const pausedBeforeResume = window.__testAudio.paused;
    const srcBeforeResume = window.__testAudio.getAttribute("src") || "";
    const requestStart = window.__dataRequestLog.length;
    const playStart = window.__audioPlayLog.length;
    document.querySelector(".player-toggle").click();
    while ((window.__audioPlayLog.length === playStart || window.__testAudio.paused) &&
        performance.now() - started < 30000) await sleep(25);
    await sleep(800);
    const resumeEntries = window.__dataRequestLog.slice(requestStart)
        .filter((entry) => entry.url.includes("/storage/v1/object/sign/track-audio/"));
    const { getCatalogTrackById } = await import("./js/catalog-state.js");
    const currentAudioPath = getCatalogTrackById(restoredId)?.storageAudioPath || "";
    return {
        restoredId,
        pausedBeforeResume,
        srcBeforeResume,
        srcAfterResume: window.__testAudio.currentSrc,
        currentTime: window.__testAudio.currentTime,
        pausedAfterResume: window.__testAudio.paused,
        mediaErrorCode: window.__testAudio.error?.code || null,
        resumeRequests: resumeEntries.length,
        currentTrackResumeRequests: resumeEntries.filter((entry) =>
            currentAudioPath && entry.url.includes(`/${currentAudioPath}`)).length,
        resumeRequestStatuses: resumeEntries.map((entry) => entry.status)
    };
})()
""")

            print(json.dumps({
                "slug": initial["slug"],
                "catalogRefreshResult": refresh.get("result"),
                "cacheStats": cache_stats,
                "remoteReload": {**remote_reload_setup, **remote_reload},
                "scenarios": scenarios
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
