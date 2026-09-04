import {
    createClient
} from "https://esm.sh/@supabase/supabase-js@2.112.2?bundle";

import {
    SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_URL
} from "./config.js";

const TELEGRAM_AUTH_URL = `${SUPABASE_URL}/functions/v1/telegram-auth`;
const TELEGRAM_AUTH_TIMEOUT_MS = 8000;
const TELEGRAM_INTERNAL_EMAIL = /^telegram-\d+@auth\.pojidmusic\.invalid$/i;
const TELEGRAM_INITDATA_SESSION_KEY = "pojidmusic:telegram-init-data";

const telegramProfileStyles = document.createElement("link");
telegramProfileStyles.rel = "stylesheet";
telegramProfileStyles.href = new URL("../../telegram-profile.css", import.meta.url).href;
document.head.append(telegramProfileStyles);

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

function readTelegramInitDataFromHash() {
    const hash = location.hash.startsWith("#") ? location.hash.slice(1) : location.hash;
    const params = new URLSearchParams(hash);
    const value = params.get("tgWebAppData");
    return typeof value === "string" ? value.trim() : "";
}

function cacheTelegramInitData(value) {
    if (!value) return;
    try { sessionStorage.setItem(TELEGRAM_INITDATA_SESSION_KEY, value); } catch {}
}

function getTelegramInitData() {
    const injectedInitData = window.Telegram?.WebApp?.initData;
    if (typeof injectedInitData === "string" && injectedInitData.trim()) {
        const value = injectedInitData.trim();
        cacheTelegramInitData(value);
        return value;
    }

    const hashInitData = readTelegramInitDataFromHash();
    if (hashInitData) {
        cacheTelegramInitData(hashInitData);
        return hashInitData;
    }

    try {
        return sessionStorage.getItem(TELEGRAM_INITDATA_SESSION_KEY)?.trim() || "";
    } catch {
        return "";
    }
}

const initialTelegramInitData = getTelegramInitData();
if (initialTelegramInitData || window.Telegram?.WebApp) {
    document.documentElement.dataset.telegramMiniApp = "true";
}

async function requestTelegramAuth(action, initData, accessToken = null) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), TELEGRAM_AUTH_TIMEOUT_MS);
    try {
        const response = await fetch(TELEGRAM_AUTH_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "apikey": SUPABASE_PUBLISHABLE_KEY,
                ...(accessToken ? { "Authorization": `Bearer ${accessToken}` } : {})
            },
            body: JSON.stringify({ action, initData }),
            cache: "no-store",
            signal: controller.signal
        });
        let payload = null;
        try { payload = await response.json(); } catch {}
        return { ok: response.ok, status: response.status, payload };
    } finally {
        window.clearTimeout(timeoutId);
    }
}

async function establishTelegramSession(payload) {
    if (payload?.status !== "linked" || typeof payload.token_hash !== "string" || !payload.token_hash) return false;
    const { data, error } = await supabase.auth.verifyOtp({ token_hash: payload.token_hash, type: "email" });
    if (error || !data.session || !data.user) throw error || new Error("Telegram session exchange failed");
    return true;
}

async function bootstrapTelegramAuth() {
    const initData = getTelegramInitData();
    if (!initData) return;

    document.documentElement.dataset.telegramMiniApp = "true";
    try { window.Telegram?.WebApp?.ready?.(); } catch {}

    const { data: sessionData } = await supabase.auth.getSession();
    const existingSession = sessionData?.session || null;

    if (existingSession?.access_token) {
        const linkResult = await requestTelegramAuth("link", initData, existingSession.access_token);
        if (linkResult.ok) return;
        if (![401, 409].includes(linkResult.status)) throw new Error(`Telegram link failed (${linkResult.status})`);
    }

    let result = await requestTelegramAuth("bootstrap", initData);
    if (!result.ok) throw new Error(`Telegram bootstrap failed (${result.status})`);

    if (result.payload?.status === "unlinked") {
        result = await requestTelegramAuth("register", initData);
        if (!result.ok && result.status === 409) result = await requestTelegramAuth("bootstrap", initData);
    }

    if (!result.ok) throw new Error(`Telegram registration failed (${result.status})`);
    await establishTelegramSession(result.payload);
}

function createTelegramRelinkModal() {
    const existing = document.querySelector("[data-telegram-relink-modal]");
    if (existing) return existing;

    const modal = document.createElement("div");
    modal.className = "auth-modal";
    modal.hidden = true;
    modal.dataset.telegramRelinkModal = "true";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.innerHTML = `
        <div class="auth-modal-backdrop" data-telegram-relink-close></div>
        <div class="auth-dialog">
            <div class="auth-dialog-header">
                <h2>Привязать аккаунт</h2>
                <button class="auth-close-button" type="button" data-telegram-relink-close aria-label="Закрыть">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6L18 18M18 6L6 18"></path></svg>
                </button>
            </div>
            <p class="auth-message" data-telegram-relink-message>Войди в уже существующий POJIDMUSIC-аккаунт. Этот Telegram будет привязан к нему вместо временного профиля слушателя.</p>
            <form class="auth-form" data-telegram-relink-form>
                <label>Email</label><input name="email" type="email" autocomplete="email" required>
                <label>Пароль</label><input name="password" type="password" autocomplete="current-password" required>
                <button class="auth-submit-button" type="submit">Привязать Telegram</button>
            </form>
        </div>`;
    document.body.append(modal);
    return modal;
}

