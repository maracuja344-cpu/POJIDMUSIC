import {
    clearActiveSearch,
    enterMobileSearch,
    exitMobileSearch
} from "./search.js";
import { isMobileDevice } from "./mobile.js";

let initialized = false;
let navigationModulePromise = null;
let authModulePromise = null;
let unsubscribeAuthState = null;

const mobileNavigationStyles = document.createElement("link");
mobileNavigationStyles.rel = "stylesheet";
mobileNavigationStyles.href = new URL(
    "../mobile-navigation.css",
    import.meta.url
).href;
document.head.append(mobileNavigationStyles);

function loadNavigation() {
    navigationModulePromise ||= import("./app-navigation.js");
    return navigationModulePromise;
}

function loadAuth() {
    authModulePromise ||= import("./auth.js");
    return authModulePromise;
}

function renderNavigationMarkup() {
    const navigation = document.querySelector(".mobile-bottom-navigation");
    if (!navigation) return;

    navigation.innerHTML = `
        <button
            class="mobile-nav-button is-active"
            type="button"
            data-mobile-tab="home"
            aria-label="Главная"
            aria-current="page"
        >
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3.5 10.5L12 3.5L20.5 10.5V20H14.5V14H9.5V20H3.5V10.5Z"></path>
            </svg>
            <span>Главная</span>
        </button>

        <button
            class="mobile-nav-button"
            type="button"
            data-mobile-tab="search"
            aria-label="Поиск"
        >
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="10.5" cy="10.5" r="6.5"></circle>
                <path d="M15.5 15.5L21 21"></path>
            </svg>
            <span>Поиск</span>
        </button>

        <button
            class="mobile-nav-button"
            type="button"
            data-mobile-tab="upload"
            aria-label="Добавить трек"
            hidden
        >
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 4V20"></path>
                <path d="M4 12H20"></path>
            </svg>
            <span>Добавить трек</span>
        </button>

        <button
            class="mobile-nav-button"
            type="button"
            data-mobile-tab="artist"
            aria-label="Страница артиста"
            hidden
        >
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="8.5"></circle>
                <circle cx="12" cy="12" r="3.1"></circle>
                <path d="M12 3.5V8.9"></path>
            </svg>
            <span>Страница артиста</span>
        </button>

        <button
            class="mobile-nav-button"
            type="button"
            data-mobile-tab="profile"
            aria-label="Профиль и настройки"
        >
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="8" r="4"></circle>
                <path d="M4.5 21C5.2 16.8 7.7 14.5 12 14.5C16.3 14.5 18.8 16.8 19.5 21"></path>
            </svg>
            <span>Профиль</span>
        </button>
    `;
}

function setArtistActionsVisible(visible) {
    document.querySelectorAll(
        '[data-mobile-tab="upload"], [data-mobile-tab="artist"]'
    ).forEach((button) => {
        button.hidden = !visible;
    });
}

function setActiveTab(tabName) {
    document.body.dataset.activeMobileTab = tabName;
    document.querySelectorAll("[data-mobile-tab]").forEach((button) => {
        const active = button.dataset.mobileTab === tabName;
        button.classList.toggle("is-active", active);
        if (active) button.setAttribute("aria-current", "page");
        else button.removeAttribute("aria-current");
    });
}

function syncTabFromView() {
    if (document.body.classList.contains("mobile-search-active")) {
        setActiveTab("search");
        return;
    }

    const view = document.body.dataset.appView;
    if (view === "settings") {
        setActiveTab("profile");
        return;
    }
    if (["artist", "myTracks"].includes(view)) {
        setActiveTab("artist");
        return;
    }
    setActiveTab("home");
}

async function openHome() {
    exitMobileSearch({ clear: true });
    clearActiveSearch();
    const navigation = await loadNavigation();
    navigation.openCatalogView();
    setActiveTab("home");
}

async function openSearch() {
    const navigation = await loadNavigation();
    navigation.openCatalogView({ scroll: false });
    enterMobileSearch();
    setActiveTab("search");
}

async function openUpload() {
    exitMobileSearch({ clear: true });
    const uploadButton = document.querySelector(
        ".profile-menu .track-upload-open-button"
    ) || document.querySelector(".track-upload-open-button");
    uploadButton?.click();
}

async function openArtist() {
    exitMobileSearch({ clear: true });
    const navigation = await loadNavigation();
    const opened = await navigation.openCurrentProfile();
    if (opened) setActiveTab("artist");
}

async function openProfile() {
    exitMobileSearch({ clear: true });
    const navigation = await loadNavigation();
    const opened = await navigation.openSettings();
    setActiveTab(opened ? "profile" : "home");
}

async function observeRole() {
    const auth = await loadAuth();
    unsubscribeAuthState?.();
    unsubscribeAuthState = auth.subscribeToAuthState((state) => {
        setArtistActionsVisible(state.profile?.role === "artist");
        syncTabFromView();
    });
}

export function initializeMobileAppShell() {
    if (initialized) return;
    initialized = true;

    renderNavigationMarkup();
    void observeRole();

    document.addEventListener("click", (event) => {
        const button = event.target.closest("[data-mobile-tab]");
        if (!button || (!isMobileDevice() && window.innerWidth > 768)) return;

        const tab = button.dataset.mobileTab;
        if (tab === "home") void openHome();
        if (tab === "search") void openSearch();
        if (tab === "upload") void openUpload();
        if (tab === "artist") void openArtist();
        if (tab === "profile") void openProfile();
    });

    new MutationObserver(syncTabFromView).observe(document.body, {
        attributes: true,
        attributeFilter: ["data-app-view", "class"]
    });

    window.addEventListener(
        "popstate",
        () => requestAnimationFrame(syncTabFromView)
    );
    syncTabFromView();
}
