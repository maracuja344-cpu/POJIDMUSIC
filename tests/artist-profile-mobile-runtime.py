"""Capture and verify mobile artist profile owner/non-owner presentation."""

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


def wait_for(client, expression, message, timeout=30):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if client.evaluate(expression):
            time.sleep(0.2)
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


def set_viewport(client, width, height, *, mobile=True):
    client.call("Emulation.clearDeviceMetricsOverride")
    client.call("Emulation.setDeviceMetricsOverride", {
        "width": width,
        "height": height,
        "deviceScaleFactor": 1,
        "mobile": mobile,
    })


def open_artist_profile(client, app_url):
    client.call("Page.navigate", {"url": app_url})
    wait_for(
        client,
        "document.querySelectorAll('#new .release-card').length >= 2",
        "Home cards did not render",
    )
    client.evaluate("document.documentElement.classList.add('mobile-device')")
    client.evaluate(
        "document.querySelector('#new .artist-action-menu-toggle').click();"
        "document.querySelector('#new [role=menuitem]').click()"
    )
    wait_for(
        client,
        "document.querySelector('#artist-profile:not([hidden]) [data-artist-name]')"
        "?.textContent.trim() !== 'Артист'",
        "Artist Profile did not render",
    )
    client.evaluate("scrollTo(0, 0)")


