const modal = () => document.querySelector("[data-track-editor-modal]");
const dialog = () => modal()?.querySelector(".track-editor-dialog");
let lastTouchY = 0;

function isOpen() {
    const element = modal();
    return Boolean(element && !element.hidden);
}

function readCssPixels(name) {
    const raw = getComputedStyle(document.documentElement)
        .getPropertyValue(name)
        .trim();
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) ? value : 0;
}

function isTelegramContext() {
    return document.documentElement.dataset.telegramMiniApp === "true" ||
        Boolean(window.Telegram?.WebApp);
}

function getTelegramSafeTop() {
    const webApp = window.Telegram?.WebApp;
    const cssTop = Math.max(
        readCssPixels("--tg-content-safe-area-inset-top"),
        readCssPixels("--tg-safe-area-inset-top")
    );
    const apiTop = Math.max(
        Number(webApp?.contentSafeAreaInset?.top) || 0,
        Number(webApp?.safeAreaInset?.top) || 0
    );
    if (!isTelegramContext()) return Math.max(cssTop, apiTop, 0);
    return Math.max(cssTop, apiTop, 92);
}

function syncGeometry() {
    const element = modal();
    const sheet = dialog();
    if (!element || !sheet || window.innerWidth > 768) return;

    const safeTop = getTelegramSafeTop();
    document.documentElement.style.setProperty(
        "--pojid-tg-editor-safe-top",
        `${safeTop}px`
    );

    element.style.top = `${safeTop}px`;
    element.style.bottom = "0";
    element.style.height = "auto";
    sheet.style.maxHeight = `calc(100dvh - ${safeTop}px - 8px)`;
}

function moveFocusOffInputs() {
    if (!isOpen()) return;
    const element = modal();
    const active = document.activeElement;
    if (
        active &&
        element.contains(active) &&
        active.matches("input, textarea, select, [contenteditable='true']")
    ) {
        active.blur();
    }
    element.querySelector("[data-close-track-editor]")
        ?.focus?.({ preventScroll: true });
}

function syncOpenState() {
    syncGeometry();
    if (isOpen()) requestAnimationFrame(moveFocusOffInputs);
}

document.addEventListener("touchstart", (event) => {
    if (!isOpen()) return;
    lastTouchY = event.touches?.[0]?.clientY ?? 0;
}, { passive: true, capture: true });

document.addEventListener("touchmove", (event) => {
    if (!isOpen()) return;
    const sheet = dialog();
    if (!sheet || !sheet.contains(event.target)) {
        event.preventDefault();
        return;
    }

    const y = event.touches?.[0]?.clientY ?? lastTouchY;
    const deltaY = y - lastTouchY;
    const atTop = sheet.scrollTop <= 0;
    const atBottom = sheet.scrollTop + sheet.clientHeight >= sheet.scrollHeight - 1;

    if ((atTop && deltaY > 0) || (atBottom && deltaY < 0)) {
        event.preventDefault();
    }
    lastTouchY = y;
}, { passive: false, capture: true });

document.addEventListener("wheel", (event) => {
    if (!isOpen()) return;
    const sheet = dialog();
    if (!sheet?.contains(event.target)) event.preventDefault();
}, { passive: false, capture: true });

const observer = new MutationObserver(syncOpenState);
function connect() {
    const element = modal();
    if (!element) return;
    observer.observe(element, {
        attributes: true,
        attributeFilter: ["hidden"]
    });
    syncOpenState();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", connect, { once: true });
} else {
    connect();
}

window.addEventListener("resize", syncGeometry, { passive: true });
window.addEventListener("orientationchange", syncGeometry, { passive: true });

const webApp = window.Telegram?.WebApp;
["viewportChanged", "safeAreaChanged", "contentSafeAreaChanged"].forEach((name) => {
    try {
        webApp?.onEvent?.(name, syncGeometry);
    } catch {}
});