function getTelegramRelinkMessage(error, status) {
    const message = String(error?.message || "").toLowerCase();
    if (message.includes("invalid login credentials")) return "Неверный email или пароль.";
    if (status === 401) return "Telegram-сессия устарела. Закрой Mini App и открой его заново через бота.";
    if (status === 409) return "Этот аккаунт уже привязан к другому Telegram либо текущую привязку нельзя безопасно заменить.";
    return "Не удалось привязать аккаунт. Попробуй ещё раз.";
}

function replaceLocationPreservingTelegram(search = "") {
    const hash = window.location.hash || "";
    window.location.replace(`${window.location.pathname}${search}${hash}`);
}

function decorateTelegramRelinkButton(button) {
    if (!button || button.dataset.profileDecorated === "true") return;
    button.dataset.profileDecorated = "true";
    button.innerHTML = `
        <span class="profile-action-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
                <path d="M9.5 14.5l5-5"></path>
                <path d="M7.4 16.6l-1.7 1.7a3.5 3.5 0 0 0 5 5l3.5-3.5a3.5 3.5 0 0 0 0-5"></path>
                <path d="M16.6 7.4l1.7-1.7a3.5 3.5 0 1 0-5-5L9.8 4.2a3.5 3.5 0 0 0 0 5"></path>
            </svg>
        </span>
        <span class="profile-action-copy">
            <span class="profile-action-title">Привязать существующий аккаунт</span>
            <span class="profile-action-subtitle">Войти по email и паролю</span>
        </span>
        <span class="profile-action-chevron" aria-hidden="true">›</span>`;
}

async function initializeTelegramRelinkUi() {
    const initData = getTelegramInitData();
    if (!initData) return;

    const mountButton = async () => {
        const actions = document.querySelector("[data-account-actions]");
        if (!actions) return;
        let button = actions.querySelector("[data-telegram-relink-open]");
        if (!button) {
            button = document.createElement("button");
            button.type = "button";
            button.className = "profile-action-button";
            button.dataset.telegramRelinkOpen = "true";
            actions.prepend(button);
        }
        decorateTelegramRelinkButton(button);
        const { data } = await supabase.auth.getSession();
        button.hidden = !TELEGRAM_INTERNAL_EMAIL.test(data.session?.user?.email || "");
    };

    const openModal = () => {
        const modal = createTelegramRelinkModal();
        modal.hidden = false;
        document.body.classList.add("auth-modal-open");
        modal.querySelector("input")?.focus();
    };
    const closeModal = () => {
        const modal = document.querySelector("[data-telegram-relink-modal]");
        if (!modal) return;
        modal.hidden = true;
        document.body.classList.remove("auth-modal-open");
    };

    document.addEventListener("click", (event) => {
        if (event.target.closest("[data-telegram-relink-open]")) { event.preventDefault(); openModal(); return; }
        if (event.target.closest("[data-telegram-relink-close]")) { event.preventDefault(); closeModal(); }
    });

    document.addEventListener("submit", async (event) => {
        const form = event.target.closest("[data-telegram-relink-form]");
        if (!form) return;
        event.preventDefault();
        if (form.dataset.pending === "true" || !form.reportValidity()) return;

        const modal = form.closest("[data-telegram-relink-modal]");
        const message = modal.querySelector("[data-telegram-relink-message]");
        const submit = form.querySelector("[type='submit']");
        const values = new FormData(form);
        const email = String(values.get("email") || "").trim();
        const password = String(values.get("password") || "");
        const { data: previousData } = await supabase.auth.getSession();
        const previousSession = previousData.session;

        form.dataset.pending = "true";
        submit.disabled = true;
        message.hidden = false;
        message.classList.remove("is-error", "is-success");
        message.textContent = "Проверяем аккаунт…";

        try {
            const { data, error } = await supabase.auth.signInWithPassword({ email, password });
            if (error || !data.session || !data.user) throw error || new Error("Login failed");

            message.textContent = "Привязываем Telegram…";
            const result = await requestTelegramAuth("relink", initData, data.session.access_token);

            if (!result.ok) {
                if (previousSession?.access_token && previousSession?.refresh_token) {
                    await supabase.auth.setSession({ access_token: previousSession.access_token, refresh_token: previousSession.refresh_token });
                }
                const relinkError = new Error("Relink failed");
                relinkError.status = result.status;
                throw relinkError;
            }

            message.classList.add("is-success");
            message.textContent = "Готово. Telegram привязан к существующему аккаунту.";
            form.reset();

            const { data: profile } = await supabase.from("profiles").select("id,role").eq("id", data.user.id).maybeSingle();
            if (profile?.role === "artist") {
                const { data: artist } = await supabase.from("artists").select("slug").eq("linked_profile_id", data.user.id).maybeSingle();
                if (artist?.slug) {
                    replaceLocationPreservingTelegram(`?artist=${encodeURIComponent(artist.slug)}`);
                    return;
                }
            }

            replaceLocationPreservingTelegram();
        } catch (error) {
            message.classList.add("is-error");
            message.textContent = getTelegramRelinkMessage(error, error?.status);
        } finally {
            form.dataset.pending = "false";
            submit.disabled = false;
        }
    });

    const observer = new MutationObserver(() => void mountButton());
    observer.observe(document.body, { childList: true, subtree: true });
    supabase.auth.onAuthStateChange(() => void mountButton());
    await mountButton();
}

export const telegramAuthReady = bootstrapTelegramAuth().catch((error) => {
    console.error("Не удалось выполнить автоматический вход через Telegram.", error);
});

void telegramAuthReady.finally(() => {
    void initializeTelegramRelinkUi();
});