def apply_owner_fixture(client):
    client.evaluate("""
        (() => {
            const hero = document.querySelector('.artist-hero');
            const banner = document.querySelector('[data-artist-banner]');
            const avatar = document.querySelector('[data-artist-avatar]');
            const ownerActions = document.querySelector('[data-artist-owner-actions]');
            hero.classList.add('is-owner');
            ownerActions.hidden = false;
            document.querySelectorAll(
                '[data-change-artist-avatar], [data-change-artist-banner]'
            ).forEach((control) => { control.hidden = false; });
            banner.classList.add('has-image');
            banner.style.backgroundImage = 'url("img/cover2.jpg")';
            banner.style.backgroundPosition = '50% 42%';
            avatar.classList.add('has-image');
            avatar.style.backgroundImage = 'url("img/1.jpg")';
            document.querySelector('[data-artist-name]').textContent = 'Amoqly';
            document.querySelector('[data-artist-release-count]').textContent = '7 релизов';
        })()
    """)
    client.evaluate("""
        window.__managedTrackFixtureReady = false;
        Promise.all([
            import('./js/track-management.js'),
            import('./js/catalog-state.js')
        ]).then(([management, catalog]) => {
            const card = document.querySelector(
                '#artist-profile [data-artist-tracks] .release-card'
            );
            const track = catalog.getCatalogTracks().find(
                (candidate) => candidate.catalogId === card?.dataset.trackId
            );
            if (card && track && !card.querySelector('.track-manage-button')) {
                management.decorateManagedTrackCard(card, track);
            }
            window.__managedTrackFixtureReady = Boolean(
                card?.querySelector('.track-manage-button')
            );
        });
    """)
    wait_for(
        client,
        "window.__managedTrackFixtureReady === true",
        "Managed release-card fixture did not render",
    )
    time.sleep(0.25)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--width", type=int, default=390)
    parser.add_argument("--height", type=int, default=844)
    args = parser.parse_args()
    output_dir = ROOT / "tests" / "screenshots" / "artist-profile-mobile"
    output_dir.mkdir(parents=True, exist_ok=True)
    server = SUPPORT.ThreadingHTTPServer(("127.0.0.1", 0), SUPPORT.QuietHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    debug_socket = socket.socket()
    debug_socket.bind(("127.0.0.1", 0))
    debug_port = debug_socket.getsockname()[1]
    debug_socket.close()

    with tempfile.TemporaryDirectory(prefix="pojidmusic-artist-profile-") as profile:
        process = subprocess.Popen([
            str(SUPPORT.CHROME), "--headless=new", "--disable-gpu", "--no-first-run",
            "--no-default-browser-check", f"--window-size={args.width},{args.height}",
            "--remote-allow-origins=*", f"--remote-debugging-port={debug_port}",
            f"--user-data-dir={profile}", "about:blank",
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            client = SUPPORT.DevToolsSocket(SUPPORT.wait_for_debugger(debug_port))
            client.call("Page.enable")
            client.call("Runtime.enable")
            set_viewport(client, args.width, args.height)
            client.call("Emulation.setTouchEmulationEnabled", {
                "enabled": True,
                "maxTouchPoints": 5,
            })
            app_url = (
                f"http://127.0.0.1:{server.server_port}/"
                "index.html?artist-profile-mobile=1"
            )

            results = {}
            for width, height in ((args.width, args.height),):
                set_viewport(client, width, height)
                open_artist_profile(client, f"{app_url}&viewport={width}x{height}")
                capture(client, output_dir / f"non-owner-{width}x{height}.png")
                apply_owner_fixture(client)
                capture(client, output_dir / f"owner-{width}x{height}.png")
                results[f"{width}x{height}"] = client.evaluate("""
                    (() => {
                        const rect = (selector) => {
                            const element = document.querySelector(selector);
                            if (!element) return null;
                            const value = element.getBoundingClientRect();
                            return {
                                x: value.x,
                                y: value.y,
                                width: value.width,
                                height: value.height,
                                right: value.right,
                                bottom: value.bottom
                            };
                        };
                        const overlaps = (a, b) => Boolean(a && b &&
                            a.x < b.right && a.right > b.x &&
                            a.y < b.bottom && a.bottom > b.y);
                        const identity = rect('.artist-identity');
                        const avatar = rect('.artist-avatar');
                        const owner = rect('.artist-owner-menu-toggle');
                        const hero = rect('.artist-hero');
                        const visible = (selector) => Boolean(
                            document.querySelector(selector)?.getClientRects().length
                        );
                        const firstCard = document.querySelector(
                            '#artist-profile [data-artist-tracks] .release-card'
                        );
                        const cover = firstCard?.querySelector('.cover')
                            ?.getBoundingClientRect();
                        const manage = firstCard?.querySelector('.track-manage-button')
                            ?.getBoundingClientRect();
                        return {
                            viewport: [innerWidth, innerHeight],
                            documentWidth: document.documentElement.scrollWidth,
                            bodyWidth: document.body.scrollWidth,
                            widest: [...document.body.querySelectorAll('*')]
                                .map((element) => ({
                                    selector: element.id
                                        ? `#${element.id}`
                                        : `.${[...element.classList].join('.')}`,
                                    width: element.getBoundingClientRect().width,
                                    right: element.getBoundingClientRect().right
                                }))
                                .filter((item) => item.right > innerWidth + 0.5)
                                .sort((a, b) => b.right - a.right)
                                .slice(0, 6),
                            hero,
                            identity,
                            avatar,
                            owner,
                            bannerEdit: rect('.artist-banner-edit'),
                            avatarEdit: rect('.artist-avatar-edit'),
                            avatarVisible: visible('.artist-avatar'),
                            bannerEditVisible: visible('.artist-banner-edit'),
                            avatarEditVisible: visible('.artist-avatar-edit'),
                            identityCentered: Math.abs(
                                (identity.x + identity.width / 2)
                                - (hero.x + hero.width / 2)
                            ) <= 1,
                            ownerTopOffset: owner.y - hero.y,
                            ownerRightOffset: hero.right - owner.right,
                            releaseActionCount: firstCard?.querySelectorAll(
                                '.track-manage-button, .artist-action-menu-toggle'
                            ).length || 0,
                            artistActionCount: firstCard?.querySelectorAll(
                                '.artist-action-menu-toggle'
                            ).length || 0,
                            manageBelowCover: Boolean(
                                cover && manage && manage.top >= cover.bottom
                            ),
                            identityOwnerOverlap:
                                overlaps(identity, owner) || overlaps(avatar, owner),
                            directActionsVisible: [...document.querySelectorAll(
                                '.artist-owner-actions > .artist-quick-upload, '
                                + '.artist-owner-actions > .artist-settings-button'
                            )].some((element) => element.getClientRects().length > 0)
                        };
                    })()
                """)

            client.evaluate("document.querySelector('[data-toggle-artist-owner-menu]').click()")
            wait_for(
                client,
                "!document.querySelector('.artist-owner-menu-popover').hidden",
                "Owner menu did not open",
            )
            capture(client, output_dir / f"owner-menu-{args.width}x{args.height}.png")
            menu_state = client.evaluate("""
                (() => {
                    const menu = document.querySelector('.artist-owner-menu-popover')
                        .getBoundingClientRect();
                    const identity = document.querySelector('.artist-identity')
                        .getBoundingClientRect();
                    const overlaps = menu.left < identity.right
                        && menu.right > identity.left
                        && menu.top < identity.bottom
                        && menu.bottom > identity.top;
                    return {
                        expanded: document.querySelector('[data-toggle-artist-owner-menu]')
                            .getAttribute('aria-expanded'),
                        items: [...document.querySelectorAll(
                            '.artist-owner-menu-popover [role=menuitem]'
                        )].map((item) => item.textContent.trim()),
                        overlapsIdentity: overlaps
                    };
                })()
            """)

            client.evaluate("""
                document.querySelector('.artist-action-menu-toggle').click()
            """)
            exclusive_release = client.evaluate("""
                (() => ({
                    ownerOpen: document.querySelector('.artist-owner-menu')
                        .classList.contains('is-open'),
                    releaseOpen: Boolean(document.querySelector('.artist-action-menu.is-open'))
                }))()
            """)

            client.evaluate("document.querySelector('[data-toggle-artist-owner-menu]').click()")
            exclusive_owner = client.evaluate("""
                (() => ({
                    ownerOpen: document.querySelector('.artist-owner-menu')
                        .classList.contains('is-open'),
                    releaseOpen: Boolean(document.querySelector('.artist-action-menu.is-open'))
                }))()
            """)
            client.evaluate("""
                document.dispatchEvent(new KeyboardEvent('keydown', {
                    key: 'Escape', bubbles: true, cancelable: true
                }))
            """)
            escape_state = client.evaluate("""
                (() => ({
                    open: document.querySelector('.artist-owner-menu')
                        .classList.contains('is-open'),
                    focus: document.activeElement.matches('[data-toggle-artist-owner-menu]')
                }))()
            """)

            client.evaluate("""
                document.querySelector('[data-toggle-artist-owner-menu]').click();
                document.querySelector(
                    '.artist-owner-menu-popover [data-change-artist-banner]'
                ).click();
            """)
            banner_state = client.evaluate("""
                (() => ({
                    ownerOpen: document.querySelector('.artist-owner-menu')
                        .classList.contains('is-open')
                }))()
            """)

            client.evaluate("""
                window.__artistProfileUploadDelegated = false;
                document.querySelector('.profile-menu .track-upload-open-button')
                    .addEventListener('click', () => {
                        window.__artistProfileUploadDelegated = true;
                    }, { once: true });
                document.querySelector('[data-toggle-artist-owner-menu]').click();
            """)
            client.evaluate("""
                document.querySelector(
                    '.artist-owner-menu-popover [data-profile-quick-upload]'
                ).click()
            """)
            upload_state = client.evaluate("""
                (() => ({
                    ownerOpen: document.querySelector('.artist-owner-menu')
                        .classList.contains('is-open'),
                    delegated: window.__artistProfileUploadDelegated
                }))()
            """)

            assert menu_state["expanded"] == "true", menu_state
            assert menu_state["items"] == [
                "Изменить баннер",
                "Загрузить трек",
                "Настройки профиля",
            ], menu_state
            assert not menu_state["overlapsIdentity"], menu_state
            assert exclusive_release == {"ownerOpen": False, "releaseOpen": True}, exclusive_release
            assert exclusive_owner == {"ownerOpen": True, "releaseOpen": False}, exclusive_owner
            assert escape_state == {"open": False, "focus": True}, escape_state
            assert banner_state == {"ownerOpen": False}, banner_state
            assert upload_state == {"ownerOpen": False, "delegated": True}, upload_state
            for state in results.values():
                assert not state["identityOwnerOverlap"], state
                assert not state["directActionsVisible"], state
                assert state["owner"]["width"] >= 44 and state["owner"]["height"] >= 44, state
                assert not state["avatarVisible"], state
                assert not state["bannerEditVisible"], state
                assert not state["avatarEditVisible"], state
                assert state["identityCentered"], state
                assert 12 <= state["ownerTopOffset"] <= 24, state
                assert 12 <= state["ownerRightOffset"] <= 24, state
                assert state["releaseActionCount"] == 1, state
                assert state["artistActionCount"] == 0, state
                assert state["manageBelowCover"], state
                assert state["hero"]["right"] <= state["viewport"][0], state
                assert state["hero"]["bottom"] <= state["viewport"][1], state

            desktop_results = {}
            for width, height, label in (
                (1280, 900, "desktop"),
                (900, 720, "tablet"),
            ):
                set_viewport(client, width, height, mobile=False)
                open_artist_profile(client, f"{app_url}&viewport={width}x{height}")
                apply_owner_fixture(client)
                desktop_state = client.evaluate("""
                    (() => {
                        const visible = (selector) => Boolean(
                            document.querySelector(selector)?.getClientRects().length
                        );
                        const rect = (selector) => document.querySelector(selector)
                            .getBoundingClientRect();
                        const overlaps = (left, right) => (
                            left.left < right.right
                            && left.right > right.left
                            && left.top < right.bottom
                            && left.bottom > right.top
                        );
                        const hero = rect('.artist-hero');
                        const identity = rect('.artist-identity');
                        const title = rect('.artist-identity h1');
                        const releaseCount = rect('.artist-release-count');
                        const ownerActions = rect('.artist-owner-actions');
                        const uploadStyle = getComputedStyle(
                            document.querySelector('.artist-quick-upload')
                        );
                        const settingsStyle = getComputedStyle(
                            document.querySelector('.artist-settings-button')
                        );
                        return {
                            viewport: [innerWidth, innerHeight],
                            documentWidth: document.documentElement.scrollWidth,
                            directActionsVisible: visible('.artist-quick-upload')
                                && visible('.artist-settings-button'),
                            mobileMenuVisible: visible('.artist-owner-menu-toggle'),
                            avatarVisible: visible('.artist-avatar'),
                            heroRight: hero.right,
                            identityLeftOffset: identity.left - hero.left,
                            identityTextLeftDelta: Math.abs(
                                title.left - releaseCount.left
                            ),
                            identityReleaseGap: releaseCount.top - title.bottom,
                            identityOwnerOverlap: overlaps(identity, ownerActions),
                            ownerRightOffset: hero.right - ownerActions.right,
                            uploadBackground: uploadStyle.backgroundColor,
                            uploadBackdrop: uploadStyle.backdropFilter,
                            settingsBackground: settingsStyle.backgroundColor
                        };
                    })()
                """)
                assert desktop_state["directActionsVisible"], desktop_state
                assert not desktop_state["mobileMenuVisible"], desktop_state
                assert not desktop_state["avatarVisible"], desktop_state
                assert 20 <= desktop_state["identityLeftOffset"] <= 64, desktop_state
                assert desktop_state["identityTextLeftDelta"] <= 1, desktop_state
                assert 0 <= desktop_state["identityReleaseGap"] <= 12, desktop_state
                assert not desktop_state["identityOwnerOverlap"], desktop_state
                assert 20 <= desktop_state["ownerRightOffset"] <= 64, desktop_state
                assert desktop_state["uploadBackground"] != "rgb(255, 255, 255)", desktop_state
                assert desktop_state["settingsBackground"] != "rgb(255, 255, 255)", desktop_state
                assert desktop_state["uploadBackdrop"] != "none", desktop_state
                assert desktop_state["documentWidth"] <= desktop_state["viewport"][0], desktop_state
                assert desktop_state["heroRight"] <= desktop_state["viewport"][0], desktop_state
                desktop_results[label] = desktop_state
                capture(client, output_dir / f"owner-{label}-{width}x{height}.png")

            report = {
                "viewports": results,
                "desktop": desktop_results,
                "menu": menu_state,
                "exclusiveRelease": exclusive_release,
                "exclusiveOwner": exclusive_owner,
                "escape": escape_state,
                "banner": banner_state,
                "upload": upload_state,
            }
            (output_dir / f"metrics-{args.width}x{args.height}.json").write_text(
                json.dumps(report, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            print(output_dir)
            print(json.dumps(report, ensure_ascii=False, indent=2))
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
            server.shutdown()


if __name__ == "__main__":
    main()
