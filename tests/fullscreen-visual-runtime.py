"""Capture and measure POJIDMUSIC fullscreen layouts across target viewports."""

from __future__ import annotations

import argparse
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

VIEWPORTS = (
    ("desktop-1920x1080", 1920, 1080, False, None),
    ("desktop-1440x900", 1440, 900, False, None),
    ("desktop-1366x768", 1366, 768, False, None),
    ("desktop-narrow-1024x700", 1024, 700, False, None),
    ("mobile-390x844", 390, 844, True, None),
    ("mobile-393x852-safe", 393, 852, True, (47, 34)),
    ("mobile-narrow-360x740", 360, 740, True, None),
    ("mobile-landscape-844x390", 844, 390, True, None),
)


def wait_for(client, expression, label, timeout=30):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if client.evaluate(expression):
            return
        time.sleep(0.05)
    raise RuntimeError(f"Timed out: {label}")


def screenshot(client, path):
    result = client.call("Page.captureScreenshot", {
        "format": "png",
        "captureBeyondViewport": False,
        "fromSurface": True,
    })
    path.write_bytes(base64.b64decode(result["data"]))


def touch_drag(client, start_x, start_y, end_x, end_y):
    client.call("Input.dispatchTouchEvent", {
        "type": "touchStart",
        "touchPoints": [{"x": start_x, "y": start_y, "id": 1}],
    })
    for step in range(1, 5):
        ratio = step / 4
        client.call("Input.dispatchTouchEvent", {
            "type": "touchMove",
            "touchPoints": [{
                "x": start_x + (end_x - start_x) * ratio,
                "y": start_y + (end_y - start_y) * ratio,
                "id": 1,
            }],
        })
        time.sleep(0.025)
    client.call("Input.dispatchTouchEvent", {
        "type": "touchEnd",
        "touchPoints": [],
    })


