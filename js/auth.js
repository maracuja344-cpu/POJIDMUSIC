import { supabase } from "./supabase/client.js";
import {
    clearUserScopedData,
    getProfileById
} from "./data-repository.js";
import {
    announceExclusivePopupOpen,
    EXCLUSIVE_POPUP_OPEN_EVENT
} from "./artist-utils.js";

let authInitialized = false;
let authSubscription = null;
let previouslyFocusedElement = null;
let profileRequestId = 0;
let renderedAuthUserId;
let activeAuthElements = null;
const authStateListeners = new Set();
let currentAuthState = Object.freeze({
    session: null,
    user: null,
    profile: null,
    profileState: "signed-out"
});

function publishAuthState(nextState) {
    currentAuthState = Object.freeze({
        session: nextState.session || null,
        user: nextState.user || null,
        profile: nextState.profile || null,
        profileState: nextState.profileState
    });

    authStateListeners.forEach((listener) => {
        try {
            listener(currentAuthState);
        } catch (error) {
            console.error("Не удалось обновить зависимый интерфейс Auth.", error);
        }
    });
}

export function getCurrentAuthState() {
    return currentAuthState;
}

export function subscribeToAuthState(listener) {
    if (typeof listener !== "function") return () => {};
    authStateListeners.add(listener);
    listener(currentAuthState);
    return () => authStateListeners.delete(listener);
}

function getAuthElements() {
    return {
        controls: document.querySelector(".auth-controls"),
        openButton: document.querySelector(".auth-open-button"),
        userControls: document.querySelector(".auth-user-controls"),
        profileButton: document.querySelector(".auth-profile-button"),
        profileMenu: document.querySelector(".profile-menu"),
        userIdentity: document.querySelector(".auth-user-identity"),
        profileNote: document.querySelector(".auth-profile-note"),
        signOutButton: document.querySelector(".auth-sign-out-button"),
        modal: document.querySelector(".auth-modal"),
        closeButtons: document.querySelectorAll("[data-auth-close]"),
        tabs: document.querySelectorAll("[data-auth-mode]"),
        loginPanel: document.querySelector("#auth-login-panel"),
        signupPanel: document.querySelector("#auth-signup-panel"),
        message: document.querySelector(".auth-message"),
        loginForm: document.querySelector(".auth-login-form"),
        signupForm: document.querySelector(".auth-signup-form")
    };
}

function setMessage(elements, text, type = "") {
    if (!elements.message) return;
    elements.message.textContent = text;
    elements.message.classList.toggle("is-error", type === "error");
    elements.message.classList.toggle("is-success", type === "success");
    elements.message.hidden = text === "";
}

function getReadableAuthError(error, context) {
    const message = String(error?.message || "").toLowerCase();
    if (message.includes("invalid login credentials")) return "Неверный email или пароль.";
    if (message.includes("email not confirmed")) return "Сначала подтвердите email по ссылке из письма.";
    if (message.includes("user already registered") || message.includes("already been registered")) {
        return "Аккаунт с таким email уже существует.";
    }
    if (message.includes("password")) return "Пароль не соответствует требованиям безопасности.";
    if (message.includes("rate limit") || message.includes("too many")) {
        return "Слишком много попыток. Попробуйте немного позже.";
    }
    if (context === "signup") return "Не удалось зарегистрироваться. Попробуйте ещё раз.";
    if (context === "signout") return "Не удалось выйти из аккаунта. Попробуйте ещё раз.";
    return "Не удалось войти. Проверьте данные и соединение.";
}

function setFormPending(form, pending) {
    if (!form) return;
    form.dataset.pending = pending ? "true" : "false";
    form.querySelectorAll("input, select, button").forEach((control) => {
        control.disabled = pending;
    });
}

