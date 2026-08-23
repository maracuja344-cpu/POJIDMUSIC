import {
    createTrackCard,
    observeRevealElement,
    unobserveRevealElement
} from "./render.js";
import { getTrackArtists } from "./artist-utils.js";
import { isPlayableRelease } from "./tracks-utils.js";
import { getCatalogTracks } from "./catalog-state.js";
import { isMobileDevice } from "./mobile.js";
import { syncRenderedTrackCardsWithPlayerState } from "./player.js";
import { hasStableArtistIdentity } from "./profile-routing.js";

let activeSearchContext = null;
let mobileSearchActive = false;
let searchDebounceTimer = null;

function getNormalizedQuery(value) {
    return String(value ?? "").trim().toLowerCase();
}

function findTracks(query) {
    return getCatalogTracks().filter((track) => {
        if (!isPlayableRelease(track)) return false;
        const title = String(track.title || "").toLowerCase();
        const artists = getTrackArtists(track)
            .map((artist) => String(artist.displayName || "").toLowerCase());
        const fallbackArtist = String(track.artist || "").toLowerCase();
        return title.includes(query) ||
            fallbackArtist.includes(query) ||
            artists.some((artist) => artist.includes(query));
    });
}

function findArtists(query) {
    const artistsByKey = new Map();
    getCatalogTracks().forEach((track) => {
        if (!isPlayableRelease(track)) return;
        getTrackArtists(track).forEach((artist) => {
            if (!hasStableArtistIdentity(artist)) return;
            const displayName = String(artist.displayName || "").trim();
            if (!displayName || !displayName.toLowerCase().includes(query)) return;
            const slug = artist.slug;
            const key = artist.id;
            if (!artistsByKey.has(key)) {
                artistsByKey.set(key, { displayName, slug });
            }
        });
    });
    return [...artistsByKey.values()].slice(0, 8);
}

function showMainSections(sections) {
    sections.forEach((section) => { section.style.display = ""; });
}

function hideMainSections(sections) {
    sections.forEach((section) => { section.style.display = "none"; });
}

function clearSearchResults(container) {
    container.querySelectorAll(".reveal-item").forEach(unobserveRevealElement);
    container.replaceChildren();
}

function renderSearchResults(foundTracks, container) {
    foundTracks.forEach((track, index) => {
        const card = createTrackCard(track, {
            loading: index < 4 ? "eager" : "lazy"
        });
        container.append(card);
        observeRevealElement(card);
    });
    syncRenderedTrackCardsWithPlayerState(container);
}

function renderArtistResults(foundArtists, section, container) {
    if (!section || !container) return;
    container.replaceChildren();
    foundArtists.forEach((artist) => {
        const item = document.createElement(artist.slug ? "button" : "span");
        item.className = "search-artist-result";
        item.textContent = artist.displayName;
        if (artist.slug) {
            item.type = "button";
            item.dataset.artistSlug = artist.slug;
        }
        container.append(item);
    });
    section.hidden = foundArtists.length === 0;
}

function updateClearButton(searchInput, clearButton) {
    if (!clearButton) return;
    const visible = getNormalizedQuery(searchInput.value) !== "";
    clearButton.hidden = !visible;
    clearButton.disabled = !visible;
}

function resetSearch(context) {
    const {
        searchResultsSection,
        searchResultsList,
        searchEmpty,
        mainSections,
        searchArtistsSection,
        searchArtistsList,
        searchTracksTitle
    } = context;
    clearSearchResults(searchResultsList);
    renderArtistResults([], searchArtistsSection, searchArtistsList);
    if (searchTracksTitle) searchTracksTitle.hidden = true;
    searchResultsSection.classList.remove("search-visible");
    searchResultsSection.style.display = mobileSearchActive ? "block" : "none";
    if (mobileSearchActive) hideMainSections(mainSections);
    else showMainSections(mainSections);
    searchEmpty.style.display = "none";
}

function showSearchSection(searchResultsSection) {
    searchResultsSection.style.display = "block";
    searchResultsSection.classList.remove("search-visible");
    requestAnimationFrame(() => requestAnimationFrame(() => {
        searchResultsSection.classList.add("search-visible");
    }));
}

