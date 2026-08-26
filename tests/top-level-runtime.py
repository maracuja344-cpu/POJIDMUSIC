"""Run POJIDMUSIC player checks in a real top-level Chromium page.

The runner uses only the Python standard library and Chrome DevTools Protocol.
It wraps the native Audio constructor before the application loads so tests can
observe and seek the real media element without adding a production test hook.
"""

from __future__ import annotations

import base64
import json
import os
import socket
import struct
import subprocess
import tempfile
import threading
import time
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CHROME = Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe")


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, _format, *args):
        pass

    def copyfile(self, source, outputfile):
        try:
            super().copyfile(source, outputfile)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass


class DevToolsSocket:
    def __init__(self, url: str):
        host_port, path = url.removeprefix("ws://").split("/", 1)
        host, port = host_port.split(":", 1)
        self.socket = socket.create_connection((host, int(port)), timeout=10)
        key = base64.b64encode(os.urandom(16)).decode()
        request = (
            f"GET /{path} HTTP/1.1\r\nHost: {host_port}\r\nUpgrade: websocket\r\n"
            f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n"
        )
        self.socket.sendall(request.encode())
        response = self._read_until(b"\r\n\r\n")
        if not response.startswith(b"HTTP/1.1 101"):
            raise RuntimeError(
                "Chrome rejected the WebSocket handshake: "
                + response.decode(errors="replace")
            )
        self.socket.settimeout(120)
        self.next_id = 0

    def _read_until(self, marker: bytes) -> bytes:
        data = b""
        while marker not in data:
            data += self.socket.recv(4096)
        return data

    def _read_exact(self, size: int) -> bytes:
        data = b""
        while len(data) < size:
            chunk = self.socket.recv(size - len(data))
            if not chunk:
                raise ConnectionError("DevTools socket closed")
            data += chunk
        return data

    def _receive(self):
        first, second = self._read_exact(2)
        opcode = first & 0x0F
        length = second & 0x7F
        if length == 126:
            length = struct.unpack("!H", self._read_exact(2))[0]
        elif length == 127:
            length = struct.unpack("!Q", self._read_exact(8))[0]
        payload = self._read_exact(length)
        if opcode == 8:
            raise ConnectionError("DevTools socket closed")
        if opcode == 9:
            self._send_frame(payload, opcode=10)
            return self._receive()
        return json.loads(payload.decode())

    def _send_frame(self, payload: bytes, opcode: int = 1):
        mask = os.urandom(4)
        length = len(payload)
        header = bytes([0x80 | opcode])
        if length < 126:
            header += bytes([0x80 | length])
        elif length < 65536:
            header += bytes([0xFE]) + struct.pack("!H", length)
        else:
            header += bytes([0xFF]) + struct.pack("!Q", length)
        masked = bytes(value ^ mask[index % 4] for index, value in enumerate(payload))
        self.socket.sendall(header + mask + masked)

    def call(self, method: str, params: dict | None = None):
        self.next_id += 1
        message_id = self.next_id
        payload = json.dumps({"id": message_id, "method": method, "params": params or {}})
        self._send_frame(payload.encode())
        while True:
            response = self._receive()
            if response.get("id") == message_id:
                if "error" in response:
                    raise RuntimeError(response["error"])
                return response.get("result", {})

    def evaluate(self, expression: str):
        evaluation = self.call("Runtime.evaluate", {
            "expression": expression,
            "awaitPromise": True,
            "returnByValue": True,
            "userGesture": True,
        })
        if "exceptionDetails" in evaluation:
            details = evaluation["exceptionDetails"]
            exception = details.get("exception", {})
            raise RuntimeError(
                exception.get("description")
                or details.get("text")
                or "JavaScript evaluation failed"
            )
        result = evaluation["result"]
        if result.get("subtype") == "error":
            raise RuntimeError(result.get("description", "JavaScript evaluation failed"))
        return result.get("value")


