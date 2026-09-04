/* Artist Page is always a public storefront. Track management lives only in My Tracks. */

function enforcePublicArtistSurface() {
    if (document.body.dataset.appView !== "artist") return;
    const view = document.querySelector("#artist-profile");
    if (!view) return;

    view.querySelector(".artist-profile-filters")?.remove();

    view.querySelectorAll(".release-card").forEach((card) => {
        const statusBadge = card.querySelector(".track-status-badge");
        if (statusBadge) {
            card.remove();
            return;
        }
        card.querySelectorAll(".track-manage-button, .track-manage-menu").forEach((element) => element.remove());
        card.classList.remove("owner-track-card");
    });
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

const observer = new MutationObserver(scheduleEnforce);
observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["data-app-view"]
});

window.addEventListener("managedtrackchange", scheduleEnforce);
scheduleEnforce();