function handleSearch(context) {
    const {
        searchInput,
        clearButton,
        searchResultsSection,
        searchResultsList,
        searchEmpty,
        mainSections,
        searchArtistsSection,
        searchArtistsList,
        searchTracksTitle
    } = context;
    const query = getNormalizedQuery(searchInput.value);
    updateClearButton(searchInput, clearButton);
    clearSearchResults(searchResultsList);
    renderArtistResults([], searchArtistsSection, searchArtistsList);
    if (searchTracksTitle) searchTracksTitle.hidden = true;

    if (!query) {
        resetSearch(context);
        return;
    }

    hideMainSections(mainSections);
    showSearchSection(searchResultsSection);
    const foundTracks = findTracks(query);
    const foundArtists = findArtists(query);
    renderSearchResults(foundTracks, searchResultsList);
    renderArtistResults(foundArtists, searchArtistsSection, searchArtistsList);
    if (searchTracksTitle) searchTracksTitle.hidden = foundTracks.length === 0;
    searchEmpty.style.display = foundTracks.length || foundArtists.length
        ? "none"
        : "block";
}

export function initializeSearch() {
    const searchInput = document.querySelector(".search-input");
    const clearButton = document.querySelector(".search-clear-button");
    const cancelButton = document.querySelector(".search-cancel-button");
    const searchResultsSection = document.querySelector("#search-results");
    const searchResultsList = document.querySelector(".search-results-list");
    const searchEmpty = document.querySelector(".search-empty");
    const searchArtistsSection = document.querySelector(".search-artists");
    const searchArtistsList = document.querySelector(".search-artists-list");
    const searchTracksTitle = document.querySelector(".search-tracks-title");
    const mainSections = document.querySelectorAll(
        "#new, #all-tracks, #recommendations"
    );

    if (!searchInput || !clearButton || !searchResultsSection ||
        !searchResultsList || !searchEmpty) return;

    activeSearchContext = {
        searchInput,
        clearButton,
        searchResultsSection,
        searchResultsList,
        searchEmpty,
        mainSections,
        searchArtistsSection,
        searchArtistsList,
        searchTracksTitle
    };

    if (searchInput.dataset.searchInitialized === "true") {
        handleSearch(activeSearchContext);
        return;
    }
    searchInput.dataset.searchInitialized = "true";

    function clearSearch({ preserveDesktopFocus = true } = {}) {
        window.clearTimeout(searchDebounceTimer);
        searchInput.value = "";
        handleSearch(activeSearchContext);
        if (isMobileDevice()) searchInput.blur();
        else if (preserveDesktopFocus) searchInput.focus({ preventScroll: true });
    }

    searchInput.addEventListener("input", () => {
        updateClearButton(searchInput, clearButton);
        window.clearTimeout(searchDebounceTimer);
        searchDebounceTimer = window.setTimeout(() => {
            handleSearch(activeSearchContext);
        }, 180);
    });
    clearButton.addEventListener("click", () => clearSearch());
    cancelButton?.addEventListener("click", () => {
        exitMobileSearch({ clear: true });
        document.querySelector("[data-mobile-tab='home']")?.click();
    });
    searchInput.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;
        if (getNormalizedQuery(searchInput.value)) {
            event.preventDefault();
            clearSearch();
        } else {
            searchInput.blur();
        }
    });
    updateClearButton(searchInput, clearButton);
}

export function refreshActiveSearch() {
    if (!activeSearchContext) return false;
    updateClearButton(
        activeSearchContext.searchInput,
        activeSearchContext.clearButton
    );
    if (!getNormalizedQuery(activeSearchContext.searchInput.value)) return false;
    handleSearch(activeSearchContext);
    return true;
}

export function clearActiveSearch({ preserveDesktopFocus = false } = {}) {
    if (!activeSearchContext) return false;
    window.clearTimeout(searchDebounceTimer);
    activeSearchContext.searchInput.value = "";
    handleSearch(activeSearchContext);
    if (!preserveDesktopFocus) activeSearchContext.searchInput.blur();
    return true;
}

export function enterMobileSearch() {
    if (!activeSearchContext) return false;
    mobileSearchActive = true;
    document.body.classList.add("mobile-search-active");
    handleSearch(activeSearchContext);
    window.scrollTo({ top: 0, behavior: "auto" });
    window.setTimeout(() => {
        activeSearchContext?.searchInput.focus({ preventScroll: true });
    }, 40);
    return true;
}

export function exitMobileSearch({ clear = false } = {}) {
    mobileSearchActive = false;
    document.body.classList.remove("mobile-search-active");
    if (!activeSearchContext) return false;
    window.clearTimeout(searchDebounceTimer);
    if (clear) activeSearchContext.searchInput.value = "";
    activeSearchContext.searchInput.blur();
    handleSearch(activeSearchContext);
    return true;
}
