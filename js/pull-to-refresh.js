import {
    isMobileDevice,
    isStandaloneMode
} from "./mobile.js";

const TOP_TOLERANCE_PX = 2;
const DIRECTION_LOCK_PX = 8;
const PULL_THRESHOLD_PX = 72;
const MAX_INDICATOR_PULL_PX = 96;
const VERTICAL_DOMINANCE_RATIO = 1.25;
const BLOCKED_TARGET_SELECTOR = [
    ".recommendations-viewport",
    ".player-progress",
    ".fullscreen-player-progress",
    "input[type='range']",
    ".profile-menu",
    "[role='dialog']"
].join(", ");

function hasBlockingOverlay() {
    return (
        document.body.classList.contains(
            "fullscreen-player-open"
        ) ||
        document.body.classList.contains("auth-modal-open") ||
        document.body.classList.contains(
            "track-upload-modal-open"
        ) ||
        Boolean(
            document.querySelector(
                ".auth-modal:not([hidden]), " +
                ".track-upload-modal:not([hidden])"
            )
        )
    );
}

export function initializePullToRefresh({
    refreshCatalog,
    getIsRefreshing
}) {
    const indicator = document.querySelector(
        ".pull-to-refresh"
    );
    const indicatorLabel = indicator?.querySelector(
        ".pull-to-refresh-label"
    );

    if (
        !indicator ||
        !isMobileDevice() ||
        typeof refreshCatalog !== "function" ||
        indicator.dataset.initialized === "true"
    ) {
        return;
    }

    const isUninstalledIosSafari =
        document.documentElement.classList.contains(
            "ios-safari"
        ) && !isStandaloneMode();

    if (isUninstalledIosSafari) return;

    indicator.dataset.initialized = "true";

    let tracking = false;
    let directionLocked = false;
    let cancelled = false;
    let ready = false;
    let startX = 0;
    let startY = 0;
    let hideTimer = null;

    function setState(state, pullDistance = 0) {
        const labels = {
            idle: "",
            pulling: "Потяните для обновления",
            ready: "Отпустите для обновления",
            refreshing: "Обновляем",
            success: "Каталог обновлён",
            error: "Не удалось обновить"
        };

        indicator.dataset.state = state;
        indicator.style.setProperty(
            "--pull-distance",
            `${Math.round(pullDistance)}px`
        );
        indicator.style.setProperty(
            "--pull-progress",
            String(
                Math.min(
                    pullDistance / PULL_THRESHOLD_PX,
                    1
                )
            )
        );
        indicator.setAttribute(
            "aria-hidden",
            state === "idle" ? "true" : "false"
        );

        if (indicatorLabel) {
            indicatorLabel.textContent = labels[state] ?? "";
        }
    }

    function resetGesture(delay = 0) {
        window.clearTimeout(hideTimer);
        hideTimer = window.setTimeout(() => {
            setState("idle", 0);
        }, delay);

        tracking = false;
        directionLocked = false;
        cancelled = false;
        ready = false;
    }

    document.addEventListener(
        "touchstart",
        (event) => {
            if (
                event.touches.length !== 1 ||
                window.scrollY > TOP_TOLERANCE_PX ||
                getIsRefreshing?.() ||
                hasBlockingOverlay() ||
                (
                    event.target instanceof Element &&
                    event.target.closest(BLOCKED_TARGET_SELECTOR)
                )
            ) {
                return;
            }

            const touch = event.touches[0];
            tracking = true;
            directionLocked = false;
            cancelled = false;
            ready = false;
            startX = touch.clientX;
            startY = touch.clientY;
        },
        { passive: true }
    );

    document.addEventListener(
        "touchmove",
        (event) => {
            if (!tracking || cancelled || event.touches.length !== 1) {
                return;
            }

            const touch = event.touches[0];
            const deltaX = touch.clientX - startX;
            const deltaY = touch.clientY - startY;
            const absX = Math.abs(deltaX);
            const absY = Math.abs(deltaY);

            if (
                deltaY <= 0 ||
                window.scrollY > TOP_TOLERANCE_PX ||
                hasBlockingOverlay()
            ) {
                cancelled = true;
                setState("idle", 0);
                return;
            }

            if (!directionLocked) {
                if (
                    Math.max(absX, absY) < DIRECTION_LOCK_PX
                ) {
                    return;
                }

                if (
                    absY < absX * VERTICAL_DOMINANCE_RATIO
                ) {
                    cancelled = true;
                    setState("idle", 0);
                    return;
                }

                directionLocked = true;
            } else if (absX > absY) {
                cancelled = true;
                setState("idle", 0);
                return;
            }

            if (event.cancelable) {
                event.preventDefault();
            }

            const pullDistance = Math.min(
                deltaY * 0.55,
                MAX_INDICATOR_PULL_PX
            );

            ready = pullDistance >= PULL_THRESHOLD_PX;
            setState(
                ready ? "ready" : "pulling",
                pullDistance
            );
        },
        { passive: false }
    );

    document.addEventListener(
        "touchend",
        () => {
            if (!tracking) return;

            const shouldRefresh =
                directionLocked && !cancelled && ready;

            if (!shouldRefresh) {
                resetGesture();
                return;
            }

            tracking = false;
            setState("refreshing", PULL_THRESHOLD_PX);

            void refreshCatalog({
                force: true,
                source: "pull"
            }).then((result) => {
                if (result?.status === "error") {
                    setState("error", PULL_THRESHOLD_PX);
                    resetGesture(1400);
                    return;
                }

                if (result?.status === "updated") {
                    setState("success", PULL_THRESHOLD_PX);
                    resetGesture(900);
                    return;
                }

                resetGesture(250);
            });
        },
        { passive: true }
    );

    document.addEventListener(
        "touchcancel",
        () => {
            if (tracking) resetGesture();
        },
        { passive: true }
    );
}