def run_viewport(server_port, output_dir, spec):
    name, width, height, mobile, safe_area = spec
    debug_socket = socket.socket()
    debug_socket.bind(("127.0.0.1", 0))
    debug_port = debug_socket.getsockname()[1]
    debug_socket.close()

    with tempfile.TemporaryDirectory(prefix="pojidmusic-fullscreen-") as profile:
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
            client.call("Emulation.setDeviceMetricsOverride", {
                "width": width,
                "height": height,
                "deviceScaleFactor": 1,
                "mobile": mobile,
            })
            if mobile:
                client.call("Emulation.setTouchEmulationEnabled", {
                    "enabled": True,
                    "maxTouchPoints": 5,
                })

            safe_area_emulated = False
            if safe_area:
                top, bottom = safe_area
                try:
                    client.call("Emulation.setSafeAreaInsetsOverride", {
                        "insets": {"top": top, "right": 0, "bottom": bottom, "left": 0}
                    })
                    safe_area_emulated = True
                except RuntimeError:
                    pass

            client.call("Page.navigate", {
                "url": f"http://127.0.0.1:{server_port}/index.html?fullscreen-audit={name}"
            })
            wait_for(
                client,
                "document.querySelector(\"#all-tracks [data-track-id='local:5']\") !== null",
                "local catalog",
            )
            client.evaluate("document.querySelector(\"#all-tracks [data-track-id='local:5']\").click()")
            wait_for(client, "document.querySelector('.mini-player.active') !== null", "mini-player")
            client.evaluate("document.querySelector('.player-cover').click()")
            wait_for(
                client,
                "document.querySelector('.fullscreen-player.open') !== null",
                "fullscreen open",
            )
            time.sleep(0.8)

            metrics = client.evaluate(r"""
(() => {
    const selectors = {
        player: ".fullscreen-player",
        content: ".fullscreen-player-content",
        actions: ".fullscreen-player-desktop-actions",
        collapse: ".fullscreen-player-desktop-collapse",
        artwork: ".fullscreen-player-cover-float",
        info: ".fullscreen-player-info",
        title: ".fullscreen-player-title",
        artist: ".fullscreen-player-artist",
        progress: ".fullscreen-player-progress-area",
        controls: ".fullscreen-player-controls",
        artistPanel: ".fullscreen-player-artist-identity"
    };
    const rectangle = (selector) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
            x: Math.round(rect.x * 10) / 10,
            y: Math.round(rect.y * 10) / 10,
            width: Math.round(rect.width * 10) / 10,
            height: Math.round(rect.height * 10) / 10,
            right: Math.round(rect.right * 10) / 10,
            bottom: Math.round(rect.bottom * 10) / 10,
            display: style.display,
            overflow: style.overflow,
            clipped: rect.top < -0.5 || rect.left < -0.5 ||
                rect.right > innerWidth + 0.5 || rect.bottom > innerHeight + 0.5
        };
    };
    const rects = Object.fromEntries(
        Object.entries(selectors).map(([key, selector]) => [key, rectangle(selector)])
    );
    const player = document.querySelector(selectors.player);
    const title = document.querySelector(selectors.title);
    const artist = document.querySelector(selectors.artist);
    const focusables = [...player.querySelectorAll("button, a, input, [tabindex]")]
        .filter((element) => getComputedStyle(element).display !== "none")
        .map((element) => {
            const rect = element.getBoundingClientRect();
            return {
                className: element.className,
                width: Math.round(rect.width),
                height: Math.round(rect.height),
                clipped: rect.top < 0 || rect.bottom > innerHeight ||
                    rect.left < 0 || rect.right > innerWidth
            };
        });
    return {
        viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
        classes: document.documentElement.className,
        rects,
        playerPadding: {
            top: getComputedStyle(player).paddingTop,
            right: getComputedStyle(player).paddingRight,
            bottom: getComputedStyle(player).paddingBottom,
            left: getComputedStyle(player).paddingLeft
        },
        contentOverflow: {
            clientHeight: player.clientHeight,
            scrollHeight: player.scrollHeight,
            contentHeight: rects.content?.height || 0
        },
        text: {
            title: title.textContent.trim(),
            titleOverflow: title.scrollWidth > title.clientWidth,
            artist: artist.textContent.trim(),
            artistOverflow: artist.scrollWidth > artist.clientWidth,
            artistAlign: getComputedStyle(artist).textAlign,
            artistJustify: getComputedStyle(artist).justifyContent
        },
        focusables,
        currentTrackId: JSON.parse(
            localStorage.getItem("pojidmusic-player-state"))?.currentTrackId || null,
        activeElement: document.activeElement?.className ||
            document.activeElement?.tagName || null,
        bodyLocked: document.body.classList.contains("fullscreen-player-open")
    };
})()
""")

            long_text = client.evaluate(r"""
(() => {
    const title = document.querySelector(".fullscreen-player-title");
    const artist = document.querySelector(".fullscreen-player-artist");
    title.textContent = "Очень длинное название трека, которое проверяет устойчивость полноэкранного плеера";
    artist.textContent = "Очень длинное имя исполнителя feat. Другой исполнитель и ещё один участник";
    const measure = (element) => {
        const rect = element.getBoundingClientRect();
        return {
            width: rect.width,
            height: rect.height,
            scrollWidth: element.scrollWidth,
            clientWidth: element.clientWidth,
            overflow: element.scrollWidth > element.clientWidth,
            clipped: rect.bottom > innerHeight || rect.top < 0
        };
    };
    return { title: measure(title), artist: measure(artist) };
})()
""")
            metrics["longText"] = long_text
            metrics["safeAreaEmulated"] = safe_area_emulated
            metrics["requestedSafeArea"] = safe_area
            image_path = output_dir / f"{name}.png"
            screenshot(client, image_path)
            metrics["screenshot"] = str(image_path)

            if mobile:
                artwork = metrics["rects"]["artwork"]
                progress = metrics["rects"]["progress"]
                controls = metrics["rects"]["controls"]
                artist_panel = metrics["rects"]["artistPanel"]
                panel_gap = artist_panel["y"] - controls["bottom"]
                metrics["artistPanelLayout"] = {
                    "gapFromControls": panel_gap,
                    "belowControls": panel_gap >= 12,
                    "insideViewport": not artist_panel["clipped"],
                }
                assert metrics["artistPanelLayout"]["belowControls"], metrics
                assert metrics["artistPanelLayout"]["insideViewport"], metrics
                touch_drag(
                    client,
                    artwork["x"] + artwork["width"] / 2,
                    artwork["y"] + artwork["height"] / 2,
                    artwork["x"] + artwork["width"] / 2 + 100,
                    artwork["y"] + artwork["height"] / 2 + 12,
                )
                time.sleep(0.35)
                horizontal_kept_open = client.evaluate(
                    "document.querySelector('.fullscreen-player').classList.contains('open')"
                )

                touch_drag(
                    client,
                    progress["x"] + progress["width"] / 2,
                    progress["y"] + 15,
                    progress["x"] + progress["width"] / 2,
                    min(height - 4, progress["y"] + 145),
                )
                time.sleep(0.35)
                progress_kept_open = client.evaluate(
                    "document.querySelector('.fullscreen-player').classList.contains('open')"
                )

                start_y = (safe_area[0] + 8) if safe_area else 12
                touch_drag(client, 8, start_y, 8, min(height - 4, start_y + 180))
                wait_for(
                    client,
                    "!document.querySelector('.fullscreen-player').classList.contains('open')",
                    "downward gesture close",
                )
                metrics["gestures"] = {
                    "horizontalKeptOpen": horizontal_kept_open,
                    "progressDragKeptOpen": progress_kept_open,
                    "downwardClosed": True,
                }
            return metrics
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--label", default="current")
    args = parser.parse_args()
    output_dir = ROOT / "tests" / "screenshots" / "fullscreen" / args.label
    output_dir.mkdir(parents=True, exist_ok=True)

    server = SUPPORT.ThreadingHTTPServer(("127.0.0.1", 0), SUPPORT.QuietHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        report = {
            name: run_viewport(server.server_port, output_dir, spec)
            for spec in VIEWPORTS
            for name in (spec[0],)
        }
        report_path = output_dir / "metrics.json"
        report_path.write_text(
            json.dumps(report, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(report_path)
        print(json.dumps(report, ensure_ascii=False, indent=2))
    finally:
        server.shutdown()


if __name__ == "__main__":
    main()
