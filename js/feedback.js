const FEEDBACK_ENDPOINT = "https://chtnmiiucefiuhydpvjr.supabase.co/functions/v1/telegram-feedback";
const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;
const FEEDBACK_TYPES = new Set(["bug", "idea", "other"]);

const PROFILE_ACTIONS = [
    {
        selector: "[data-account-my-tracks]",
        title: "Мои треки",
        subtitle: "Релизы и управление",
        icon: '<path d="M9 18V5l10-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="16" cy="16" r="3"></circle>'
    },
    {
        selector: "[data-account-artist-page]",
        title: "Страница артиста",
        subtitle: "Публичный профиль",
        icon: '<circle cx="12" cy="8" r="4"></circle><path d="M4.5 21c.7-4.2 3.2-6.5 7.5-6.5s6.8 2.3 7.5 6.5"></path>'
    },
    {
        selector: "[data-change-account-avatar]",
        title: "Изменить аватар",
        subtitle: "Фото профиля",
        icon: '<rect x="3" y="4" width="18" height="16" rx="3"></rect><circle cx="9" cy="10" r="2"></circle><path d="m5 18 4.5-4 3 2.5 2.5-2 4 3.5"></path>'
    },
    {
        selector: "[data-open-feedback]",
        title: "Фидбек",
        subtitle: "Баги и идеи",
        icon: '<path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H10l-5 4v-4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"></path><path d="M8 11h.01M12 11h.01M16 11h.01"></path>'
    }
];

function getTelegramInitData() {
    const direct = window.Telegram?.WebApp?.initData;
    if (typeof direct === "string" && direct.trim()) return direct.trim();
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const encoded = hash.get("tgWebAppData");
    if (!encoded) return "";
    try { return decodeURIComponent(encoded); } catch { return encoded; }
}

function getStartParam() {
    const unsafe = window.Telegram?.WebApp?.initDataUnsafe?.start_param;
    if (typeof unsafe === "string" && unsafe.trim()) return unsafe.trim();
    try { return new URLSearchParams(getTelegramInitData()).get("start_param") || ""; } catch { return ""; }
}

function injectStyles() {
    if (document.querySelector("style[data-feedback-styles]")) return;
    const style = document.createElement("style");
    style.dataset.feedbackStyles = "true";
    style.textContent = `
        .feedback-modal[hidden] { display:none!important; }
        .feedback-modal { position:fixed; inset:0; z-index:2600; display:grid; place-items:center; padding:calc(18px + env(safe-area-inset-top)) calc(18px + env(safe-area-inset-right)) calc(18px + env(safe-area-inset-bottom)) calc(18px + env(safe-area-inset-left)); }
        .feedback-backdrop { position:absolute; inset:0; background:rgba(0,0,0,.72); -webkit-backdrop-filter:blur(10px); backdrop-filter:blur(10px); }
        .feedback-dialog { position:relative; z-index:1; width:min(100%,480px); padding:20px; border:1px solid rgba(255,255,255,.1); border-radius:22px; background:rgba(20,20,21,.98); box-shadow:0 24px 70px rgba(0,0,0,.5); }
        .feedback-heading { display:flex; justify-content:space-between; gap:16px; align-items:flex-start; }
        .feedback-kicker { margin:0 0 5px; font-size:12px; letter-spacing:.08em; text-transform:uppercase; color:rgba(255,255,255,.5); }
        .feedback-heading h2 { margin:0; font-size:24px; }
        .feedback-close { width:42px; height:42px; flex:0 0 42px; border:0; border-radius:999px; background:rgba(255,255,255,.07); color:#fff; font-size:26px; line-height:1; cursor:pointer; }
        .feedback-form { display:grid; gap:14px; margin-top:20px; }
        .feedback-type-group { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; }
        .feedback-type { min-height:44px; border:1px solid rgba(255,255,255,.1); border-radius:12px; background:rgba(255,255,255,.04); color:rgba(255,255,255,.66); font:inherit; cursor:pointer; }
        .feedback-type.is-active { background:rgba(255,255,255,.13); color:#fff; border-color:rgba(255,255,255,.22); }
        .feedback-field { display:grid; gap:7px; }
        .feedback-field label { font-size:14px; color:rgba(255,255,255,.72); }
        .feedback-field textarea,.feedback-field input[type=file] { width:100%; border:1px solid #393939; border-radius:13px; background:#151515; color:#fff; font:inherit; }
        .feedback-field textarea { min-height:150px; padding:13px; resize:vertical; }
        .feedback-field input[type=file] { padding:8px; }
        .feedback-field input[type=file]::file-selector-button { min-height:36px; margin-right:10px; padding:7px 10px; border:0; border-radius:9px; background:rgba(255,255,255,.1); color:#fff; font:inherit; }
        .feedback-hint,.feedback-status { margin:0; font-size:12px; line-height:1.45; color:rgba(255,255,255,.5); }
        .feedback-status.is-error { color:#ffc7d0; } .feedback-status.is-success { color:#c9f8dc; }
        .feedback-submit { min-height:48px; border:1px solid rgba(255,255,255,.12); border-radius:13px; background:#fff; color:#111; font:inherit; font-weight:700; cursor:pointer; }
        .feedback-submit:disabled { opacity:.55; cursor:wait; }
        .feedback-open-button { width:100%; } body.feedback-modal-open { overflow:hidden; }
        @media (max-width:560px) { .feedback-modal { align-items:end; padding:calc(12px + env(safe-area-inset-top)) calc(12px + env(safe-area-inset-right)) calc(12px + env(safe-area-inset-bottom)) calc(12px + env(safe-area-inset-left)); } .feedback-dialog { border-radius:20px; padding:18px; } .feedback-heading h2 { font-size:22px; } .feedback-field textarea { min-height:130px; } }
    `;
    document.head.append(style);
}