function setAuthMode(elements, mode) {
    const loginMode = mode === "login";
    elements.loginPanel.hidden = !loginMode;
    elements.signupPanel.hidden = loginMode;
    elements.tabs.forEach((tab) => {
        const active = tab.dataset.authMode === mode;
        tab.classList.toggle("is-active", active);
        tab.setAttribute("aria-selected", String(active));
        tab.tabIndex = active ? 0 : -1;
    });
    setMessage(elements, "");
}

function openAuthModal(elements, mode = "login") {
    previouslyFocusedElement = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setAuthMode(elements, mode);
    elements.modal.hidden = false;
    document.body.classList.add("auth-modal-open");
    requestAnimationFrame(() => {
        (mode === "login" ? elements.loginPanel : elements.signupPanel)
            .querySelector("input")?.focus();
    });
}

function closeAuthModal(elements) {
    elements.modal.hidden = true;
    document.body.classList.remove("auth-modal-open");
    setMessage(elements, "");
    if (previouslyFocusedElement && document.contains(previouslyFocusedElement)) {
        previouslyFocusedElement.focus();
    }
    previouslyFocusedElement = null;
}

function getFallbackIdentity(user) {
    const metadataName = typeof user?.user_metadata?.display_name === "string"
        ? user.user_metadata.display_name.trim()
        : "";
    return metadataName || user?.email || "Аккаунт";
}

function setProfileMenuOpen(elements, open, { restoreFocus = false, focusFirstItem = false } = {}) {
    if (open) announceExclusivePopupOpen(elements.userControls);
    elements.profileMenu.hidden = !open;
    elements.profileButton.setAttribute("aria-expanded", String(open));
    if (focusFirstItem) {
        elements.profileMenu.querySelector("button:not([hidden]):not(:disabled)")?.focus();
    } else if (restoreFocus) {
        elements.profileButton.focus();
    }
}

function setUserIdentity(elements, identity) {
    const safeIdentity = identity || "Аккаунт";
    elements.userIdentity.textContent = safeIdentity;
    elements.profileButton.title = safeIdentity;
    elements.profileButton.setAttribute("aria-label", `Открыть меню профиля: ${safeIdentity}`);
}

function renderHeaderAuthState(elements, session) {
    const authenticated = Boolean(session?.user);
    elements.openButton.hidden = authenticated;
    elements.userControls.hidden = !authenticated;
    if (!authenticated) setProfileMenuOpen(elements, false);
    elements.controls.dataset.authReady = "true";
}

function renderSignedOut(elements) {
    profileRequestId += 1;
    setUserIdentity(elements, "Аккаунт");
    elements.profileNote.textContent = "";
    elements.profileNote.hidden = true;
}

function renderSignedIn(elements, user) {
    setUserIdentity(elements, getFallbackIdentity(user));
    elements.profileNote.textContent = "";
    elements.profileNote.hidden = true;
}

async function findProfile(userId, { force = false, onUpdate } = {}) {
    try {
        const data = await getProfileById(userId, { force, onUpdate });
        return { state: data ? "ready" : "missing", profile: data };
    } catch {
        return { state: "unavailable", profile: null };
    }
}

async function refreshProfile(elements, user, session) {
    if (!user?.id) return null;
    const requestId = ++profileRequestId;
    const refreshFromBackground = () => {
        if (currentAuthState.user?.id === user.id && !elements.userControls.hidden) {
            void refreshProfile(elements, user, session);
        }
    };

    let result = await findProfile(user.id, { onUpdate: refreshFromBackground });
    for (let attempt = 0; result.state === "missing" && attempt < 2; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 250));
        result = await findProfile(user.id, { force: true, onUpdate: refreshFromBackground });
    }

    if (requestId !== profileRequestId || elements.userControls.hidden) return null;

    const displayName = typeof result.profile?.display_name === "string"
        ? result.profile.display_name.trim()
        : "";
    setUserIdentity(elements, displayName || getFallbackIdentity(user));
    publishAuthState({ session, user, profile: result.profile, profileState: result.state });

    if (result.state === "missing") {
        elements.profileNote.textContent = "Профиль ещё подготавливается";
        elements.profileNote.hidden = false;
    } else if (result.state === "unavailable") {
        elements.profileNote.textContent = "Профиль временно недоступен";
        elements.profileNote.hidden = false;
    } else {
        elements.profileNote.textContent = "";
        elements.profileNote.hidden = true;
    }
    return result.profile;
}