CAPTURE_AUDIO = r"""
(() => {
    const NativeAudio = window.Audio;
    window.__testAudios = [];
    Object.defineProperty(window, "__testAudio", {
        configurable: true,
        get() {
            return (window.__testLastPlayingAudio?.currentSrc
                ? window.__testLastPlayingAudio
                : null) ||
                window.__testAudios.find((audio) => !audio.paused && audio.currentSrc) ||
                window.__testAudios.find((audio) => audio.currentSrc) ||
                window.__testAudios[0];
        }
    });
    function ObservableAudio(...args) {
        const audio = new NativeAudio(...args);
        window.__testAudios.push(audio);
        window.__testEndedCount = 0;
        audio.addEventListener("playing", () => {
            window.__testLastPlayingAudio = audio;
        });
        audio.addEventListener("ended", () => { window.__testEndedCount += 1; });
        return audio;
    }
    ObservableAudio.prototype = NativeAudio.prototype;
    Object.setPrototypeOf(ObservableAudio, NativeAudio);
    window.Audio = ObservableAudio;

    window.__testMediaSessionActions = {};
    if (navigator.mediaSession?.setActionHandler) {
        const nativeSetActionHandler =
            navigator.mediaSession.setActionHandler.bind(navigator.mediaSession);
        navigator.mediaSession.setActionHandler = (action, handler) => {
            window.__testMediaSessionActions[action] = handler;
            return nativeSetActionHandler(action, handler);
        };
    }
})();
"""


