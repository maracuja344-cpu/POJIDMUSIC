import { getCurrentAuthState, subscribeToAuthState } from "./auth.js";
import { supabase } from "./supabase/client.js";

let initialized = false;
let activeUserId = null;
let activeRole = null;

function ensureMobileAdminButton() {
    const actions = document.querySelector("[data-account-actions]");
    if (!actions) return null;

    let button = actions.querySelector("[data-admin-mobile-open]");
    if (button) return button;

    button = document.createElement("button");
    button.type = "button";
    button.className = "profile-action-button admin-mobile-action";
    button.dataset.adminMobileOpen = "";
    button.dataset.adminPanelOpen = "";
    button.hidden = true;
    button.innerHTML = '<span class="admin-mobile-label">Admin</span><span class="admin-mobile-count" data-admin-mobile-count hidden></span>';

    const feedback = actions.querySelector("[data-open-feedback]");
    if (feedback) actions.insertBefore(button, feedback);
    else actions.append(button);

    return button;
}

async function refreshUnreadCount() {
    const button = ensureMobileAdminButton();
    const badge = button?.querySelector("[data-admin-mobile-count]");
    if (!button || !badge || activeRole !== "admin" || !activeUserId) return;

    const { count, error } = await supabase
        .from("admin_notifications")
        .select("id", { count: "exact", head: true })
        .is("read_at", null);

    if (error) {
        badge.hidden = true;
        return;
    }

    const value = Number(count || 0);
    badge.textContent = value > 99 ? "99+" : String(value);
    badge.hidden = value < 1;
}

function sync(authState) {
    activeUserId = authState?.user?.id || null;
    activeRole = authState?.profile?.role || null;

    const button = ensureMobileAdminButton();
    if (!button) return;

    button.hidden = activeRole !== "admin";
    if (activeRole === "admin") void refreshUnreadCount();
}

export function initializeAdminMobileBridge() {
    if (initialized) return;
    initialized = true;

    subscribeToAuthState(sync);
    sync(getCurrentAuthState());

    window.addEventListener("managedtrackchange", () => {
        if (activeRole === "admin") window.setTimeout(refreshUnreadCount, 180);
    });

    document.addEventListener("click", (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target?.closest("[data-admin-mark-read]")) return;
        window.setTimeout(refreshUnreadCount, 250);
    });
}

initializeAdminMobileBridge();
