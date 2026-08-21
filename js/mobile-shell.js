import {
    clearActiveSearch,
    enterMobileSearch,
    exitMobileSearch
} from "./search.js";
import { isMobileDevice } from "./mobile.js";

let initialized = false;
let navigationModulePromise = null;

function loadNavigation() {
    navigationModulePromise ||= import("./app-navigation.js");
    return navigationModulePromise;
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
    setActiveTab(["account", "artist", "myTracks"].includes(view)
        ? "profile"
        : "home");
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

async function openProfile() {
    exitMobileSearch({ clear: true });
    const navigation = await loadNavigation();
    const opened = await navigation.openCurrentProfile();
    setActiveTab(opened ? "profile" : "home");
}

export function initializeMobileAppShell() {
    if (initialized) return;
    initialized = true;

    document.addEventListener("click", (event) => {
        const button = event.target.closest("[data-mobile-tab]");
        if (!button || (!isMobileDevice() && window.innerWidth > 768)) return;

        const tab = button.dataset.mobileTab;
        if (tab === "home") void openHome();
        if (tab === "search") void openSearch();
        if (tab === "profile") void openProfile();
    });

    new MutationObserver(syncTabFromView).observe(document.body, {
        attributes: true,
        attributeFilter: ["data-app-view", "class"]
    });

    window.addEventListener("popstate", () => requestAnimationFrame(syncTabFromView));
    syncTabFromView();
}
