import { getCurrentAuthState, subscribeToAuthState } from "./auth.js";
import { supabase } from "./supabase/client.js";

let initialized = false;
let activeUserId = null;
let activeRole = null;
let profileObserver = null;

const ADMIN_ICON = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 38 38'%3E%3Crect width='38' height='38' rx='11' fill='%23271c36'/%3E%3Cpath d='M19 8.5 28 12v6.6c0 5.4-3.3 9.1-9 11.4-5.7-2.3-9-6-9-11.4V12z' fill='none' stroke='%23bd8dff' stroke-width='2' stroke-linejoin='round'/%3E%3Cpath d='m15.5 19 2.3 2.4 4.9-5.1' fill='none' stroke='%23bd8dff' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`;
const CHEVRON_ICON = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 18 18'%3E%3Cpath d='m6 3 6 6-6 6' fill='none' stroke='%23aaa' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`;

function resolvedRole() {
    return activeRole || document.body.dataset.currentProfileRole || null;
}

function ensureMobileAdminButton() {
    const actions = document.querySelector("[data-account-actions]");
    if (!actions) return null;

    let button = actions.querySelector("[data-admin-mobile-open]");
    if (!button) {
        button = document.createElement("button");
        button.type = "button";
        button.className = "profile-action-button admin-mobile-action";
        button.dataset.adminMobileOpen = "";
        button.dataset.adminPanelOpen = "";
        button.hidden = true;
        button.innerHTML = '<span class="admin-mobile-label">Админ</span><span class="admin-mobile-subtitle">Заявки и модерация</span><span class="admin-mobile-count" data-admin-mobile-count hidden></span>';
        actions.append(button);
    }

    button.style.backgroundImage = `${ADMIN_ICON}, ${CHEVRON_ICON}`;
    button.style.backgroundRepeat = "no-repeat, no-repeat";
    button.style.backgroundSize = "38px 38px, 18px 18px";
    button.style.backgroundPosition = "13px center, calc(100% - 15px) center";
    button.style.position = "relative";

    const label = button.querySelector(".admin-mobile-label");
    const subtitle = button.querySelector(".admin-mobile-subtitle");
    const badge = button.querySelector("[data-admin-mobile-count]");
    if (label) {
        label.style.display = "block";
        label.style.width = "100%";
    }
    if (subtitle) {
        subtitle.style.position = "absolute";
        subtitle.style.left = "62px";
        subtitle.style.bottom = "9px";
        subtitle.style.color = "rgba(255,255,255,.42)";
        subtitle.style.fontSize = "12px";
        subtitle.style.fontWeight = "500";
        subtitle.style.lineHeight = "1";
    }
    if (badge) {
        badge.style.position = "absolute";
        badge.style.right = "43px";
        badge.style.top = "50%";
        badge.style.transform = "translateY(-50%)";
        badge.style.minWidth = "20px";
        badge.style.height = "20px";
        badge.style.padding = "0 6px";
        badge.style.borderRadius = "999px";
        badge.style.background = "#fff";
        badge.style.color = "#111";
        badge.style.display = badge.hidden ? "none" : "inline-flex";
        badge.style.alignItems = "center";
        badge.style.justifyContent = "center";
        badge.style.fontSize = "10px";
        badge.style.fontWeight = "700";
    }

    const feedback = actions.querySelector("[data-open-feedback]");
    if (feedback && button.nextElementSibling !== feedback) {
        actions.insertBefore(button, feedback);
    }

    return button;
}

function applyVisibility() {
    const button = ensureMobileAdminButton();
    if (!button) return;
    const isAdmin = resolvedRole() === "admin";
    button.hidden = !isAdmin;
    if (isAdmin) void refreshUnreadCount();
}

async function refreshUnreadCount() {
    const button = ensureMobileAdminButton();
    const badge = button?.querySelector("[data-admin-mobile-count]");
    if (!button || !badge || resolvedRole() !== "admin" || !activeUserId) return;

    const { count, error } = await supabase
        .from("admin_notifications")
        .select("id", { count: "exact", head: true })
        .is("read_at", null);

    if (error) {
        badge.hidden = true;
        badge.style.display = "none";
        return;
    }

    const value = Number(count || 0);
    badge.textContent = value > 99 ? "99+" : String(value);
    badge.hidden = value < 1;
    badge.style.display = badge.hidden ? "none" : "inline-flex";
}

function sync(authState) {
    activeUserId = authState?.user?.id || activeUserId || null;
    activeRole = authState?.profile?.role || document.body.dataset.currentProfileRole || null;
    applyVisibility();
}

function observeProfileSurface() {
    profileObserver?.disconnect();
    profileObserver = new MutationObserver(() => applyVisibility());
    profileObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["data-current-profile-role", "data-app-view", "hidden"]
    });
}

function closeAdminPanelForNavigation() {
    const panel = document.getElementById("pojidmusic-admin-panel");
    if (!panel || panel.hidden) return;

    panel.hidden = true;
    document.documentElement.classList.remove("admin-overlay-open");
    document.body.classList.remove("admin-overlay-open");
}

export function initializeAdminMobileBridge() {
    if (initialized) return;
    initialized = true;

    subscribeToAuthState(sync);
    sync(getCurrentAuthState());
    observeProfileSurface();
    requestAnimationFrame(applyVisibility);
    window.setTimeout(applyVisibility, 250);
    window.setTimeout(applyVisibility, 900);

    window.addEventListener("managedtrackchange", () => {
        if (resolvedRole() === "admin") window.setTimeout(refreshUnreadCount, 180);
    });

    document.addEventListener("click", (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target) return;

        if (target.closest(".mobile-bottom-navigation [data-mobile-tab]")) {
            closeAdminPanelForNavigation();
            return;
        }

        if (target.closest("[data-admin-mark-read]")) {
            window.setTimeout(refreshUnreadCount, 250);
        }
    });
}

initializeAdminMobileBridge();