function createModal() {
    const existing = document.querySelector(".feedback-modal");
    if (existing) return existing;
    const modal = document.createElement("div");
    modal.className = "feedback-modal";
    modal.hidden = true;
    modal.innerHTML = `
        <div class="feedback-backdrop" data-feedback-close></div>
        <div class="feedback-dialog" role="dialog" aria-modal="true" aria-labelledby="feedback-title">
            <div class="feedback-heading"><div><p class="feedback-kicker">Фидбек</p><h2 id="feedback-title">Расскажи, что случилось</h2></div><button class="feedback-close" type="button" aria-label="Закрыть" data-feedback-close>×</button></div>
            <form class="feedback-form">
                <div class="feedback-type-group" aria-label="Тип обращения"><button type="button" class="feedback-type is-active" data-feedback-type="bug">Баг</button><button type="button" class="feedback-type" data-feedback-type="idea">Идея</button><button type="button" class="feedback-type" data-feedback-type="other">Другое</button></div>
                <div class="feedback-field"><label for="feedback-text">Что передать?</label><textarea id="feedback-text" maxlength="3000" required placeholder="Напиши, что сломалось или что хочется добавить"></textarea></div>
                <div class="feedback-field"><label for="feedback-screenshot">Скрин · необязательно</label><input id="feedback-screenshot" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"><p class="feedback-hint">JPG, PNG или WebP, до 8 МиБ</p></div>
                <p class="feedback-status" role="status" aria-live="polite"></p><button class="feedback-submit" type="submit">Отправить в Telegram</button>
            </form>
        </div>`;
    document.body.append(modal);
    return modal;
}

function decorateProfileActions() {
    PROFILE_ACTIONS.forEach(({ selector, title, subtitle, icon }) => {
        const button = document.querySelector(`[data-account-actions] ${selector}`);
        if (!button || button.dataset.profileDecorated === "true") return;
        button.dataset.profileDecorated = "true";
        button.innerHTML = `<span class="profile-action-icon" aria-hidden="true"><svg viewBox="0 0 24 24">${icon}</svg></span><span class="profile-action-copy"><span class="profile-action-title">${title}</span><span class="profile-action-subtitle">${subtitle}</span></span><span class="profile-action-chevron" aria-hidden="true">›</span>`;
    });
}

