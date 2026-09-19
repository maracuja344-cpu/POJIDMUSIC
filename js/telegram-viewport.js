// Geometry only. SDK source: https://telegram.org/js/telegram-web-app.js
// Vendored so a cached shell does not depend on a third-party script request.
const root = document.documentElement;
const launch = new URLSearchParams(location.hash.slice(1));
const inTelegram = Boolean(window.Telegram?.WebApp?.initData || launch.get("tgWebAppData"));

if (inTelegram) {
    root.dataset.telegramViewport = "true";
    root.dataset.telegramMiniApp = "true";
    if (window.Telegram?.WebApp) connect(window.Telegram.WebApp);
    else {
        const sdk = document.createElement("script");
        sdk.src = new URL("../vendor/telegram-web-app.js", import.meta.url).href;
        sdk.onload = () => connect(window.Telegram.WebApp);
        document.head.append(sdk);
    }
}

function connect(app) {
    let frame = 0;
    let unfocusedHeight = 0;
    let lastWidth = innerWidth;
    const px = (name, value) => {
        const next = `${Math.max(0, Number(value) || 0)}px`;
        if (root.style.getPropertyValue(name) !== next) root.style.setProperty(name, next);
    };
    const update = () => {
        frame = 0;
        for (const side of ["top", "right", "bottom", "left"]) {
            px(`--pm-tg-device-${side}`, app.safeAreaInset?.[side]);
            px(`--pm-tg-content-${side}`, app.contentSafeAreaInset?.[side]);
        }
        const visual = window.visualViewport;
        const height = Math.min(app.viewportHeight || innerHeight, visual?.height || innerHeight);
        const editing = document.activeElement?.matches('input:not([type="range"]), textarea, [contenteditable="true"]');
        if (Math.abs(innerWidth - lastWidth) > 80) unfocusedHeight = 0;
        lastWidth = innerWidth;
        if (!editing) unfocusedHeight = height;
        const touchKeyboard = ["android", "ios"].includes(app.platform) || window.matchMedia("(pointer: coarse)").matches;
        const keyboard = Boolean(touchKeyboard && editing && Math.max(unfocusedHeight, app.viewportStableHeight || 0, innerHeight) - height > 120);
        root.classList.toggle("telegram-keyboard-open", keyboard);
        px("--pm-tg-height", height);
        px("--pm-tg-offset", visual?.offsetTop || 0);
        px("--pm-tg-bottom-offset", innerHeight - height - (visual?.offsetTop || 0));

        // Measure actual bars: their sizes vary across the existing CSS layers.
        const nav = document.querySelector(".mobile-bottom-navigation");
        const player = document.querySelector(".mini-player");
        const visible = (el) => el && getComputedStyle(el).display !== "none" && getComputedStyle(el).visibility !== "hidden";
        const navHeight = visible(nav) && !keyboard ? nav.offsetHeight : 0;
        px("--pm-tg-nav-height", navHeight);
        const playerHeight = visible(player) && player.classList.contains("active") && !keyboard ? player.offsetHeight : 0;
        px("--pm-tg-bars-height", navHeight + playerHeight + (navHeight && playerHeight ? 6 : 0) + 24);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    ["viewportChanged", "safeAreaChanged", "contentSafeAreaChanged", "fullscreenChanged"].forEach(name => app.onEvent(name, schedule));
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    document.addEventListener("focusin", schedule);
    document.addEventListener("focusout", schedule);
    const observe = () => {
        const resize = new ResizeObserver(schedule);
        const mutations = new MutationObserver(schedule);
        for (const el of document.querySelectorAll(".mini-player, .mobile-bottom-navigation")) {
            resize.observe(el);
            mutations.observe(el, { attributes: true, attributeFilter: ["class", "hidden"] });
        }
        schedule();
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", observe, { once: true });
    else observe();
    update();
    app.ready();
    app.expand();
    if (app.isVersionAtLeast?.("8.0") && !app.isFullscreen) {
        try { app.requestFullscreen(); } catch { /* Older clients keep their expanded window. */ }
    }
}
