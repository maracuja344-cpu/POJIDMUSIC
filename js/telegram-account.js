import { getCurrentAuthState, subscribeToAuthState } from "./auth.js";
import { isTelegramMiniApp, linkCurrentTelegramAccount } from "./account-auth-guard.js";
import { SUPABASE_URL } from "./supabase/config.js";

const TELEGRAM_AUTH_URL = `${SUPABASE_URL}/functions/v1/telegram-auth`;

let initialized = false;
let requestGeneration = 0;
let currentStatus = null;

function accountSurface() {
    return document.querySelector("#account-profile .profile-surface");
}

function ensureTelegramDetail() {
    const details = accountSurface()?.querySelector(".account-profile-details");
    if (!details) return null;

    let row = details.querySelector("[data-account-telegram]");
    if (row) return row;

    row = document.createElement("div");
    row.dataset.accountTelegram = "";
    row.hidden = true;
    row.innerHTML = '<dt>Telegram</dt><dd data-account-telegram-value>—</dd>';
    details.append(row);
    return row;
}

function telegramLaunchLabel() {
    const user = window.Telegram?.WebApp?.initDataUnsafe?.user;
    const username = typeof user?.username === "string" ? user.username.trim() : "";
    const displayName = [user?.first_name, user?.last_name]
        .filter((value) => typeof value === "string" && value.trim())
        .join(" ")
        .trim();
    if (username) return `@${username}`;
    return displayName || "текущий Telegram";
}

function ensureLinkButton() {
    const actions = accountSurface()?.querySelector("[data-account-actions]");
    if (!actions) return null;

    let button = actions.querySelector("[data-telegram-link-action]");
    if (!button) {
        button = document.createElement("button");
        button.type = "button";
        button.className = "profile-action-button telegram-link-action";
        button.dataset.telegramLinkAction = "";
        button.innerHTML = `
            <span class="profile-action-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M21 4 3.8 10.6c-.9.35-.88.9-.16 1.12l4.4 1.37 1.7 5.24c.21.58.1.81.73.81.49 0 .7-.22.97-.48l2.12-2.06 4.42 3.27c.81.45 1.4.22 1.6-.75L22.3 5.9C22.58 4.76 21.86 4.24 21 4Z"></path></svg>
            </span>
            <span class="profile-action-copy">
                <span class="profile-action-title">Привязать Telegram</span>
                <span class="profile-action-subtitle" data-telegram-link-subtitle></span>
            </span>
            <span class="profile-action-chevron" aria-hidden="true">›</span>`;
        button.addEventListener("click", handleLinkClick);
        actions.append(button);
    }

    button.querySelector("[data-telegram-link-subtitle]").textContent = telegramLaunchLabel();
    const anchor = actions.querySelector("[data-admin-mobile-open]") || actions.querySelector("[data-open-feedback]");
    if (anchor && button.nextElementSibling !== anchor) actions.insertBefore(button, anchor);
    return button;
}

function setProfileMessage(text = "", isError = false) {
    const message = accountSurface()?.querySelector(".profile-form-message");
    if (!message) return;
    message.textContent = text;
    message.classList.toggle("is-error", isError);
}

function telegramIdentityText(telegram) {
    const username = typeof telegram?.username === "string" && telegram.username.trim()
        ? `@${telegram.username.trim()}`
        : "";
    const displayName = typeof telegram?.display_name === "string"
        ? telegram.display_name.trim()
        : "";
    if (username && displayName && username.toLowerCase() !== `@${displayName.toLowerCase()}`) {
        return `${username} · ${displayName}`;
    }
    return username || displayName || "Привязан";
}

function renderStatus(status) {
    currentStatus = status;
    const detail = ensureTelegramDetail();
    const value = detail?.querySelector("[data-account-telegram-value]");
    const linkButton = ensureLinkButton();

    if (status?.linked) {
        if (detail && value) {
            value.textContent = telegramIdentityText(status.telegram);
            detail.hidden = false;
        }
        if (linkButton) linkButton.hidden = true;
        return;
    }

    if (detail) detail.hidden = true;
    if (linkButton) linkButton.hidden = !isTelegramMiniApp();
}

async function fetchStatus(state = getCurrentAuthState()) {
    const session = state?.session;
    if (!session?.access_token || !state?.user?.id) {
        renderStatus(null);
        return;
    }

    const generation = ++requestGeneration;
    try {
        const response = await fetch(TELEGRAM_AUTH_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${session.access_token}`
            },
            cache: "no-store",
            body: JSON.stringify({ action: "status" })
        });
        if (!response.ok) throw new Error(`Telegram status HTTP ${response.status}`);
        const payload = await response.json();
        if (generation !== requestGeneration) return;
        renderStatus(payload);
    } catch (error) {
        if (generation !== requestGeneration) return;
        console.warn("Не удалось получить статус Telegram-привязки.", error);
        renderStatus(null);
    }
}

async function handleLinkClick(event) {
    const button = event.currentTarget;
    if (!(button instanceof HTMLButtonElement) || button.disabled) return;
    button.disabled = true;
    setProfileMessage("Привязываем Telegram…");
    try {
        const linked = await linkCurrentTelegramAccount();
        if (!linked) throw new Error("Telegram link is unavailable");
        await fetchStatus();
        setProfileMessage("Telegram привязан.");
    } catch (error) {
        setProfileMessage(
            error?.code === "link_conflict"
                ? error.message
                : "Не удалось привязать Telegram. Открой POJIDMUSIC заново и попробуй ещё раз.",
            true
        );
    } finally {
        button.disabled = false;
    }
}

function keepPlacementCurrent() {
    if (!getCurrentAuthState().user) return;
    renderStatus(currentStatus);
}

export function initializeTelegramAccountSurface() {
    if (initialized) return;
    initialized = true;

    subscribeToAuthState((state) => {
        if (!state.user) {
            requestGeneration += 1;
            currentStatus = null;
            renderStatus(null);
            return;
        }
        void fetchStatus(state);
    });

    window.addEventListener("pojidmusic:telegram-link-changed", () => void fetchStatus());
    new MutationObserver(keepPlacementCurrent).observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["hidden", "data-app-view"]
    });
    keepPlacementCurrent();
}

initializeTelegramAccountSurface();
