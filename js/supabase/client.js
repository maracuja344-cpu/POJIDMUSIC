import {
    createClient
} from "https://esm.sh/@supabase/supabase-js@2.112.2?bundle";

import {
    SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_URL
} from "./config.js";


const TELEGRAM_AUTH_URL =
    `${SUPABASE_URL}/functions/v1/telegram-auth`;
const TELEGRAM_AUTH_TIMEOUT_MS = 8000;


/*
Единственный клиент Supabase для модулей приложения.
Telegram bootstrap запускается параллельно и никогда не блокирует
импорт навигации, профиля или обычную desktop/PWA авторизацию.
*/
export const supabase = createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
);


function getTelegramInitData() {
    const injectedInitData = window.Telegram?.WebApp?.initData;
    if (typeof injectedInitData === "string" && injectedInitData.trim()) {
        return injectedInitData.trim();
    }

    const hash = location.hash.startsWith("#")
        ? location.hash.slice(1)
        : location.hash;
    const params = new URLSearchParams(hash);
    const hashInitData = params.get("tgWebAppData");
    return typeof hashInitData === "string" ? hashInitData.trim() : "";
}


async function requestTelegramAuth(action, initData, accessToken = null) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(
        () => controller.abort(),
        TELEGRAM_AUTH_TIMEOUT_MS
    );

    try {
        const response = await fetch(TELEGRAM_AUTH_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "apikey": SUPABASE_PUBLISHABLE_KEY,
                ...(accessToken
                    ? { "Authorization": `Bearer ${accessToken}` }
                    : {})
            },
            body: JSON.stringify({ action, initData }),
            cache: "no-store",
            signal: controller.signal
        });

        let payload = null;
        try {
            payload = await response.json();
        } catch {
            payload = null;
        }

        return { ok: response.ok, status: response.status, payload };
    } finally {
        window.clearTimeout(timeoutId);
    }
}


async function establishTelegramSession(payload) {
    if (
        payload?.status !== "linked" ||
        typeof payload.token_hash !== "string" ||
        !payload.token_hash
    ) {
        return false;
    }

    const { data, error } = await supabase.auth.verifyOtp({
        token_hash: payload.token_hash,
        type: "email"
    });

    if (error || !data.session || !data.user) {
        throw error || new Error("Telegram session exchange failed");
    }

    return true;
}


async function bootstrapTelegramAuth() {
    const initData = getTelegramInitData();
    if (!initData) return;

    document.documentElement.dataset.telegramMiniApp = "true";
    try {
        window.Telegram?.WebApp?.ready?.();
    } catch {
        // initData всё равно проверяется сервером.
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const existingSession = sessionData?.session || null;

    if (existingSession?.access_token) {
        const linkResult = await requestTelegramAuth(
            "link",
            initData,
            existingSession.access_token
        );
        if (linkResult.ok) return;
        if (![401, 409].includes(linkResult.status)) {
            throw new Error(`Telegram link failed (${linkResult.status})`);
        }
    }

    let result = await requestTelegramAuth("bootstrap", initData);
    if (!result.ok) {
        throw new Error(`Telegram bootstrap failed (${result.status})`);
    }

    if (result.payload?.status === "unlinked") {
        result = await requestTelegramAuth("register", initData);
        if (!result.ok && result.status === 409) {
            result = await requestTelegramAuth("bootstrap", initData);
        }
    }

    if (!result.ok) {
        throw new Error(`Telegram registration failed (${result.status})`);
    }

    await establishTelegramSession(result.payload);
}


export const telegramAuthReady = bootstrapTelegramAuth().catch((error) => {
    console.error(
        "Не удалось выполнить автоматический вход через Telegram.",
        error
    );
});
