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
        button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0 2 5.3"></path><path d="M20 4v7h-7"></path></svg><span>Обновить</span>';
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
