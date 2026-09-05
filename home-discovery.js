import { renderRecommendations } from "./js/render.js";

function moveRecommendationsBeforeAllTracks() {
    const recommendations = document.querySelector("#recommendations");
    const allTracks = document.querySelector("#all-tracks");
    if (!recommendations || !allTracks || recommendations.nextElementSibling === allTracks) return;
    allTracks.parentNode?.insertBefore(recommendations, allTracks);
}

function decorateNewSection() {
    document.querySelector("#new")?.classList.add("home-new-carousel");
}

function removeCarouselClones() {
    document.querySelectorAll('#recommendations [data-clone="true"]')
        .forEach((clone) => clone.remove());
}

function decorateRecommendations() {
    const section = document.querySelector("#recommendations");
    const title = section?.querySelector(".section-title");
    if (!section || !title) return;

    section.classList.add("home-recommendations-list");
    removeCarouselClones();

    if (!title.querySelector(".home-recommendations-refresh")) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "home-recommendations-refresh";
        button.setAttribute("aria-label", "Обновить рекомендации");
        button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5"></path><path d="M4 17v-5h5"></path><path d="M6.1 8.2A7 7 0 0 1 18.7 10"></path><path d="M17.9 15.8A7 7 0 0 1 5.3 14"></path></svg><span>Обновить</span>';
        button.addEventListener("click", () => {
            renderRecommendations();
            removeCarouselClones();
        });
        title.append(button);
    }
}

function applyHomeDiscoveryLayout() {
    moveRecommendationsBeforeAllTracks();
    decorateNewSection();
    decorateRecommendations();
}

function observeRecommendations() {
    const track = document.querySelector("#recommendations .recommendations-track");
    if (!track || track.dataset.homeDiscoveryObserved === "true") return;
    track.dataset.homeDiscoveryObserved = "true";

    const observer = new MutationObserver(() => {
        removeCarouselClones();
        decorateRecommendations();
    });
    observer.observe(track, { childList: true });
}

function initialize() {
    applyHomeDiscoveryLayout();
    observeRecommendations();

    window.addEventListener("managedtrackchange", applyHomeDiscoveryLayout);
    window.addEventListener("pageshow", applyHomeDiscoveryLayout);
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
} else {
    initialize();
}