const EXPLICIT_FEATURE_PATTERN = /\s+(?:feat\.?|ft\.?)\s+/i;
const AMBIGUOUS_CREDIT_PATTERN = /(?:&|\/|,|\s+x\s+|\s+with\s+)/i;
export const EXCLUSIVE_POPUP_OPEN_EVENT = "pojidmusic:popup-open";
let artistActionMenuId = 0;
let artistActionMenuHandlersReady = false;


export function normalizeArtistName(value) {
    return String(value ?? "")
        .trim()
        .replace(/\s+/g, " ")
        .toLocaleLowerCase();
}


function stableHash(value) {
    let hash = 2166136261;

    for (const character of value) {
        hash ^= character.codePointAt(0);
        hash = Math.imul(hash, 16777619);
    }

    return (hash >>> 0).toString(36);
}


export function createFallbackArtist(
    displayName,
    role = "primary",
    position = 0
) {
    const cleanName = String(displayName ?? "")
        .trim()
        .replace(/\s+/g, " ");
    const normalizedName = normalizeArtistName(cleanName);

    return Object.freeze({
        id: null,
        displayName: cleanName || "Неизвестный исполнитель",
        normalizedName,
        slug: `credit-${stableHash(normalizedName || "unknown")}`,
        avatarUrl: "",
        bannerUrl: "",
        bio: "",
        linkedProfileId: null,
        role,
        position,
        isFallback: true
    });
}


export function parseLegacyArtistCredit(value) {
    const cleanCredit = String(value ?? "")
        .trim()
        .replace(/\s+/g, " ");

    if (!cleanCredit) {
        return [createFallbackArtist("")];
    }

    if (
        AMBIGUOUS_CREDIT_PATTERN.test(cleanCredit) ||
        !EXPLICIT_FEATURE_PATTERN.test(cleanCredit)
    ) {
        return [createFallbackArtist(cleanCredit)];
    }

    const names = cleanCredit
        .split(EXPLICIT_FEATURE_PATTERN)
        .map((name) => name.trim())
        .filter(Boolean);

    if (names.length < 2) {
        return [createFallbackArtist(cleanCredit)];
    }

    return names.map((name, index) => {
        return createFallbackArtist(
            name,
            index === 0 ? "primary" : "featured",
            index === 0 ? 0 : index - 1
        );
    });
}


export function getTrackArtists(track) {
    if (Array.isArray(track?.artists) && track.artists.length) {
        return track.artists;
    }

    return parseLegacyArtistCredit(track?.artist);
}


export function getArtistDisplayCredit(track) {
    const artists = getTrackArtists(track);
    const primary = artists.filter((artist) => {
        return artist.role !== "featured";
    });
    const featured = artists.filter((artist) => {
        return artist.role === "featured";
    });
    const primaryText = primary
        .map((artist) => artist.displayName)
        .join(" & ");

    return primaryText + (
        featured.length
            ? ` feat. ${featured.map((artist) => artist.displayName).join(", ")}`
            : ""
    );
}


export function createArtistLink(artist) {
    const link = document.createElement("a");
    const targetUrl = new URL(window.location.href);

    targetUrl.searchParams.delete("view");
    targetUrl.searchParams.set("artist", artist.slug);
    targetUrl.hash = "";

    link.className = "artist-link";
    link.href = `${targetUrl.pathname}${targetUrl.search}`;
    link.dataset.artistSlug = artist.slug;
    link.textContent = artist.displayName;
    link.setAttribute(
        "aria-label",
        `Открыть страницу артиста ${artist.displayName}`
    );

    return link;
}


export function renderArtistLinks(container, track) {
    if (!container) return;

    const artists = getTrackArtists(track);
    container.replaceChildren();

    artists.forEach((artist, index) => {
        if (index > 0) {
            const previous = artists[index - 1];
            const separator = document.createElement("span");

            separator.className = "artist-credit-separator";
            separator.textContent =
                artist.role === "featured" &&
                previous.role !== "featured"
                    ? " feat. "
                    : artist.role === "featured"
                        ? ", "
                        : " & ";
            container.append(separator);
        }

        container.append(createArtistLink(artist));
    });
}


export function announceExclusivePopupOpen(owner) {
    window.dispatchEvent(
        new CustomEvent(EXCLUSIVE_POPUP_OPEN_EVENT, {
            detail: { owner }
        })
    );
}


