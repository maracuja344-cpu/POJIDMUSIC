const MOBILE_QUERY = "(max-width: 932px)";
const CLOSE_MS = 285;
const SWIPE_CLOSE_DISTANCE = 96;
const SWIPE_CLOSE_VELOCITY = 0.62;

let initialized = false;
let closingTimer = null;
let drag = null;

function isMobileQueue() {
    return window.matchMedia(MOBILE_QUERY).matches &&
        document.documentElement.classList.contains("mobile-device");
}

function getSheet() {
    return document.querySelector(".player-queue-sheet");
}

function getPanel() {
    return getSheet()?.querySelector(".player-queue-panel") || null;
}

function getQueueButton() {
    return document.querySelector(".fullscreen-queue-button");
}

function finishClose({ restoreFocus = true } = {}) {
    const sheet = getSheet();
    const panel = getPanel();
    if (!sheet) return;

    window.clearTimeout(closingTimer);
    closingTimer = null;
    sheet.classList.remove("pojid-queue-closing", "pojid-queue-dragging");
    panel?.style.removeProperty("transform");
    panel?.style.removeProperty("opacity");
    sheet.hidden = true;
    sheet.setAttribute("aria-modal", "false");
    document.body.classList.remove("player-queue-open");

    const button = getQueueButton();
    button?.classList.remove("is-active");
    button?.setAttribute("aria-expanded", "false");
    if (restoreFocus) button?.focus({ preventScroll: true });
}

function requestClose({ restoreFocus = true } = {}) {
    const sheet = getSheet();
    if (!sheet || sheet.hidden) return;
    if (!isMobileQueue()) {
        finishClose({ restoreFocus });
        return;
    }

    if (sheet.classList.contains("pojid-queue-closing")) return;
    sheet.classList.remove("pojid-queue-dragging");
    getPanel()?.style.removeProperty("transform");
    getPanel()?.style.removeProperty("opacity");
    sheet.classList.add("pojid-queue-closing");
    closingTimer = window.setTimeout(
        () => finishClose({ restoreFocus }),
        CLOSE_MS
    );
}

function resetDrag() {
    const sheet = getSheet();
    const panel = getPanel();
    sheet?.classList.remove("pojid-queue-dragging");
    if (panel) {
        panel.style.transition = "transform 220ms cubic-bezier(.22,.8,.28,1), opacity 180ms ease";
        panel.style.transform = "translateY(0)";
        panel.style.opacity = "1";
        window.setTimeout(() => {
            panel.style.removeProperty("transition");
            panel.style.removeProperty("transform");
            panel.style.removeProperty("opacity");
        }, 230);
    }
    drag = null;
}

function beginDrag(event) {
    if (!isMobileQueue()) return;
    const sheet = getSheet();
    const panel = getPanel();
    const list = sheet?.querySelector(".player-queue-list");
    if (!sheet || sheet.hidden || !panel) return;
    if (event.touches?.length !== 1) return;

    const touch = event.touches[0];
    const panelRect = panel.getBoundingClientRect();
    const isHandleZone = touch.clientY <= panelRect.top + 82;
    const listAtTop = !list || list.scrollTop <= 0;
    if (!isHandleZone && !listAtTop) return;

    drag = {
        startY: touch.clientY,
        lastY: touch.clientY,
        startTime: performance.now(),
        active: false,
        listAtTop
    };
}

function moveDrag(event) {
    if (!drag || event.touches?.length !== 1) return;
    const panel = getPanel();
    const sheet = getSheet();
    if (!panel || !sheet) return;

    const y = event.touches[0].clientY;
    const delta = Math.max(0, y - drag.startY);
    drag.lastY = y;

    if (delta < 5) return;
    drag.active = true;
    sheet.classList.add("pojid-queue-dragging");
    event.preventDefault();

    const eased = delta > 220 ? 220 + (delta - 220) * 0.35 : delta;
    panel.style.transform = `translateY(${eased}px)`;
    panel.style.opacity = String(Math.max(0.55, 1 - eased / 520));
}

function endDrag() {
    if (!drag) return;
    const distance = Math.max(0, drag.lastY - drag.startY);
    const elapsed = Math.max(1, performance.now() - drag.startTime);
    const velocity = distance / elapsed;
    const shouldClose = drag.active && (
        distance >= SWIPE_CLOSE_DISTANCE ||
        velocity >= SWIPE_CLOSE_VELOCITY
    );

    if (shouldClose) {
        drag = null;
        requestClose({ restoreFocus: false });
    } else {
        resetDrag();
    }
}

function handleCaptureClick(event) {
    if (!isMobileQueue()) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const close = target.closest(".player-queue-sheet [data-close-player-queue]");
    if (!close) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    requestClose();
}

function observeOpenState() {
    const sheet = getSheet();
    if (!sheet) return;

    const observer = new MutationObserver(() => {
        if (!sheet.hidden) {
            window.clearTimeout(closingTimer);
            closingTimer = null;
            sheet.classList.remove("pojid-queue-closing", "pojid-queue-dragging");
            const panel = getPanel();
            panel?.style.removeProperty("transition");
            panel?.style.removeProperty("transform");
            panel?.style.removeProperty("opacity");
        }
    });
    observer.observe(sheet, { attributes: true, attributeFilter: ["hidden"] });
}

export function initializeQueueSheetMotion() {
    if (initialized) return;
    initialized = true;

    document.addEventListener("click", handleCaptureClick, true);
    const sheet = getSheet();
    if (!sheet) return;

    sheet.addEventListener("touchstart", beginDrag, { passive: true });
    sheet.addEventListener("touchmove", moveDrag, { passive: false });
    sheet.addEventListener("touchend", endDrag, { passive: true });
    sheet.addEventListener("touchcancel", resetDrag, { passive: true });
    observeOpenState();
}

initializeQueueSheetMotion();
