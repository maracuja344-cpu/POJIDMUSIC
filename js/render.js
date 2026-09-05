import { isPlayableRelease } from "./tracks-utils.js";
import { isMobileDevice } from "./mobile.js";
import {
    getCatalogTracks,
    sortTracksByReleaseDate
} from "./catalog-state.js";
import {
    renderArtistActionMenu,
    renderArtistLinks
} from "./artist-utils.js";
import { syncRenderedTrackCardsWithPlayerState } from "./player.js";
import { configureTrackArtworkImage } from "./artwork.js";

let revealObserver = null;
const REVEAL_FALLBACK_DELAY = 1400;

function revealElement(element) {
    if (
        !element ||
        element.classList.contains("is-visible")
    ) {
        return;
    }

    element.classList.add("is-visible");
    element.dispatchEvent(
        new CustomEvent("revealvisible")
    );
}


/* =========================================================
   1. ПОЛУЧЕНИЕ И СОРТИРОВКА ТРЕКОВ
   ========================================================= */
function getReleaseTracks() {
    return getCatalogTracks().filter(isPlayableRelease);
}

function sortTracksByDate(trackList) {
    return sortTracksByReleaseDate(trackList);
}

function shuffleTracks(trackList) {
    const shuffledTracks = [...trackList];

    for (
        let currentIndex = shuffledTracks.length - 1;
        currentIndex > 0;
        currentIndex--
    ) {
        const randomIndex = Math.floor(
            Math.random() * (currentIndex + 1)
        );

        [
            shuffledTracks[currentIndex],
            shuffledTracks[randomIndex]
        ] = [
            shuffledTracks[randomIndex],
            shuffledTracks[currentIndex]
        ];
    }

    return shuffledTracks;
}


/* =========================================================
   2. СОЗДАНИЕ ОБЫЧНОЙ КАРТОЧКИ ТРЕКА
   ========================================================= */
export function createTrackCard(
    track,
    {
        loading = "lazy",
        showArtistAction = false
    } = {}
) {
    const card = document.createElement("div");
    card.className = "release-card reveal-item";
    card.dataset.trackId = track.catalogId;

    const coverWrap = document.createElement("div");
    coverWrap.className = "cover-wrap track-card-artwork";

    const cover = document.createElement("img");
    cover.className = "cover";
    configureTrackArtworkImage(cover, track.cover, { loading });
    cover.alt = `Обложка трека ${track.title}`;

    const playState = document.createElement("div");
    playState.className = "play-state";
    playState.setAttribute("aria-hidden", "true");
    playState.textContent = "❚❚";

    const info = document.createElement("div");
    info.className = "release-info track-card-info";

    const title = document.createElement("h2");
    title.className = "track-title track-card-title";
    title.textContent = track.title;

    const artist = document.createElement("p");
    artist.className = "artist-name track-card-artist";
    renderArtistLinks(artist, track);

    coverWrap.append(cover, playState);
    info.append(title, artist);
    card.append(coverWrap, info);

    if (showArtistAction) {
        const artistActions = document.createElement("div");
        renderArtistActionMenu(artistActions, track);
        artistActions.classList.add("track-card-actions");
        card.append(artistActions);
    }

    return card;
}


/* =========================================================
   3. СОЗДАНИЕ КАРТОЧКИ РЕКОМЕНДАЦИИ
   ========================================================= */
