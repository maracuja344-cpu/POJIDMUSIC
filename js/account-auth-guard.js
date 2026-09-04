import { supabase } from "./supabase/client.js";
import { SUPABASE_URL } from "./supabase/config.js";

const TELEGRAM_AUTH_URL = `${SUPABASE_URL}/functions/v1/telegram-auth`;

let initialized = false;
let telegramInitData = "";
let telegramLinkPending = false;
let telegramAccountLinked = false;
let authStateSubscription = null;

function getTelegramInitData() {
    const sdkValue = window.Telegram?.WebApp?.initData;
    if (typeof sdkValue === "string" && sdkValue.trim()) {
        return sdkValue.trim();
    }

    const hash = window.location.hash.startsWith("#")
        ? window.location.hash.slice(1)
        : window.location.hash;
    const launchParams = new URLSearchParams(hash);
    return String(launchParams.get("tgWebAppData") || "").trim();
}

function isTelegramMiniApp() {
    return Boolean(getTelegramInitData());
}

function setAuthMessage(text, type = "") {
    const message = document.querySelector(".auth-message");
    if (!message) return;

    message.textContent = text;
    message.classList.toggle("is-error", type === "error");
    message.classList.toggle("is-success", type === "success");
    message.hidden = !text;
}

function removeRoleChoice() {
    const select = document.querySelector(
        ".auth-signup-form [name='account_type']"
    );
    if (!select) return;

    const label = select.id
        ? document.querySelector(`label[for='${select.id}']`)
        : null;
    label?.remove();
    select.remove();
}

function setSignupPending(form, pending) {
    form.dataset.listenerGuardPending = pending ? "true" : "false";
    form.querySelectorAll("input, button").forEach((control) => {
        control.disabled = pending;
    });
}

async function handleListenerOnlySignup(event) {
    const form = event.target.closest?.(".auth-signup-form");
    if (!form) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    if (form.dataset.listenerGuardPending === "true") return;
    if (!form.reportValidity()) return;

    const formData = new FormData(form);
    const displayName = String(formData.get("display_name") || "").trim();
    const email = String(formData.get("email") || "").trim();
    const password = String(formData.get("password") || "");
    const passwordRepeat = String(formData.get("password_repeat") || "");

    if (!displayName || !email) return;
    if (password.length < 8) {
        setAuthMessage("Пароль должен содержать минимум 8 символов.", "error");
        return;
    }
    if (password !== passwordRepeat) {
        setAuthMessage("Пароли не совпадают.", "error");
        return;
    }

    setAuthMessage("");
    setSignupPending(form, true);

    try {
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: {
                data: {
                    display_name: displayName
                }
            }
        });

        if (error || !data.user) {
            const message = String(error?.message || "").toLowerCase();
            setAuthMessage(
                message.includes("already")
                    ? "Аккаунт с таким email уже существует."
                    : "Не удалось зарегистрироваться. Проверьте данные и попробуйте ещё раз.",
                "error"
            );
            return;
        }

        form.reset();
        if (data.session) {
            setAuthMessage(
                "Регистрация завершена. Аккаунт создан как слушатель.",
                "success"
            );
        } else {
            const loginTab = document.querySelector("[data-auth-mode='login']");
            loginTab?.click();
            setAuthMessage(
                "Аккаунт создан как слушатель. Подтвердите email и войдите.",
                "success"
            );
        }
    } catch {
        setAuthMessage("Не удалось зарегистрироваться. Проверьте соединение.", "error");
    } finally {
        setSignupPending(form, false);
    }
}

async function callTelegramAuth(action, accessToken = "") {
    const headers = {
        "Content-Type": "application/json"
    };
    if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
    }

    const response = await fetch(TELEGRAM_AUTH_URL, {
        method: "POST",
        headers,
        cache: "no-store",
        body: JSON.stringify({
            action,
            initData: telegramInitData
        })
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

    if (error || !data.session) {
        throw error || new Error("Telegram session was not created");
    }

    telegramAccountLinked = true;
    return true;
}

async function linkCurrentSession(session) {
    if (
        telegramAccountLinked ||
        telegramLinkPending ||
        !session?.access_token
    ) {
        return false;
    }

    telegramLinkPending = true;
    try {
        await callTelegramAuth("link", session.access_token);
        telegramAccountLinked = true;
        setAuthMessage("Telegram привязан к этому аккаунту.", "success");
        return true;
    } catch (error) {
        if (error?.status === 409) {
            setAuthMessage(
                "Этот Telegram уже привязан к другому аккаунту POJIDMUSIC.",
                "error"
            );
        }
        return false;
    } finally {
        telegramLinkPending = false;
    }
}

function ensureTelegramChoiceButton() {
    const loginForm = document.querySelector(".auth-login-form");
    if (!loginForm || document.querySelector("[data-telegram-register]")) return;

    const separator = document.createElement("div");
    separator.className = "telegram-auth-choice";
    separator.dataset.telegramAuthChoice = "true";

    const hint = document.createElement("p");
    hint.textContent = "Есть аккаунт? Войдите выше один раз, и Telegram привяжется автоматически.";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "auth-submit-button";
    button.dataset.telegramRegister = "true";
    button.textContent = "Создать новый аккаунт через Telegram";

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
                    ? "Не удалось завершить привязку. Попробуйте войти в существующий аккаунт."
                    : "Не удалось войти через Telegram. Попробуйте ещё раз.",
                "error"
            );
        } finally {
            button.disabled = false;
        }
    });

    separator.append(hint, button);
    loginForm.append(separator);
}

function showTelegramLinkChoice() {
    const reveal = () => {
        const controls = document.querySelector(".auth-controls");
        const openButton = document.querySelector(".auth-open-button");
        if (!controls || !openButton || controls.dataset.authReady !== "true") {
            window.setTimeout(reveal, 120);
            return;
        }

        ensureTelegramChoiceButton();
        if (!openButton.hidden) {
            openButton.click();
            setAuthMessage(
                "Этот Telegram ещё не связан с POJIDMUSIC. Войдите в существующий аккаунт или создайте новый.",
                ""
            );
        }
    };

    reveal();
}

async function initializeTelegramAuth() {
    telegramInitData = getTelegramInitData();
    if (!telegramInitData) return;

    document.documentElement.classList.add("telegram-mini-app");

    try {
        const bootstrap = await callTelegramAuth("bootstrap");
        if (bootstrap?.status === "linked") {
            await consumeTelegramSession(bootstrap);
            return;
        }

        const { data } = await supabase.auth.getSession();
        if (data.session) {
            await linkCurrentSession(data.session);
            return;
        }

        showTelegramLinkChoice();
    } catch (error) {
        console.warn("Telegram auth bootstrap failed", error);
        showTelegramLinkChoice();
    }

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
        if (session && !telegramAccountLinked) {
            void linkCurrentSession(session);
        }
    });
    authStateSubscription = data.subscription;
}

export function initializeAccountAuthGuard() {
    if (initialized) return;
    initialized = true;

    removeRoleChoice();
    document.addEventListener("submit", handleListenerOnlySignup, true);

    if (isTelegramMiniApp()) {
        void initializeTelegramAuth();
    }

    window.addEventListener("pagehide", () => {
        authStateSubscription?.unsubscribe();
        authStateSubscription = null;
    }, { once: true });
}
