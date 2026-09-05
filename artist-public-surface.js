/* Artist Page is always a public storefront. Track management lives only in My Tracks. */

const ARTIST_HERO_VERSION = "97";

function ensureArtistHeroStyles() {
    const existing = document.querySelector(`link[data-artist-hero="${ARTIST_HERO_VERSION}"]`);
    if (existing) return;

    document.querySelectorAll(
        'link[data-artist-hero], link[data-artist-hero-v92], link[data-artist-hero-v95]'
    ).forEach((node) => node.remove());

    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `artist-hero-v92.css?v=${ARTIST_HERO_VERSION}`;
    link.setAttribute("data-artist-hero", ARTIST_HERO_VERSION);
    document.head.append(link);
}

function ensureArtistHeroActions(view) {
    const heroContent = view.querySelector(".artist-hero-content");
    if (!heroContent || heroContent.querySelector(".artist-public-actions")) return;

    const actions = document.createElement("div");
    actions.className = "artist-public-actions";
    actions.setAttribute("aria-label", "Действия артиста");
    actions.innerHTML = `
        <button class="artist-public-play" type="button" data-artist-public-play>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"></path></svg>
            <span>Слушать</span>
        </button>
        <button class="artist-public-shuffle" type="button" data-artist-public-shuffle aria-label="Перемешать релизы">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h3.5c4.8 0 5.7 10 10.5 10H21"></path><path d="m18 14 3 3-3 3"></path><path d="M3 17h3.5c1.8 0 3-1.4 4.2-3.1"></path><path d="M13.1 9.6C14.2 8.1 15.3 7 17 7h4"></path><path d="m18 4 3 3-3 3"></path></svg>
        </button>
        <button class="artist-public-more" type="button" data-artist-public-more aria-label="Ещё">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.7"></circle><circle cx="12" cy="12" r="1.7"></circle><circle cx="19" cy="12" r="1.7"></circle></svg>
        </button>
    `;

    actions.querySelector("[data-artist-public-play]")?.addEventListener("click", () => {
        view.querySelector("[data-artist-tracks] .release-card")?.click();
    });

    actions.querySelector("[data-artist-public-shuffle]")?.addEventListener("click", () => {
        const cards = Array.from(view.querySelectorAll("[data-artist-tracks] .release-card"));
        if (!cards.length) return;
        cards[Math.floor(Math.random() * cards.length)]?.click();
    });

    actions.querySelector("[data-artist-public-more]")?.addEventListener("click", () => {
        const ownerToggle = view.querySelector("[data-toggle-artist-owner-menu]");
        if (ownerToggle instanceof HTMLElement) ownerToggle.click();
    });

    heroContent.append(actions);
}

function cleanArtistTrackCards(view) {
    view.querySelectorAll(".release-card").forEach((card) => {
        const statusBadge = card.querySelector(".track-status-badge");
        if (statusBadge) {
            card.remove();
            return;
        }
        card.querySelectorAll(".track-manage-button, .track-manage-menu")
            .forEach((element) => element.remove());
        card.classList.remove("owner-track-card");
    });
}

function enforcePublicArtistSurface() {
    const view = document.querySelector("#artist-profile");
    if (!view || view.hidden) return;

    view.classList.add("artist-cinematic-v97");
    view.querySelector(".artist-profile-filters")?.remove();
    ensureArtistHeroActions(view);
    cleanArtistTrackCards(view);
}

let scheduled = false;
function scheduleEnforce() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
        scheduled = false;
        enforcePublicArtistSurface();
    });
}

ensureArtistHeroStyles();

const view = document.querySelector("#artist-profile");
const tracks = view?.querySelector("[data-artist-tracks]");

const routeObserver = new MutationObserver(scheduleEnforce);
routeObserver.observe(document.body, {
    attributes: true,
    attributeFilter: ["data-app-view"]
});
if (view) {
    routeObserver.observe(view, {
        attributes: true,
        attributeFilter: ["hidden"]
    });
}
if (tracks) {
    routeObserver.observe(tracks, {
        childList: true
    });
}

window.addEventListener("managedtrackchange", scheduleEnforce);
window.addEventListener("pageshow", scheduleEnforce);
window.addEventListener("popstate", scheduleEnforce);
scheduleEnforce();