RUNTIME_CHECKS = r"""
(async () => {
    const results = [];
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const waitFor = async (predicate, label, timeout = 12000) => {
        const start = performance.now();
        while (performance.now() - start < timeout) {
            if (predicate()) return;
            await sleep(50);
        }
        throw new Error(`Timeout: ${label}`);
    };
    const check = (name, condition, detail = "") => {
        results.push({ name, pass: Boolean(condition), detail });
        if (!condition) throw new Error(`${name}: ${detail}`);
    };
    const currentId = () => {
        try {
            return JSON.parse(localStorage.getItem("pojidmusic-player-state"))
                ?.currentTrackId || null;
        } catch { return null; }
    };
    const click = (element) => {
        if (!element) throw new Error("Missing click target");
        element.click();
    };
    const setRepeat = async (mode) => {
        const button = document.querySelector(".player-repeat");
        for (let index = 0; index < 4 && button.dataset.repeatMode !== mode; index += 1) {
            click(button);
            await sleep(30);
        }
        check(`repeat mode ${mode}`, button.dataset.repeatMode === mode, button.dataset.repeatMode);
    };
    const finishNaturally = async () => {
        const audio = window.__testAudio;
        await waitFor(() => Number.isFinite(audio.duration) && audio.duration > 0,
            "audio metadata");
        if (audio.ended || audio.currentTime >= audio.duration - 1.5) {
            audio.currentTime = 0;
            await audio.play();
            await sleep(120);
        }
        const endedBefore = window.__testEndedCount;
        audio.currentTime = Math.max(0, audio.duration - 1);
        await audio.play();
        const started = performance.now();
        while (performance.now() - started < 8000 &&
            window.__testEndedCount === endedBefore) {
            await sleep(50);
        }
        if (window.__testEndedCount > endedBefore) return "native";
        audio.dispatchEvent(new Event("ended"));
        await sleep(50);
        return "dispatched";
    };
    const dispatchEndedAtBoundary = async ({ pause = false } = {}) => {
        const audio = window.__testAudio;
        await waitFor(() => Number.isFinite(audio.duration) && audio.duration > 0,
            "audio metadata for simulated ended");
        if (pause) {
            audio.pause();
            await waitFor(() => audio.paused &&
                !document.querySelector(".player-toggle.playing"),
                "pause before simulated ended");
        }
        audio.currentTime = audio.duration;
        audio.dispatchEvent(new Event("ended"));
        await sleep(50);
    };

    await waitFor(() => window.__testAudio && document.querySelectorAll("#all-tracks .release-card").length >= 2,
        "application startup", 20000);
    const { getIsCatalogRefreshing } = await import("./js/script.js");
    await waitFor(() => !getIsCatalogRefreshing(), "catalog refresh completion", 20000);
    const firstCard = document.querySelector(
        ".recommendations-track .recommendation-card:not([data-clone])"
    );
    click(firstCard);
    await waitFor(() => document.querySelector(".mini-player.active") && currentId(), "track selection");
    try {
        await waitFor(() => !window.__testAudio.paused && document.querySelector(".player-toggle.playing"),
            "native audio playing");
    } catch (error) {
        throw new Error(`${error.message}; ${JSON.stringify({
            currentId: currentId(),
            paused: window.__testAudio.paused,
            src: window.__testAudio.currentSrc,
            readyState: window.__testAudio.readyState,
            mediaError: window.__testAudio.error?.code || null,
            artist: document.querySelector(".player-artist")?.textContent,
            snapshot: localStorage.getItem("pojidmusic-player-state")
        })}`);
    }
    const firstId = currentId();
    check("select and play uses native Audio", window.__testAudio instanceof HTMLMediaElement,
        window.__testAudio.constructor.name);

    click(document.querySelector(".player-toggle"));
    await waitFor(() => window.__testAudio.paused &&
        !document.querySelector(".player-toggle.playing"), "pause");
    check("pause synchronizes controls", !document.querySelector(".player-toggle.playing"));
    click(document.querySelector(".player-toggle"));
    await waitFor(() => !window.__testAudio.paused &&
        document.querySelector(".player-toggle.playing"), "resume");
    check("resume synchronizes controls", document.querySelector(".player-toggle.playing"));

    click(document.querySelector(".player-next"));
    await waitFor(() => currentId() !== firstId, "Next");
    const secondId = currentId();
    check("Next advances", secondId !== firstId, `${firstId} -> ${secondId}`);
    await sleep(700);
    click(document.querySelector(".player-prev"));
    await waitFor(() => currentId() === firstId, "Previous");
    await sleep(700);
    check("Previous returns through history", currentId() === firstId);

    const syncSnapshot = () => {
        const id = currentId();
        const cards = [...document.querySelectorAll(
            `.release-card[data-track-id='${CSS.escape(id)}'], .recommendation-card[data-track-id='${CSS.escape(id)}']`
        )];
        return {
            count: cards.length,
            current: cards.filter((card) => card.classList.contains("current")).length,
            playing: cards.filter((card) => card.classList.contains("playing")).length,
            clones: cards.filter((card) => card.dataset.clone === "true").length,
        };
    };
    let sync = syncSnapshot();
    check("all live duplicate cards mirror current", sync.count > 0 && sync.current === sync.count,
        JSON.stringify(sync));
    check("all live duplicate cards mirror playing", sync.playing === sync.count,
        JSON.stringify(sync));
    window.dispatchEvent(new Event("resize"));
    await sleep(350);
    sync = syncSnapshot();
    check("duplicates remain synchronized after carousel rebuild",
        sync.count > 0 && sync.current === sync.count && sync.playing === sync.count,
        JSON.stringify(sync));

    if (currentId() !== "local:7") {
        click(document.querySelector("#all-tracks .release-card[data-track-id='local:7']"));
    } else if (window.__testAudio.paused) {
        click(document.querySelector(".player-toggle"));
    }
    await waitFor(() => currentId() === "local:7" && !window.__testAudio.paused,
        "stable local track for ended");
    await waitFor(() => decodeURI(window.__testAudio.currentSrc).includes("22hoesnew"),
        "stable local audio source");
    await sleep(700);
    await setRepeat("one");
    const repeatOneId = currentId();
    const repeatOneEndMode = await finishNaturally();
    await waitFor(() => currentId() === repeatOneId && !window.__testAudio.paused,
        "Repeat One restart");
    check("ended under Repeat One repeats current", currentId() === repeatOneId,
        repeatOneEndMode);

    await setRepeat("off");
    const searchInput = document.querySelector(".search-input");
    searchInput.value = "Avario";
    searchInput.dispatchEvent(new Event("input", { bubbles: true }));
    await waitFor(() => document.querySelectorAll(".search-results-list .release-card").length === 1,
        "single search result");
    click(document.querySelector(".search-results-list .release-card"));
    await waitFor(() => currentId() === "local:5", "finite search context selection");
    await sleep(700);
    const lastId = currentId();
    Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => true
    });
    await dispatchEndedAtBoundary({ pause: true });
    await waitFor(() => currentId() !== lastId &&
        document.querySelector(".player-toggle.playing"),
        "hidden Repeat Off autoplay continuation");
    delete document.hidden;
    check("hidden ended event continues playback through the active Audio owner",
        currentId() !== lastId && !window.__testAudio.paused,
        JSON.stringify({ id: currentId(), endedCount: window.__testEndedCount,
            paused: window.__testAudio.paused, ended: window.__testAudio.ended }));

    await setRepeat("all");
    click(document.querySelector(".search-results-list .release-card"));
    await waitFor(() => currentId() === lastId && !window.__testAudio.paused,
        "Repeat All finite context selection");
    await sleep(700);
    const repeatAllEndedBefore = window.__testEndedCount;
    await dispatchEndedAtBoundary();
    await waitFor(() => currentId() === lastId && !window.__testAudio.paused,
        "Repeat All one-item wrap");
    check("ended event at Repeat All finite boundary wraps",
        currentId() === lastId && window.__testEndedCount > repeatAllEndedBefore,
        JSON.stringify({ id: currentId(), endedCount: window.__testEndedCount }));

    searchInput.value = "";
    searchInput.dispatchEvent(new Event("input", { bubbles: true }));
    click([...document.querySelectorAll("#all-tracks .release-card")]
        .find((card) => card.dataset.trackId !== currentId()));
    await waitFor(() => currentId() !== lastId, "catalog context restoration");
    await sleep(700);

    const shuffle = document.querySelector(".player-shuffle");
    if (!shuffle.classList.contains("is-active")) click(shuffle);
    const beforeShuffle = currentId();
    click(document.querySelector(".fullscreen-queue-button"));
    const materializedQueue = [...document.querySelectorAll("[data-queue-track-id]")]
        .map((item) => item.dataset.queueTrackId);
    check("shuffle Queue anchors the unchanged current track",
        materializedQueue[0] === beforeShuffle,
        JSON.stringify({ beforeShuffle, materializedQueue }));
    check("shuffle Queue exposes a materialized future order",
        materializedQueue.length > 1);
    click(document.querySelector("[data-close-player-queue]"));
    click(document.querySelector(".player-next"));
    await waitFor(() => currentId() === materializedQueue[1], "shuffle Next");
    check("shuffle Next follows the visible Queue order",
        currentId() === materializedQueue[1]);
    await sleep(700);
    const firstShuffleId = currentId();
    click(document.querySelector(".player-next"));
    await waitFor(() => currentId() === materializedQueue[2], "second shuffle Next");
    const secondShuffleId = currentId();
    check("second shuffle Next keeps following the visible Queue order",
        secondShuffleId === materializedQueue[2]);
    await sleep(700);
    click(document.querySelector(".player-prev"));
    await waitFor(() => currentId() === firstShuffleId, "shuffle Previous");
    check("shuffle Previous follows history", currentId() === firstShuffleId);
    await sleep(700);
    click(shuffle);
    check("shuffle can be disabled", !shuffle.classList.contains("is-active"));
    click(document.querySelector(".player-next"));
    await waitFor(() => currentId() !== firstShuffleId, "Next after shuffle disabled");
    check("Next works after shuffle is disabled", currentId() !== firstShuffleId);
    await sleep(700);

    if (currentId() !== "local:7") {
        click(document.querySelector("#all-tracks .release-card[data-track-id='local:7']"));
    } else if (window.__testAudio.paused) {
        click(document.querySelector(".player-toggle"));
    }
    await waitFor(() => currentId() === "local:7" && !window.__testAudio.paused,
        "stable local track for fullscreen checks");
    await waitFor(() => Number.isFinite(window.__testAudio.duration) &&
        window.__testAudio.duration > 0, "fullscreen local metadata");
    await sleep(300);

    const activeId = currentId();
    const positionBeforeFullscreen = window.__testAudio.currentTime;
    document.querySelector(".player-cover").focus();
    click(document.querySelector(".player-cover"));
    await waitFor(() => document.querySelector(".fullscreen-player.open"), "fullscreen open");
    check("fullscreen opens without changing current", currentId() === activeId);
    check("fullscreen opens without resetting position",
        Math.abs(window.__testAudio.currentTime - positionBeforeFullscreen) < 1);
    const expectedInitialFocus =
        document.querySelector(".fullscreen-player-desktop-collapse")
            .getClientRects().length
            ? document.querySelector(".fullscreen-player-desktop-collapse")
            : document.querySelector(".fullscreen-player-toggle");
    await waitFor(() => document.activeElement === expectedInitialFocus,
        "fullscreen initial focus");
    check("fullscreen focuses its first available control",
        document.activeElement === expectedInitialFocus,
        document.activeElement?.className || "none");
    check("fullscreen exposes modal dialog semantics",
        document.querySelector(".fullscreen-player").getAttribute("role") === "dialog" &&
        document.querySelector(".fullscreen-player").getAttribute("aria-modal") === "true");
    check("fullscreen locks both scroll roots",
        document.documentElement.classList.contains("fullscreen-player-open") &&
        document.body.classList.contains("fullscreen-player-open"));

    const fullscreenProgress = document.querySelector(".fullscreen-player-progress");
    await waitFor(() => Number(fullscreenProgress.getAttribute("aria-valuemax")) > 0,
        "fullscreen progress metadata");
    check("fullscreen progress exposes slider semantics",
        fullscreenProgress.getAttribute("role") === "slider" &&
        Number(fullscreenProgress.getAttribute("aria-valuemax")) > 0);
    window.__testAudio.pause();
    window.__testAudio.currentTime = Math.min(5, window.__testAudio.duration / 4);
    await waitFor(() => !window.__testAudio.seeking, "pointer scrub setup");
    const scrubRect = fullscreenProgress.getBoundingClientRect();
    const scrubPointer = (type, ratio, buttons) => fullscreenProgress.dispatchEvent(
        new PointerEvent(type, {
            bubbles: true, cancelable: true, pointerId: 71, pointerType: "touch",
            isPrimary: true, button: 0, buttons,
            clientX: scrubRect.left + scrubRect.width * ratio,
            clientY: scrubRect.top + scrubRect.height / 2
        })
    );
    const scrubAudioStart = window.__testAudio.currentTime;
    scrubPointer("pointerdown", 0.2, 1);
    scrubPointer("pointermove", 0.7, 1);
    const scrubPreviewTime = Number(fullscreenProgress.getAttribute("aria-valuenow"));
    check("pointer scrub preview does not seek audio before release",
        Math.abs(window.__testAudio.currentTime - scrubAudioStart) < 0.2 &&
        scrubPreviewTime > scrubAudioStart + 5,
        JSON.stringify({
            start: scrubAudioStart,
            current: window.__testAudio.currentTime,
            preview: fullscreenProgress.getAttribute("aria-valuenow"),
            duration: window.__testAudio.duration
        }));
    scrubPointer("pointerup", 0.7, 0);
    await waitFor(() => Math.abs(window.__testAudio.currentTime -
        scrubPreviewTime) < 1.25, "pointer scrub commit");
    check("pointer scrub seeks exactly on release", true);
    const seekStart = Math.min(10, Math.max(window.__testAudio.duration - 10, 0));
    window.__testAudio.currentTime = seekStart;
    await waitFor(() => Math.abs(window.__testAudio.currentTime - seekStart) < 0.5,
        "fullscreen keyboard seek start");
    await waitFor(() => !window.__testAudio.seeking,
        "fullscreen keyboard seek start settled");
    fullscreenProgress.focus();
    fullscreenProgress.dispatchEvent(new KeyboardEvent("keydown", {
        key: "ArrowRight", bubbles: true
    }));
    const expectedKeyboardSeek = Math.min(
        seekStart + 5, window.__testAudio.duration);
    await waitFor(() => Math.abs(
        window.__testAudio.currentTime - expectedKeyboardSeek) < 0.5 &&
        Math.abs(Number(fullscreenProgress.getAttribute("aria-valuenow")) -
            expectedKeyboardSeek) < 1,
        "fullscreen keyboard seek settled");
    check("fullscreen progress supports keyboard seeking",
        Math.abs(window.__testAudio.currentTime - expectedKeyboardSeek) < 0.5,
        fullscreenProgress.getAttribute("aria-valuetext"));
    await window.__testAudio.play();

    document.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Escape", bubbles: true
    }));
    await waitFor(() => !document.querySelector(".fullscreen-player.open"),
        "fullscreen Escape close");
    check("fullscreen close restores opener focus",
        document.activeElement === document.querySelector(".player-cover"));
    check("fullscreen close unlocks both scroll roots",
        !document.documentElement.classList.contains("fullscreen-player-open") &&
        !document.body.classList.contains("fullscreen-player-open"));

    for (let cycle = 0; cycle < 3; cycle += 1) {
        document.querySelector(".player-cover").dispatchEvent(new KeyboardEvent("keydown", {
            key: "Enter", bubbles: true
        }));
        await waitFor(() => document.querySelector(".fullscreen-player.open"),
            `fullscreen keyboard cycle ${cycle + 1} open`);
        click(document.querySelector(".fullscreen-player-desktop-collapse"));
        await waitFor(() => !document.querySelector(".fullscreen-player.open"),
            `fullscreen keyboard cycle ${cycle + 1} close`);
    }
    check("fullscreen repeated cycles preserve current", currentId() === activeId);

    click(document.querySelector(".player-cover"));
    await waitFor(() => document.querySelector(".fullscreen-player.open"),
        "fullscreen reopen for controls");
    check("fullscreen mode controls mirror mini-player",
        document.querySelector(".fullscreen-player-shuffle").getAttribute("aria-pressed") ===
            document.querySelector(".player-shuffle").getAttribute("aria-pressed") &&
        document.querySelector(".fullscreen-player-repeat").dataset.repeatMode ===
            document.querySelector(".player-repeat").dataset.repeatMode);

    const beforeFullscreenNext = currentId();
    click(document.querySelector(".fullscreen-player-next"));
    await waitFor(() => currentId() !== beforeFullscreenNext, "fullscreen Next");
    await sleep(700);
    click(document.querySelector(".fullscreen-player-prev"));
    await waitFor(() => currentId() === beforeFullscreenNext, "fullscreen Previous");
    await sleep(700);
    check("fullscreen Next and Previous share playback context",
        currentId() === beforeFullscreenNext);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    await waitFor(() => window.__testAudio.paused &&
        !document.querySelector(".player-toggle.playing"), "fullscreen Space pause");
    check("fullscreen Space pauses once", !document.querySelector(".player-toggle.playing"));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    await waitFor(() => !window.__testAudio.paused &&
        document.querySelector(".player-toggle.playing"), "fullscreen Space resume");
    check("fullscreen Space resumes once", document.querySelector(".player-toggle.playing"));
    check("fullscreen settled playback is not busy",
        document.querySelector(".fullscreen-player").getAttribute("aria-busy") === "false");

    check("Media Session handlers are registered in top-level runtime",
        ["play", "pause", "nexttrack", "previoustrack"].every(
            (action) => typeof window.__testMediaSessionActions[action] === "function"));
    window.__testMediaSessionActions.pause();
    await waitFor(() => window.__testAudio.paused &&
        !document.querySelector(".fullscreen-player-toggle.playing"),
        "Media Session pause while fullscreen open");
    window.__testMediaSessionActions.play();
    await waitFor(() => !window.__testAudio.paused &&
        document.querySelector(".fullscreen-player-toggle.playing"),
        "Media Session play while fullscreen open");
    const beforeMediaNext = currentId();
    window.__testMediaSessionActions.nexttrack();
    await waitFor(() => currentId() !== beforeMediaNext,
        "Media Session Next while fullscreen open");
    await sleep(700);
    window.__testMediaSessionActions.previoustrack();
    await waitFor(() => currentId() === beforeMediaNext,
        "Media Session Previous while fullscreen open");
    await sleep(700);
    check("Media Session actions synchronize fullscreen UI",
        currentId() === beforeMediaNext &&
        document.querySelector(".fullscreen-player-toggle.playing"));

    click(document.querySelector(".fullscreen-player-toggle"));
    await waitFor(() => window.__testAudio.paused &&
        !document.querySelector(".fullscreen-player-toggle.playing"), "fullscreen pause");
    check("fullscreen pause synchronizes", window.__testAudio.paused);
    click(document.querySelector(".fullscreen-player-toggle"));
    await waitFor(() => !window.__testAudio.paused &&
        document.querySelector(".fullscreen-player-toggle.playing"), "fullscreen resume");
    check("fullscreen resume synchronizes", !window.__testAudio.paused);

    const artistLink = document.querySelector(
        `[data-track-id='${CSS.escape(activeId)}'] [data-artist-slug]`
    );
    if (artistLink) {
        click(artistLink);
        await waitFor(() => !document.querySelector("#artist-profile")?.hidden, "artist navigation");
        check("artist navigation preserves current", currentId() === activeId);
        click(document.querySelector("[data-nav-home]"));
        await waitFor(() => !document.querySelector("#catalog-view")?.hidden, "home navigation");
        const homeSync = syncSnapshot();
        check("Home navigation resynchronizes cards", homeSync.current === homeSync.count,
            JSON.stringify(homeSync));
    } else {
        results.push({ name: "artist navigation", pass: null, detail: "no artist link" });
    }

    if (!document.querySelector(".fullscreen-player.open")) {
        click(document.querySelector(".player-cover"));
        await waitFor(() => document.querySelector(".fullscreen-player.open"),
            "fullscreen reopen before reload");
    }
    const duration = window.__testAudio.duration;
    const restorePosition = Math.min(
        Math.max(duration / 2, 1),
        Math.max(duration - 1, 1)
    );
    window.__testAudio.currentTime = restorePosition;
    await waitFor(() => Math.abs(window.__testAudio.currentTime - restorePosition) < 1,
        "seek before reload");
    click(document.querySelector(".fullscreen-player-toggle"));
    await waitFor(() => window.__testAudio.paused, "paused state before reload");
    await waitFor(() => Math.abs(
        (JSON.parse(localStorage.getItem("pojidmusic-player-state"))?.position || 0) -
        restorePosition
    ) < 1, "position snapshot before reload");

    return { results, activeId: currentId(), fullscreenOpen: Boolean(
        document.querySelector(".fullscreen-player.open")), restorePosition };
})()
"""