function addOpenButtons(openFeedback) {
    const profileActions = document.querySelector("[data-account-actions]");
    if (profileActions && !profileActions.querySelector("[data-open-feedback]")) {
        const button = document.createElement("button");
        button.className = "profile-action-button feedback-open-button";
        button.type = "button";
        button.dataset.openFeedback = "true";
        button.textContent = "Фидбек";
        button.addEventListener("click", openFeedback);
        profileActions.append(button);
    }
    const menu = document.querySelector("#profile-menu");
    const separator = menu?.querySelector(".profile-menu-separator");
    if (menu && separator && !menu.querySelector("[data-open-feedback]")) {
        const button = document.createElement("button");
        button.className = "profile-menu-item";
        button.type = "button";
        button.role = "menuitem";
        button.dataset.openFeedback = "true";
        button.textContent = "Фидбек";
        button.addEventListener("click", openFeedback);
        separator.before(button);
    }
    decorateProfileActions();
}

function initializeFeedback() {
    const initData = getTelegramInitData();
    if (!initData) return;
    injectStyles();
    const modal = createModal();
    const form = modal.querySelector(".feedback-form");
    const text = modal.querySelector("#feedback-text");
    const screenshot = modal.querySelector("#feedback-screenshot");
    const status = modal.querySelector(".feedback-status");
    const submit = modal.querySelector(".feedback-submit");
    let type = "bug";
    const setStatus = (message = "", kind = "") => { status.textContent = message; status.classList.toggle("is-error", kind === "error"); status.classList.toggle("is-success", kind === "success"); };
    const openFeedback = () => { modal.hidden = false; document.body.classList.add("feedback-modal-open"); setStatus(); requestAnimationFrame(() => text.focus({ preventScroll: true })); };
    const closeFeedback = () => { if (submit.disabled) return; modal.hidden = true; document.body.classList.remove("feedback-modal-open"); };
    addOpenButtons(openFeedback);
    modal.querySelectorAll("[data-feedback-close]").forEach((button) => button.addEventListener("click", closeFeedback));
    modal.querySelectorAll("[data-feedback-type]").forEach((button) => button.addEventListener("click", () => { type = button.dataset.feedbackType; modal.querySelectorAll("[data-feedback-type]").forEach((item) => item.classList.toggle("is-active", item === button)); }));
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const message = text.value.trim();
        const file = screenshot.files?.[0] || null;
        if (!FEEDBACK_TYPES.has(type)) return;
        if (!message) return setStatus("Напиши хотя бы пару слов.", "error");
        if (file && file.size > MAX_SCREENSHOT_BYTES) return setStatus("Скрин слишком большой. Максимум 8 МиБ.", "error");
        submit.disabled = true; setStatus("Отправляю…");
        const body = new FormData(); body.set("initData", initData); body.set("type", type); body.set("message", message); body.set("platform", navigator.userAgent.slice(0, 500)); if (file) body.set("screenshot", file, file.name);
        try {
            const response = await fetch(FEEDBACK_ENDPOINT, { method: "POST", body });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            setStatus("Отправлено. Спасибо.", "success"); form.reset(); type = "bug";
            modal.querySelectorAll("[data-feedback-type]").forEach((item) => item.classList.toggle("is-active", item.dataset.feedbackType === "bug"));
            window.setTimeout(() => { submit.disabled = false; closeFeedback(); }, 900);
        } catch (error) { console.error("Не удалось отправить фидбек.", error); submit.disabled = false; setStatus("Не отправилось. Попробуй ещё раз.", "error"); }
    });
    document.addEventListener("keydown", (event) => { if (!modal.hidden && event.key === "Escape") closeFeedback(); });
    if (getStartParam() === "feedback" || new URLSearchParams(location.search).get("feedback") === "1") requestAnimationFrame(openFeedback);
}

initializeFeedback();