export async function reloadCurrentProfile() {
    if (!activeAuthElements || !currentAuthState.user || !currentAuthState.session) return null;
    clearUserScopedData();
    return refreshProfile(activeAuthElements, currentAuthState.user, currentAuthState.session);
}

function applyAuthSession(elements, session) {
    const user = session?.user || null;
    const nextUserId = user?.id || null;
    renderHeaderAuthState(elements, session);

    if (renderedAuthUserId === nextUserId) {
        publishAuthState({
            session,
            user,
            profile: currentAuthState.profile,
            profileState: currentAuthState.profileState
        });
        return;
    }

    renderedAuthUserId = nextUserId;
    if (!user) {
        renderSignedOut(elements);
        publishAuthState({ session: null, user: null, profile: null, profileState: "signed-out" });
        return;
    }

    renderSignedIn(elements, user);
    publishAuthState({ session, user, profile: null, profileState: "loading" });
    setTimeout(() => void refreshProfile(elements, user, session), 0);
}

async function handleLoginSubmit(event, elements) {
    event.preventDefault();
    const form = elements.loginForm;
    if (form.dataset.pending === "true" || !form.reportValidity()) return;
    const formData = new FormData(form);
    const email = String(formData.get("email") || "").trim();
    const password = String(formData.get("password") || "");
    setMessage(elements, "");
    setFormPending(form, true);
    try {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error || !data.user || !data.session) {
            setMessage(elements, getReadableAuthError(error, "login"), "error");
            return;
        }
        form.reset();
        applyAuthSession(elements, data.session);
        closeAuthModal(elements);
    } catch {
        setMessage(elements, "Не удалось войти. Проверьте соединение.", "error");
    } finally {
        setFormPending(form, false);
    }
}

function validateSignup(form, elements) {
    const formData = new FormData(form);
    const displayName = String(formData.get("display_name") || "").trim();
    const email = String(formData.get("email") || "").trim();
    const password = String(formData.get("password") || "");
    const passwordRepeat = String(formData.get("password_repeat") || "");
    if (!displayName) {
        setMessage(elements, "Укажите имя.", "error");
        return null;
    }
    if (!email) {
        setMessage(elements, "Укажите email.", "error");
        return null;
    }
    if (password.length < 8) {
        setMessage(elements, "Пароль должен содержать минимум 8 символов.", "error");
        return null;
    }
    if (password !== passwordRepeat) {
        setMessage(elements, "Пароли не совпадают.", "error");
        return null;
    }
    if (!form.reportValidity()) return null;
    return { displayName, email, password };
}

async function handleSignupSubmit(event, elements) {
    event.preventDefault();
    const form = elements.signupForm;
    if (form.dataset.pending === "true") return;
    setMessage(elements, "");
    const values = validateSignup(form, elements);
    if (!values) return;
    setFormPending(form, true);
    try {
        const { data, error } = await supabase.auth.signUp({
            email: values.email,
            password: values.password,
            options: { data: { display_name: values.displayName } }
        });
        if (error || !data.user) {
            setMessage(elements, getReadableAuthError(error, "signup"), "error");
            return;
        }
        form.reset();
        if (data.session) {
            applyAuthSession(elements, data.session);
            setMessage(elements, "Регистрация завершена. Аккаунт создан как слушатель.", "success");
            return;
        }
        setAuthMode(elements, "login");
        setMessage(
            elements,
            "Аккаунт слушателя создан. Подтвердите email и войдите. Роль артиста можно запросить в профиле.",
            "success"
        );
    } catch {
        setMessage(elements, "Не удалось зарегистрироваться. Проверьте соединение.", "error");
    } finally {
        setFormPending(form, false);
    }
}