export function createRecommendationCard(track, { loading = "lazy" } = {}) {
    const card = document.createElement("div");
    card.className = "recommendation-card";
    card.dataset.trackId = track.catalogId;

    const cover = document.createElement("img");
    cover.className = "recommendation-cover cover";
    configureTrackArtworkImage(cover, track.cover, {
        loading,
        sizes: "228px",
        recommendation: true
    });
    cover.alt = `Обложка трека ${track.title}`;

    const info = document.createElement("div");
    info.className = "recommendation-info";

    const title = document.createElement("div");
    title.className = "recommendation-title track-title";
    title.textContent = track.title;

    const artist = document.createElement("div");
    artist.className = "recommendation-artist artist-name";
    renderArtistLinks(artist, track);

    /*
    Recommendations intentionally neutralize the large mobile tap-area
    rules used by generic artist links elsewhere in the app. Those rules
    add min-height/padding and visually push the title to the top.
    Inline !important values keep this component isolated from legacy CSS.
    */
    card.style.setProperty("align-items", "center", "important");
    info.style.setProperty("display", "flex", "important");
    info.style.setProperty("flex-direction", "column", "important");
    info.style.setProperty("justify-content", "center", "important");
    info.style.setProperty("align-items", "flex-start", "important");
    info.style.setProperty("min-height", "50px", "important");
    info.style.setProperty("height", "50px", "important");
    info.style.setProperty("padding", "0", "important");
    info.style.setProperty("margin", "0", "important");
    info.style.setProperty("gap", "4px", "important");

    [title, artist].forEach((node) => {
        node.style.setProperty("position", "static", "important");
        node.style.setProperty("min-height", "0", "important");
        node.style.setProperty("height", "auto", "important");
        node.style.setProperty("margin", "0", "important");
        node.style.setProperty("padding", "0", "important");
        node.style.setProperty("line-height", "1.15", "important");
    });

    artist.querySelectorAll(".artist-link").forEach((link) => {
        link.style.setProperty("display", "inline", "important");
        link.style.setProperty("min-height", "0", "important");
        link.style.setProperty("height", "auto", "important");
        link.style.setProperty("margin", "0", "important");
        link.style.setProperty("padding", "0", "important");
        link.style.setProperty("line-height", "inherit", "important");
    });

    info.append(title, artist);
    card.append(cover, info);

    return card;
}


/* =========================================================
   4. УНИВЕРСАЛЬНЫЙ РЕНДЕР КАРТОЧЕК
   ========================================================= */
function renderCards(
    container,
    trackList,
    createCard
) {
    if (!container) return;

    container
        .querySelectorAll(".reveal-item")
        .forEach((element) => {
            revealObserver?.unobserve(element);
        });

    container.innerHTML = "";

    trackList.forEach((track, index) => {
        const card = createCard(track, index);
        container.append(card);
    });

    syncRenderedTrackCardsWithPlayerState(container);
}


/* =========================================================
   5. РЕНДЕР НОВИНОК
   ========================================================= */
export function renderNewTracks() {
    const container = document.querySelector(
        "#new .tracks-row"
    );

    const newestTracks = sortTracksByDate(
        getReleaseTracks()
    ).slice(0, 4);

    renderCards(
        container,
        newestTracks,
        (track) => createTrackCard(track, { loading: "eager" })
    );
}


/* =========================================================
   6. РЕНДЕР ВСЕХ ТРЕКОВ
   ========================================================= */
export function renderAllTracks() {
    const container = document.querySelector(
        "#all-tracks .tracks-row"
    );

    const allReleaseTracks = sortTracksByDate(
        getReleaseTracks()
    );

    renderCards(
        container,
        allReleaseTracks,
        createTrackCard
    );
}


/* =========================================================
   7. РЕНДЕР РЕКОМЕНДАЦИЙ
   ========================================================= */
export function renderRecommendations() {
    const container = document.querySelector(
        "#recommendations .recommendations-track"
    );

    const recommendedTracks = shuffleTracks(
        getReleaseTracks()
    ).slice(0, 6);

    renderCards(
        container,
        recommendedTracks,
        createRecommendationCard
    );
}


/* =========================================================
   8. АНИМАЦИЯ ПОЯВЛЕНИЯ КАРТОЧЕК
   ========================================================= */
export function observeRevealElement(element) {
    if (!element || element.classList.contains("is-visible")) {
        return;
    }

    if (
        isMobileDevice() ||
        !("IntersectionObserver" in window) ||
        !revealObserver
    ) {
        revealElement(element);
        return;
    }

    try {
        revealObserver.observe(element);

        window.setTimeout(() => {
            if (
                !element.classList.contains(
                    "is-visible"
                )
            ) {
                revealElement(element);
                revealObserver?.unobserve(element);
            }
        }, REVEAL_FALLBACK_DELAY);
    } catch (error) {
        revealElement(element);
    }
}

export function unobserveRevealElement(element) {
    revealObserver?.unobserve(element);
}

export function initializeCardAnimations() {
    if (
        "IntersectionObserver" in window &&
        revealObserver === null
    ) {
        try {
            revealObserver = new IntersectionObserver(
                (entries, observer) => {
                    entries.forEach((entry) => {
                        if (!entry.isIntersecting) return;

                        revealElement(entry.target);
                        observer.unobserve(entry.target);
                    });
                },
                {
                    threshold: 0.12,
                    rootMargin: "0px 0px -40px 0px"
                }
            );
        } catch (error) {
            revealObserver = null;
        }
    }

    document
        .querySelectorAll(
            ".release-card.reveal-item, " +
            ".recommendations-section.reveal-section"
        )
        .forEach(observeRevealElement);
}