def wait_for_debugger(port: int, timeout: float = 15):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=1) as response:
                targets = json.load(response)
            page = next(target for target in targets if target["type"] == "page")
            return page["webSocketDebuggerUrl"]
        except Exception:
            time.sleep(0.1)
    raise RuntimeError("Chrome DevTools did not start")


def main():
    if not CHROME.exists():
        raise SystemExit(f"Chrome not found: {CHROME}")
    os.chdir(ROOT)
    server = ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    debug_socket = socket.socket()
    debug_socket.bind(("127.0.0.1", 0))
    debug_port = debug_socket.getsockname()[1]
    debug_socket.close()
    base_url = f"http://127.0.0.1:{server.server_port}"
    app_url = f"{base_url}/index.html?top-level-runtime=1"

    with tempfile.TemporaryDirectory(prefix="pojidmusic-chrome-") as profile:
        process = subprocess.Popen([
            str(CHROME), "--headless=new", "--disable-gpu", "--no-first-run",
            "--no-default-browser-check", "--autoplay-policy=no-user-gesture-required",
            "--window-size=1440,1000",
            "--remote-allow-origins=*", f"--remote-debugging-port={debug_port}",
            f"--user-data-dir={profile}", "about:blank",
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            client = DevToolsSocket(wait_for_debugger(debug_port))
            client.call("Page.enable")
            client.call("Runtime.enable")
            client.call("Page.addScriptToEvaluateOnNewDocument", {"source": CAPTURE_AUDIO})
            client.call("Page.navigate", {"url": app_url})
            ready_deadline = time.time() + 30
            while time.time() < ready_deadline:
                try:
                    if client.evaluate(
                        "document.readyState === 'complete' && "
                        "navigator.serviceWorker.controller !== null"
                    ):
                        break
                except RuntimeError:
                    pass
                time.sleep(0.05)
            else:
                raise RuntimeError("Service worker did not control the player test page")
            client.evaluate("localStorage.clear()")
            client.call("Page.reload", {"ignoreCache": True})
            time.sleep(1)
            run = client.evaluate(RUNTIME_CHECKS)
            client.call("Page.reload", {"ignoreCache": True})
            time.sleep(1)
            reload_state = client.evaluate(r"""
(async () => {
    const started = performance.now();
    while (performance.now() - started < 15000 && !document.querySelector(".mini-player.active")) {
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const expectedPosition = JSON.parse(
        localStorage.getItem("pojidmusic-player-state"))?.position || 0;
    const expectedDuration = JSON.parse(
        localStorage.getItem("pojidmusic-player-state"))?.duration || 0;
    const srcBeforeResume = window.__testAudio.getAttribute("src") || "";
    const positionTextBeforeResume = document.querySelector(".current-time")?.textContent;
    const durationTextBeforeResume = document.querySelector(".duration-time")?.textContent;
    document.querySelector(".player-toggle").click();
    while (performance.now() - started < 30000 &&
        (window.__testAudio.paused || Math.abs(
            window.__testAudio.currentTime - expectedPosition) > 2)) {
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const positionAfterResume = window.__testAudio.currentTime;
    window.__testAudio.pause();
    return {
        currentId: JSON.parse(localStorage.getItem("pojidmusic-player-state"))?.currentTrackId,
        active: Boolean(document.querySelector(".mini-player.active")),
        playing: Boolean(document.querySelector(".player-toggle.playing")),
        fullscreenOpen: Boolean(document.querySelector(".fullscreen-player.open")),
        bodyOpen: document.body.classList.contains("fullscreen-player-open"),
        positionAfterResume,
        expectedPosition,
        expectedDuration,
        srcBeforeResume,
        positionTextBeforeResume,
        durationTextBeforeResume,
        durationRestoredBeforeResolve:
            expectedDuration > 0 && durationTextBeforeResume !== "0:00",
        resumedNearPosition: Math.abs(positionAfterResume - expectedPosition) <= 2
    };
})()
""")
            client.evaluate(r"""
(async () => {
    document.querySelector(".player-cover").click();
    while (!document.querySelector(".fullscreen-player.open")) {
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
    document.querySelector(".fullscreen-player-desktop-collapse").click();
    while (document.querySelector(".fullscreen-player.open")) {
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
})()
""")
            client.call("Page.reload", {"ignoreCache": True})
            time.sleep(1)
            closed_reload_state = client.evaluate(r"""
(async () => {
    const started = performance.now();
    while (performance.now() - started < 15000 && !document.querySelector(".mini-player.active")) {
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return {
        currentId: JSON.parse(localStorage.getItem("pojidmusic-player-state"))?.currentTrackId,
        playing: Boolean(document.querySelector(".player-toggle.playing")),
        fullscreenOpen: Boolean(document.querySelector(".fullscreen-player.open"))
    };
})()
""")
            html_tests = {}
            for page in (
                "data-cache.test.html",
                "audio-url-resolver.test.html",
                "queue-decisions.test.html",
                "player-persistence.test.html",
                "playback-context.test.html",
                "media-session.test.html",
                "player-runtime.test.html",
            ):
                client.call("Page.navigate", {"url": f"{base_url}/tests/{page}"})
                time.sleep(0.3)
                html_tests[page] = client.evaluate(r"""
(async () => {
    const started = performance.now();
    while (performance.now() - started < 40000 &&
        !["passed", "failed"].includes(document.body?.dataset.testStatus)) {
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const output = document.querySelector("#test-output")?.textContent || "";
    return {
        status: document.body?.dataset.testStatus || "timeout",
        passes: (output.match(/^PASS /gm) || []).length,
        failures: (output.match(/^FAIL /gm) || []).length,
        output
    };
})()
""")
            report = {"pageIsTopLevel": client.evaluate("window.top === window"),
                      "runtime": run, "afterReload": reload_state,
                      "afterClosedReload": closed_reload_state,
                      "htmlTests": html_tests}
            print(json.dumps(report, ensure_ascii=False, indent=2))
            failed = [item for item in run["results"] if item["pass"] is False]
            html_failed = any(test["status"] != "passed" for test in html_tests.values())
            position_failed = not reload_state["resumedNearPosition"]
            duration_failed = not reload_state["durationRestoredBeforeResolve"]
            if (failed or html_failed or position_failed or duration_failed or reload_state["fullscreenOpen"]
                    or reload_state["bodyOpen"] or closed_reload_state["fullscreenOpen"]):
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