export function renderFullscreenArtistIdentity(
    container,
    track,
    { onSelect = null } = {}
) {
    if (!container) return;

    ensureArtistActionMenuHandlers();
    const artists = getTrackArtists(track).filter((artist) => artist?.slug);
    const artist = artists[0];
    container.replaceChildren();

    if (!artist?.slug) {
        container.hidden = true;
        return;
    }

    const dualArtists = artists.length === 2;
    const multipleArtists = artists.length >= 3;
    const link = multipleArtists
        ? document.createElement("button")
        : createArtistLink(artist);
    const identity = document.createElement("span");
    const label = document.createElement("span");
    const name = document.createElement("span");
    const arrow = document.createElement("span");

    container.hidden = false;
    container.className = "fullscreen-player-artist-identity";
    link.classList.add("fullscreen-player-artist-identity-link");
    link.replaceChildren();

    identity.className = "fullscreen-player-artist-identity-copy";
    label.className = "fullscreen-player-artist-identity-label";
    label.textContent = multipleArtists ? "Исполнители" : "Артист";
    name.className = "fullscreen-player-artist-identity-name";
    name.textContent = multipleArtists
        ? artists.map((candidate) => candidate.displayName).join(", ")
        : artist.displayName;
    identity.append(label, name);

    arrow.className = "fullscreen-player-artist-identity-arrow";
    arrow.textContent = "›";
    arrow.setAttribute("aria-hidden", "true");

    link.append(identity, arrow);

    if (dualArtists) {
        container.classList.add("fullscreen-player-artist-identity-dual");
        container.replaceChildren();
        artists.forEach((candidate) => {
            const artistLink = createArtistLink(candidate);
            const artistName = document.createElement("span");
            artistLink.classList.add("fullscreen-player-artist-zone");
            artistName.className = "fullscreen-player-artist-zone-name";
            artistName.textContent = candidate.displayName;
            artistLink.replaceChildren(artistName);
            artistLink.addEventListener("click", () => onSelect?.(candidate));
            container.append(artistLink);
        });
        return;
    }

    if (!multipleArtists) {
        link.addEventListener("click", () => onSelect?.(artist));
        container.append(link);
        return;
    }

    const menuId = `artist-action-menu-${++artistActionMenuId}`;
    const menu = document.createElement("div");
    const selector = document.createElement("div");
    const selectorLabel = document.createElement("p");

    container.classList.add("artist-action-menu", "artist-action-menu-fullscreen");
    link.type = "button";
    link.classList.add("artist-action-menu-toggle");
    link.setAttribute("aria-expanded", "false");
    link.setAttribute("aria-haspopup", "menu");
    link.setAttribute("aria-controls", menuId);
    link.setAttribute(
        "aria-label",
        `Выбрать исполнителя трека ${track?.title || ""}`.trim()
    );

    menu.id = menuId;
    menu.className = "artist-action-menu-popover";
    menu.setAttribute("role", "menu");
    menu.hidden = true;
    selector.className = "artist-action-menu-selector";
    selectorLabel.className = "artist-action-menu-selector-label";
    selectorLabel.textContent = "Выберите артиста:";
    selector.append(selectorLabel);

    artists.forEach((candidate) => {
        const artistLink = createArtistLink(candidate);
        artistLink.classList.add(
            "artist-action-menu-item",
            "artist-action-menu-selector-item"
        );
        artistLink.setAttribute("role", "menuitem");
        artistLink.addEventListener("click", () => {
            closeArtistActionMenu(container);
            onSelect?.(candidate);
        });
        selector.append(artistLink);
    });

    link.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const shouldOpen = !container.classList.contains("is-open");
        if (shouldOpen) announceExclusivePopupOpen(container);
        closeOtherArtistActionMenus(container);
        container.classList.toggle("is-open", shouldOpen);
        link.setAttribute("aria-expanded", String(shouldOpen));
        menu.hidden = !shouldOpen;
        if (shouldOpen) {
            positionArtistActionMenu(menu);
            selector.querySelector("[role='menuitem']")?.focus();
        }
    });

    menu.append(selector);
    container.append(link, menu);
}


function closeArtistActionMenu(wrapper, restoreFocus = false) {
    if (!wrapper?.classList.contains("is-open")) return;

    const toggle = wrapper.querySelector(".artist-action-menu-toggle");
    const menu = wrapper.querySelector(".artist-action-menu-popover");

    wrapper.classList.remove("is-open");
    toggle?.setAttribute("aria-expanded", "false");
    if (menu) {
        menu.hidden = true;
        resetArtistActionMenu(menu);
    }
    if (restoreFocus) toggle?.focus();
}


function resetArtistActionMenu(menu) {
    const primaryAction = menu?.querySelector(
        ".artist-action-menu-primary"
    );
    const selector = menu?.querySelector(
        ".artist-action-menu-selector"
    );

    if (primaryAction) primaryAction.hidden = false;
    if (selector) selector.hidden = true;
    menu?.classList.remove(
        "artist-action-menu-popover-align-left",
        "artist-action-menu-popover-open-down"
    );
}


function positionArtistActionMenu(menu) {
    if (!menu || menu.hidden) return;

    menu.classList.remove(
        "artist-action-menu-popover-align-left",
        "artist-action-menu-popover-open-down"
    );

    let bounds = menu.getBoundingClientRect();
    if (bounds.left < 12) {
        menu.classList.add("artist-action-menu-popover-align-left");
        bounds = menu.getBoundingClientRect();
    }
    if (bounds.top < 12) {
        menu.classList.add("artist-action-menu-popover-open-down");
    }
}