async function handleSignOut(elements) {
    if (elements.signOutButton.disabled) return;
    elements.signOutButton.disabled = true;
    try {
        const { error } = await supabase.auth.signOut();
        if (error) {
            elements.profileNote.textContent = getReadableAuthError(error, "signout");
            elements.profileNote.hidden = false;
            return;
        }
        clearUserScopedData();
        applyAuthSession(elements, null);
    } catch {
        elements.profileNote.textContent = "Не удалось выйти. Проверьте соединение.";
        elements.profileNote.hidden = false;
    } finally {
        elements.signOutButton.disabled = false;
    }
}

async function restoreSession(elements) {
    try {
        const { data, error } = await supabase.auth.getSession();
        applyAuthSession(elements, error ? null : data.session);
    } catch {
        applyAuthSession(elements, null);
    }
}

function subscribeToAuthChanges(elements) {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
        applyAuthSession(elements, session);
    });
    authSubscription = data.subscription;
}

function removeAuthSubscription() {
    authSubscription?.unsubscribe();
    authSubscription = null;
}

export function initializeAuth() {
    if (authInitialized) return;
    const elements = getAuthElements();
    if (
        !elements.openButton || !elements.controls || !elements.userControls ||
        !elements.profileButton || !elements.profileMenu || !elements.userIdentity ||
        !elements.profileNote || !elements.signOutButton || !elements.modal ||
        !elements.message || !elements.loginForm || !elements.signupForm ||
        !elements.loginPanel || !elements.signupPanel
    ) {
        if (elements.controls) elements.controls.dataset.authReady = "true";
        return;
    }

    authInitialized = true;
    activeAuthElements = elements;

    elements.openButton.addEventListener("click", () => openAuthModal(elements));
    elements.profileButton.addEventListener("click", (event) => {
        const willOpen = elements.profileMenu.hidden;
        setProfileMenuOpen(elements, willOpen, {
            focusFirstItem: willOpen && event.detail === 0
        });
    });
    elements.profileMenu.addEventListener("click", (event) => {
        if (event.target.closest(".track-upload-open-button")) setProfileMenuOpen(elements, false);
    });
    document.addEventListener("click", (event) => {
        if (elements.profileMenu.hidden || elements.userControls.contains(event.target)) return;
        setProfileMenuOpen(elements, false);
    });
    window.addEventListener(EXCLUSIVE_POPUP_OPEN_EVENT, (event) => {
        if (!elements.profileMenu.hidden && !elements.userControls.contains(event.detail?.owner)) {
            setProfileMenuOpen(elements, false);
        }
    });
    elements.userControls.addEventListener("focusout", () => {
        setTimeout(() => {
            if (!elements.userControls.contains(document.activeElement)) setProfileMenuOpen(elements, false);
        }, 0);
    });
    elements.closeButtons.forEach((button) => button.addEventListener("click", () => closeAuthModal(elements)));
    elements.tabs.forEach((tab) => tab.addEventListener("click", () => setAuthMode(elements, tab.dataset.authMode)));
    elements.loginForm.addEventListener("submit", (event) => void handleLoginSubmit(event, elements));
    elements.signupForm.addEventListener("submit", (event) => void handleSignupSubmit(event, elements));
    elements.signOutButton.addEventListener("click", () => void handleSignOut(elements));

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !elements.profileMenu.hidden) {
            setProfileMenuOpen(elements, false, { restoreFocus: true });
            return;
        }
        if (elements.modal.hidden) return;
        if (event.key === "Escape") {
            closeAuthModal(elements);
            return;
        }
        if (event.key !== "Tab") return;
        const focusable = Array.from(elements.modal.querySelectorAll(
            "button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex='-1'])"
        )).filter((element) => !element.closest("[hidden]"));
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    });

    subscribeToAuthChanges(elements);
    void restoreSession(elements);
    window.addEventListener("pagehide", removeAuthSubscription, { once: true });
}
