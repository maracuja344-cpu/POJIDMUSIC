import {
    clearActiveSearch,
    enterMobileSearch,
    exitMobileSearch
} from "./search.js";
import { isMobileDevice } from "./mobile.js";
import { getCatalogTracks } from "./catalog-state.js";

let initialized = false;
let navigationModulePromise = null;
let authModulePromise = null;
let uploadWizardPromise = null;
let feedbackModulePromise = null;
let releaseChooserPromise = null;
let unsubscribeAuthState = null;
let catalogLoadTimer = null;
let catalogLoadDeadlineTimer = null;

function appendShellStyles(path, marker) {
    if (document.querySelector(`link[${marker}]`)) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = new URL(path, import.meta.url).href;
    link.setAttribute(marker, "true");
    document.head.append(link);
}

appendShellStyles("../mobile-navigation.css", "data-mobile-navigation-style");
appendShellStyles("../artist-mobile-list.css", "data-artist-mobile-list-style");
appendShellStyles("../release-upload-chooser.css", "data-release-upload-chooser-style");
appendShellStyles("../mobile-polish.css", "data-mobile-polish-style");

function loadNavigation() {
    navigationModulePromise ||= import("./app-navigation.js");
    return navigationModulePromise;
}

function loadAuth() {
    authModulePromise ||= import("./auth.js");
    return authModulePromise;
}

function loadUploadWizard() {
    uploadWizardPromise ||= import("./track-upload-wizard-entry.js");
    return uploadWizardPromise;
}

function loadFeedback() {
    feedbackModulePromise ||= import("./feedback.js");
    return feedbackModulePromise;
}

function loadReleaseChooser() {
    releaseChooserPromise ||= import("./release-upload-chooser.js");
    return releaseChooserPromise;
}

function shouldShowCatalogLoadScreen() {
    const url = new URL(window.location.href);
    return !url.searchParams.get("artist") && !url.searchParams.get("view");
}

function createCatalogLoadScreen() {
    if (!shouldShowCatalogLoadScreen()) return null;
    const existing = document.querySelector(".catalog-load-screen");
    if (existing) return existing;
    const style = document.createElement("style");
    style.dataset.catalogLoadScreenStyles = "true";
    style.textContent = `
        html.catalog-load-screen-active body { overflow: hidden !important; }
        html.catalog-load-screen-active .track-skeleton { display: none !important; }
        .catalog-load-screen { position: fixed; inset: 0; z-index: 5000; display: grid; place-items: center; background: #07070a; color: #fff; opacity: 1; transition: opacity 220ms ease; }
        .catalog-load-screen.is-ready { opacity: 0; pointer-events: none; }
        .catalog-load-screen-inner { display: grid; justify-items: center; gap: 18px; }
        .catalog-load-screen-wordmark { font-size: 15px; font-weight: 700; letter-spacing: .22em; }
        .catalog-load-screen-line { position: relative; width: 72px; height: 2px; overflow: hidden; border-radius: 999px; background: rgba(255,255,255,.12); }
        .catalog-load-screen-line::after { content: ""; position: absolute; inset: 0 auto 0 0; width: 40%; border-radius: inherit; background: rgba(255,255,255,.86); animation: catalog-load-slide 900ms ease-in-out infinite; }
        @keyframes catalog-load-slide { 0% { transform: translateX(-110%); } 55% { transform: translateX(95%); } 100% { transform: translateX(250%); } }
        @media (prefers-reduced-motion: reduce) { .catalog-load-screen, .catalog-load-screen-line::after { transition-duration: 1ms; animation-duration: 1ms; } }
    `;
    document.head.append(style);
    const screen = document.createElement("div");
    screen.className = "catalog-load-screen";
    screen.setAttribute("role", "status");
    screen.setAttribute("aria-live", "polite");
    screen.innerHTML = `<div class="catalog-load-screen-inner"><span class="catalog-load-screen-wordmark">POJIDMUSIC</span><span class="catalog-load-screen-line" aria-hidden="true"></span></div>`;
    document.documentElement.classList.add("catalog-load-screen-active");
    document.body.append(screen);
    return screen;
}

function finishCatalogLoadScreen(screen) {
    if (!screen || screen.classList.contains("is-ready")) return;
    window.clearInterval(catalogLoadTimer);
    window.clearTimeout(catalogLoadDeadlineTimer);
    catalogLoadTimer = null;
    catalogLoadDeadlineTimer = null;
    document.querySelectorAll(".track-skeleton").forEach((card) => card.remove());
    screen.classList.add("is-ready");
    document.documentElement.classList.remove("catalog-load-screen-active");
    window.setTimeout(() => {
        screen.remove();
        document.querySelector("style[data-catalog-load-screen-styles]")?.remove();
    }, 260);
}