function closeOtherArtistActionMenus(exception = null) {
    document
        .querySelectorAll(".artist-action-menu.is-open")
        .forEach((wrapper) => {
            if (wrapper !== exception) {
                closeArtistActionMenu(wrapper);
            }
        });
}


function ensureArtistActionMenuHandlers() {
    if (artistActionMenuHandlersReady) return;
    artistActionMenuHandlersReady = true;

    document.addEventListener("pointerdown", (event) => {
        const menu = event.target.closest?.(".artist-action-menu");
        closeOtherArtistActionMenus(menu);
    });

    window.addEventListener(EXCLUSIVE_POPUP_OPEN_EVENT, (event) => {
        const owner = event.detail?.owner;
        const exception = owner?.closest?.(".artist-action-menu") || null;
        closeOtherArtistActionMenus(exception);
    });

    window.addEventListener("scroll", () => {
        closeOtherArtistActionMenus();
    }, { passive: true });

    document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;

        const openMenu = document.querySelector(
            ".artist-action-menu.is-open"
        );
        if (!openMenu) return;

        event.preventDefault();
        event.stopImmediatePropagation();
        closeArtistActionMenu(openMenu, true);
    });
}


export function renderArtistActionMenu(
    container,
    track,
    {
        context = "card",
        onSelect = null
    } = {}
) {
    if (!container) return;

    ensureArtistActionMenuHandlers();
    container.replaceChildren();

    const artists = getTrackArtists(track).filter((artist) => artist?.slug);
    if (!artists.length) {
        container.hidden = true;
        return;
    }

    const menuId = `artist-action-menu-${++artistActionMenuId}`;
    const toggle = document.createElement("button");
    const menu = document.createElement("div");
    const multipleArtists = artists.length > 1;
    const primaryAction = multipleArtists
        ? document.createElement("button")
        : createArtistLink(artists[0]);

    container.hidden = false;
    container.className =
        `artist-action-menu artist-action-menu-${context}`;

    toggle.type = "button";
    toggle.className = "artist-action-menu-toggle";
    toggle.textContent = "•••";
    toggle.setAttribute(
        "aria-label",
        `Открыть меню трека ${track?.title || ""}`.trim()
    );
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-haspopup", "menu");
    toggle.setAttribute("aria-controls", menuId);

    menu.id = menuId;
    menu.className = "artist-action-menu-popover";
    menu.setAttribute("role", "menu");
    menu.hidden = true;

    primaryAction.classList.add(
        "artist-action-menu-item",
        "artist-action-menu-primary"
    );
    primaryAction.textContent = "Исполнители";
    primaryAction.setAttribute("role", "menuitem");

    if (multipleArtists) {
        primaryAction.type = "button";
        primaryAction.setAttribute(
            "aria-label",
            `Выбрать исполнителя трека ${track?.title || ""}`.trim()
        );
    } else {
        primaryAction.setAttribute(
            "aria-label",
            `Открыть страницу исполнителя ${artists[0].displayName}`
        );
        primaryAction.addEventListener("click", () => {
            closeArtistActionMenu(container);
            onSelect?.(artists[0]);
        });
    }

    toggle.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();

        const shouldOpen = !container.classList.contains("is-open");
        if (shouldOpen) announceExclusivePopupOpen(container);
        closeOtherArtistActionMenus(container);
        container.classList.toggle("is-open", shouldOpen);
        toggle.setAttribute("aria-expanded", String(shouldOpen));
        menu.hidden = !shouldOpen;
        if (shouldOpen) {
            resetArtistActionMenu(menu);
            positionArtistActionMenu(menu);
            primaryAction.focus();
        } else {
            resetArtistActionMenu(menu);
        }
    });

    menu.append(primaryAction);

    if (multipleArtists) {
        const selector = document.createElement("div");
        const label = document.createElement("p");

        selector.className = "artist-action-menu-selector";
        selector.hidden = true;
        label.className = "artist-action-menu-selector-label";
        label.textContent = "Выберите артиста:";
        selector.append(label);

        artists.forEach((artist) => {
            const artistLink = createArtistLink(artist);

            artistLink.classList.add(
                "artist-action-menu-item",
                "artist-action-menu-selector-item"
            );
            artistLink.setAttribute("role", "menuitem");
            artistLink.addEventListener("click", () => {
                closeArtistActionMenu(container);
                onSelect?.(artist);
            });
            selector.append(artistLink);
        });

        primaryAction.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            primaryAction.hidden = true;
            selector.hidden = false;
            positionArtistActionMenu(menu);
            selector.querySelector("[role='menuitem']")?.focus();
        });

        menu.append(selector);
    }

    container.append(toggle, menu);
}


export function trackIncludesArtist(track, artist) {
    return getTrackArtists(track).some((candidate) => {
        if (artist?.id && candidate.id) {
            return candidate.id === artist.id;
        }

        return (
            candidate.slug === artist?.slug ||
            candidate.normalizedName === artist?.normalizedName
        );
    });
}
