import { supabase } from "./supabase/client.js";
import { SUPABASE_URL } from "./supabase/config.js";

const TELEGRAM_AUTH_URL = `${SUPABASE_URL}/functions/v1/telegram-auth`;

let initialized = false;
let telegramInitData = "";
let telegramLinkPending = false;
let telegramAccountLinked = false;

export function getTelegramInitData() {
    const sdkValue = window.Telegram?.WebApp?.initData;
    if (typeof sdkValue === "string" && sdkValue.trim()) return sdkValue.trim();

    const hash = window.location.hash.startsWith("#")
        ? window.location.hash.slice(1)
        : window.location.hash;
    const launchParams = new URLSearchParams(hash);
    return String(launchParams.get("tgWebAppData") || "").trim();
}

export function isTelegramMiniApp() {
    return Boolean(getTelegramInitData());
}

function markTelegramEnvironment() {
    const root = document.documentElement;
    root.classList.add("telegram-mini-app");
    root.dataset.telegramMiniApp = "true";
}

function setAuthMessage(text, type = "") {
    const message = document.querySelector(".auth-message");
    if (!message) return;
    message.textContent = text;
    message.classList.toggle("is-error", type === "error");
    message.classList.toggle("is-success", type === "success");
    message.hidden = !text;
}

/* Old markup can survive in an installed PWA cache. Registration itself is
   listener-only in auth.js; this only prevents a stale Artist selector flash. */
function removeLegacyRoleChoice() {
    const select = document.querySelector(".auth-signup-form [name='account_type']");
    if (!select) return;
    const label = select.id ? document.querySelector(`label[for='${select.id}']`) : null;
    label?.remove();
    select.remove();
}

async function callTelegramAuth(action, accessToken = "") {
    telegramInitData ||= getTelegramInitData();
    const headers = { "Content-Type": "application/json" };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

    const response = await fetch(TELEGRAM_AUTH_URL, {
        method: "POST",
        headers,
        cache: "no-store",
        body: JSON.stringify({ action, initData: telegramInitData })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(payload?.error || "Telegram auth failed");
        error.status = response.status;
        throw error;
    }
    return payload;
}

async function consumeTelegramSession(payload) {
    if (!payload?.token_hash) return false;
    const { data, error } = await supabase.auth.verifyOtp({
        token_hash: payload.token_hash,
        type: payload.otp_type || "email"
    });
    if (error || !data.session) throw error || new Error("Telegram session was not created");
    telegramAccountLinked = true;
    return true;
}

export async function linkCurrentTelegramAccount() {
    if (!isTelegramMiniApp() || telegramLinkPending) return false;
    const { data, error } = await supabase.auth.getSession();
    const session = data?.session;
    if (error || !session?.access_token) return false;

    telegramLinkPending = true;
    try {
        await callTelegramAuth("link", session.access_token);
        telegramAccountLinked = true;
        window.dispatchEvent(new CustomEvent("pojidmusic:telegram-link-changed", {
            detail: { linked: true }
        }));
        return true;
    } catch (error) {
        if (error?.status === 409) {
            const conflict = new Error("Этот Telegram уже привязан к другому аккаунту POJIDMUSIC.");
            conflict.code = "link_conflict";
            throw conflict;
        }
        throw error;
    } finally {
        telegramLinkPending = false;
    }
}

function ensureTelegramChoiceButton() {
    const loginForm = document.querySelector(".auth-login-form");
    if (!loginForm || document.querySelector("[data-telegram-register]")) return;

    const choice = document.createElement("div");
    choice.className = "telegram-auth-choice";
    choice.dataset.telegramAuthChoice = "true";

    const hint = document.createElement("p");
    hint.textContent = "Есть аккаунт? Войди выше. После входа Telegram можно привязать в профиле.";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "auth-submit-button";
    button.dataset.telegramRegister = "true";
    button.textContent = "Создать аккаунт через Telegram";
    button.addEventListener("click", async () => {
        if (button.disabled) return;
        button.disabled = true;
        setAuthMessage("Создаём аккаунт через Telegram…");
        try {
            const payload = await callTelegramAuth("register");
            await consumeTelegramSession(payload);
            setAuthMessage("Готово. Вы вошли через Telegram.", "success");
            document.querySelector("[data-auth-close]")?.click();
        } catch (error) {
            setAuthMessage(
                error?.status === 409
                    ? "Этот Telegram уже связан с аккаунтом. Попробуйте войти в существующий аккаунт."
                    : "Не удалось войти через Telegram. Попробуйте ещё раз.",
                "error"
            );
        } finally {
            button.disabled = false;
        }
    });

    choice.append(hint, button);
    loginForm.append(choice);
}

function showTelegramLinkChoice() {
    const reveal = () => {
        const controls = document.querySelector(".auth-controls");
        const openButton = document.querySelector(".auth-open-button");
        if (!controls || !openButton || controls.dataset.authReady !== "true") {
            setTimeout(reveal, 120);
            return;
        }
        ensureTelegramChoiceButton();
        if (!openButton.hidden) {
            openButton.click();
            setAuthMessage(
                "Этот Telegram ещё не связан с POJIDMUSIC. Войди в существующий аккаунт или создай новый.",
                ""
            );
        }
    };
    reveal();
}

async function initializeTelegramAuth() {
    telegramInitData = getTelegramInitData();
    if (!telegramInitData) return;
    markTelegramEnvironment();

    try {
        const bootstrap = await callTelegramAuth("bootstrap");
        if (bootstrap?.status === "linked") {
            await consumeTelegramSession(bootstrap);
            return;
        }

        const { data } = await supabase.auth.getSession();
        if (!data.session) showTelegramLinkChoice();
        else window.dispatchEvent(new CustomEvent("pojidmusic:telegram-link-available"));
    } catch (error) {
        console.warn("Telegram auth bootstrap failed", error);
        const { data } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
        if (!data?.session) showTelegramLinkChoice();
    }
}

export function initializeAccountAuthGuard() {
    if (initialized) return;
    initialized = true;
    removeLegacyRoleChoice();
    if (isTelegramMiniApp()) void initializeTelegramAuth();
}