function initializeCatalogLoadScreen() {
    const screen = createCatalogLoadScreen();
    if (!screen) return;
    const hasSupabaseTracks = () => getCatalogTracks().some((track) => track?.source === "supabase");
    if (hasSupabaseTracks()) {
        finishCatalogLoadScreen(screen);
        return;
    }
    catalogLoadTimer = window.setInterval(() => {
        if (hasSupabaseTracks()) finishCatalogLoadScreen(screen);
    }, 60);
    catalogLoadDeadlineTimer = window.setTimeout(() => finishCatalogLoadScreen(screen), 12000);
}

function renderNavigationMarkup() {
    const navigation = document.querySelector(".mobile-bottom-navigation");
    if (!navigation) return;
    navigation.innerHTML = `
        <button class="mobile-nav-button is-active" type="button" data-mobile-tab="home" aria-label="Главная" aria-current="page"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 10.5L12 3.5L20.5 10.5V20H14.5V14H9.5V20H3.5V10.5Z"></path></svg><span>Главная</span></button>
        <button class="mobile-nav-button" type="button" data-mobile-tab="search" aria-label="Поиск"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"></circle><path d="M15.5 15.5L21 21"></path></svg><span>Поиск</span></button>
        <button class="mobile-nav-button" type="button" data-mobile-tab="upload" aria-label="Добавить релиз" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4V20"></path><path d="M4 12H20"></path></svg><span>Добавить релиз</span></button>
        <button class="mobile-nav-button" type="button" data-mobile-tab="artist" aria-label="Страница артиста" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"></circle><circle cx="12" cy="12" r="3.1"></circle><path d="M12 3.5V8.9"></path></svg><span>Страница артиста</span></button>
        <button class="mobile-nav-button" type="button" data-mobile-tab="profile" aria-label="Профиль и настройки"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"></circle><path d="M4.5 21C5.2 16.8 7.7 14.5 12 14.5C16.3 14.5 18.8 16.8 19.5 21"></path></svg><span>Профиль</span></button>`;
}

function setArtistActionsVisible(visible) {
    document.querySelectorAll('[data-mobile-tab="upload"], [data-mobile-tab="artist"]').forEach((button) => { button.hidden = !visible; });
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
    if (document.body.classList.contains("mobile-search-active")) return setActiveTab("search");
    const view = document.body.dataset.appView;
    if (view === "settings") return setActiveTab("profile");
    if (["artist", "myTracks"].includes(view)) return setActiveTab("artist");
    setActiveTab("home");
}

async function openHome() { exitMobileSearch({ clear: true }); clearActiveSearch(); const navigation = await loadNavigation(); navigation.openCatalogView(); setActiveTab("home"); }
async function openSearch() { const navigation = await loadNavigation(); navigation.openCatalogView({ scroll: false }); enterMobileSearch(); setActiveTab("search"); }
async function openUpload(trigger = null) {
    exitMobileSearch({ clear: true });
    try {
        const chooser = await loadReleaseChooser();
        chooser.openReleaseUploadChooser(trigger);
    } catch (error) {
        console.error("Не удалось открыть выбор типа релиза.", error);
    }
}
async function openArtist() { exitMobileSearch({ clear: true }); const navigation = await loadNavigation(); const opened = await navigation.openCurrentProfile(); if (opened) setActiveTab("artist"); }
async function openProfile() { exitMobileSearch({ clear: true }); const navigation = await loadNavigation(); const opened = await navigation.openSettings(); setActiveTab(opened ? "profile" : "home"); }

async function observeRole() {
    const auth = await loadAuth();
    unsubscribeAuthState?.();
    unsubscribeAuthState = auth.subscribeToAuthState((state) => {
        setArtistActionsVisible(["artist", "admin"].includes(state.profile?.role));
        syncTabFromView();
    });
}

export function initializeMobileAppShell() {
    if (initialized) return;
    initialized = true;
    void loadReleaseChooser().catch((error) => console.error("Не удалось инициализировать выбор типа релиза.", error));
    void loadUploadWizard().catch((error) => console.error("Не удалось инициализировать мастер загрузки.", error));
    void loadFeedback().catch((error) => console.error("Не удалось инициализировать фидбек.", error));
    initializeCatalogLoadScreen();
    renderNavigationMarkup();
    void observeRole();
    document.addEventListener("click", (event) => {
        const button = event.target.closest("[data-mobile-tab]");
        if (!button || (!isMobileDevice() && window.innerWidth > 768)) return;
        const tab = button.dataset.mobileTab;
        if (tab === "home") void openHome();
        if (tab === "search") void openSearch();
        if (tab === "upload") void openUpload(button);
        if (tab === "artist") void openArtist();
        if (tab === "profile") void openProfile();
    });
    new MutationObserver(syncTabFromView).observe(document.body, { attributes: true, attributeFilter: ["data-app-view", "class"] });
    window.addEventListener("popstate", () => requestAnimationFrame(syncTabFromView));
    syncTabFromView();
}
