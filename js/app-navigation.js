import {
    getCatalogTracks,
    sortTracksByReleaseDate
} from "./catalog-state.js";
import {
    createTrackCard,
    observeRevealElement,
    unobserveRevealElement
} from "./render.js";
import {
    announceExclusivePopupOpen,
    EXCLUSIVE_POPUP_OPEN_EVENT,
    getTrackArtists,
    trackIncludesArtist
} from "./artist-utils.js";
import { clearActiveSearch } from "./search.js";
import { isPlayableRelease } from "./tracks-utils.js";
import {
    uploadAccountAvatar,
    uploadArtistMedia,
    saveArtistCrop
} from "./artist-media.js";
import { getOwnedArtistTracks } from "./tracks-api.js";
import { applyFocalBackground, openImageCropper } from "./image-cropper.js";
import {
    decorateManagedTrackCard,
    initializeTrackManagement
} from "./track-management.js";
import { supabase } from "./supabase/client.js";
import { syncRenderedTrackCardsWithPlayerState } from "./player.js";
import {
    getArtistRow,
    invalidateArtistData
} from "./data-repository.js";
import {
    applyArtworkBackground,
    ARTWORK_WIDTHS
} from "./artwork.js";
import {
    getProfileDestination,
    isArtistOwner
} from "./profile-routing.js";

const DEFAULT_TITLE = "POJIDMUSIC";
const ARTIST_MEDIA_BUCKET = "artist-media";
const ROLE_LABELS = {
    listener: "Слушатель",
    artist: "Артист",
    admin: "Администратор"
};

let navigationInitialized = false;
let routeRenderId = 0;
let authModulePromise = null;
let unsubscribeAuthState = null;
let linkedArtist = null;
let renderedArtist = null;
let renderedArtistOwner = false;
let activeArtistTrackFilter = "published";
const artistColorCache = new Map();

function getElements() {
    return {
        catalog: document.querySelector("#catalog-view"),
        settings: document.querySelector("#account-profile"),
        artist: document.querySelector("#artist-profile"),
        myTracks: document.querySelector("#my-tracks")
    };
}

function getHttpUrl(value) {
    if (!value) return "";
    try {
        const url = new URL(value, window.location.href);
        return ["http:", "https:"].includes(url.protocol) ? url.href : "";
    } catch {
        return "";
    }
}

function getArtistMediaUrl(supabase, path, fallbackUrl, updatedAt) {
    if (!path) return fallbackUrl || "";
    const { data } = supabase.storage.from(ARTIST_MEDIA_BUCKET).getPublicUrl(path);
    const url = data?.publicUrl || fallbackUrl || "";
    return url && updatedAt
        ? `${url}?v=${encodeURIComponent(updatedAt)}`
        : url;
}

function mapArtistRow(row, supabase) {
    return Object.freeze({
        id: row.id,
        displayName: row.display_name,
        normalizedName: row.normalized_name,
        slug: row.slug,
        avatarUrl: getArtistMediaUrl(
            supabase,
            row.avatar_path,
            row.avatar_url,
            row.updated_at
        ),
        bannerUrl: getArtistMediaUrl(
            supabase,
            row.banner_path,
            row.banner_url,
            row.updated_at
        ),
        avatarPath: row.avatar_path || "",
        bannerPath: row.banner_path || "",
        bio: row.bio || "",
        linkedProfileId: row.linked_profile_id || null,
        avatarCrop: Object.freeze({
            x: Number(row.avatar_focal_x ?? 0.5),
            y: Number(row.avatar_focal_y ?? 0.5),
            zoom: Number(row.avatar_zoom ?? 1)
        }),
        bannerCrop: Object.freeze({
            x: Number(row.banner_focal_x ?? 0.5),
            y: Number(row.banner_focal_y ?? 0.5),
            zoom: Number(row.banner_zoom ?? 1)
        }),
        updatedAt: row.updated_at || "",
        role: "primary",
        position: 0,
        isFallback: false
    });
}

function setAvatar(element, name, url, crop) {
    if (!element) return;
    const safeUrl = getHttpUrl(url);
    const initials = String(name || "?")
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0] || "")
        .join("")
        .toLocaleUpperCase();
    if (element.matches("[data-artist-avatar]")) {
        let initialsElement = element.querySelector(".profile-avatar-initials");
        if (!initialsElement) {
            initialsElement = document.createElement("span");
            initialsElement.className = "profile-avatar-initials";
            element.prepend(initialsElement);
        }
        initialsElement.textContent = safeUrl ? "" : initials;
    } else {
        element.textContent = safeUrl ? "" : initials;
    }
    applyArtworkBackground(
        element,
        safeUrl,
        {
            width: ARTWORK_WIDTHS.avatar,
            height: ARTWORK_WIDTHS.avatar,
            resize: "contain"
        },
        (backgroundUrl) => applyFocalBackground(element, backgroundUrl, crop)
    );
    element.classList.toggle("has-image", Boolean(safeUrl));
}

function setActiveView(viewName) {
    const elements = getElements();
    if (Object.values(elements).some((element) => !element)) return;
    Object.entries(elements).forEach(([name, element]) => {
        element.hidden = name !== viewName;
    });
    document.body.dataset.appView = viewName;
    if (viewName !== "artist") resetArtistAmbient();
}

function getRoute() {
    const url = new URL(window.location.href);
    const artistSlug = url.searchParams.get("artist")?.trim();
    if (artistSlug) return { name: "artist", artistSlug };
    if (["settings", "account"].includes(url.searchParams.get("view"))) {
        return { name: "settings" };
    }
    if (url.searchParams.get("view") === "my-tracks") return { name: "myTracks" };
    return { name: "catalog" };
}

function buildRouteUrl(route) {
    const url = new URL(window.location.href);
    url.searchParams.delete("artist");
    url.searchParams.delete("view");
    url.hash = "";
    if (route.name === "artist") url.searchParams.set("artist", route.artistSlug);
    if (route.name === "settings") url.searchParams.set("view", "settings");
    if (route.name === "myTracks") url.searchParams.set("view", "my-tracks");
    return `${url.pathname}${url.search}`;
}

function closeProfileMenu() {
    const menu = document.querySelector(".profile-menu");
    const button = document.querySelector(".auth-profile-button");
    if (menu) menu.hidden = true;
    button?.setAttribute("aria-expanded", "false");
}

function setArtistOwnerMenuOpen(
    open,
    {
        restoreFocus = false,
        focusFirstItem = false
    } = {}
) {
    const wrapper = document.querySelector(".artist-owner-menu");
    const toggle = wrapper?.querySelector("[data-toggle-artist-owner-menu]");
    const popover = wrapper?.querySelector(".artist-owner-menu-popover");
    if (!wrapper || !toggle || !popover) return;

    if (open) announceExclusivePopupOpen(wrapper);
    wrapper.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    popover.hidden = !open;

    if (focusFirstItem) {
        popover.querySelector("[role='menuitem']")?.focus();
    } else if (restoreFocus) {
        toggle.focus();
    }
}

function findCatalogArtist(slug) {
    for (const track of getCatalogTracks()) {
        const artist = getTrackArtists(track).find((candidate) => candidate.slug === slug);
        if (artist) return artist;
    }
    return null;
}

async function queryArtist(column, value, { onUpdate } = {}) {
    try {
        const row = await getArtistRow(column, value, {
            onUpdate: (nextRow) => {
                onUpdate?.(
                    nextRow
                        ? mapArtistRow(nextRow, supabase)
                        : null
                );
            }
        });
        return row ? mapArtistRow(row, supabase) : null;
    } catch {
        return null;
    }
}

const fetchArtistBySlug = (slug) => queryArtist("slug", slug, {
    onUpdate: () => {
        if (getRoute().artistSlug === slug) {
            void renderArtistView(slug);
        }
    }
});
const fetchLinkedArtist = (profileId) => profileId
    ? queryArtist("linked_profile_id", profileId, {
        onUpdate: (artist) => {
            linkedArtist = artist;
            updateProfileMenu(artist);
            if (["settings", "myTracks"].includes(getRoute().name)) {
                void renderRoute();
            }
        }
    })
    : Promise.resolve(null);

function clearTrackCards(container) {
    container?.querySelectorAll(".reveal-item").forEach(unobserveRevealElement);
    container?.replaceChildren();
}

function createArtistTrackSkeleton() {
    const card = document.createElement("div");
    card.className = "release-card track-skeleton";
    card.setAttribute("aria-hidden", "true");
    card.innerHTML = [
        '<span class="track-skeleton-cover"></span>',
        '<span class="track-skeleton-copy">',
        '<span class="track-skeleton-line track-skeleton-title"></span>',
        '<span class="track-skeleton-line track-skeleton-artist"></span>',
        "</span>"
    ].join("");
    return card;
}

function showArtistLoadingShell(view, artistName) {
    view.classList.add("is-loading");
    view.setAttribute("aria-busy", "true");
    view.querySelector("[data-artist-name]").textContent = artistName || "Артист";
    view.querySelector("[data-artist-release-count]").textContent = "";
    const tracks = view.querySelector("[data-artist-tracks]");
    clearTrackCards(tracks);
    tracks?.replaceChildren(...Array.from(
        { length: 4 },
        createArtistTrackSkeleton
    ));
}

function renderTrackCards(
    container,
    tracks,
    {
        canManage = false,
        profileId = null,
        showArtistAction = false
    } = {}
) {
    clearTrackCards(container);
    tracks.forEach((track, index) => {
        const card = createTrackCard(track, {
            loading: index < 4 ? "eager" : "lazy",
            showArtistAction
        });
        if (canManage && (
            track.ownerId === profileId ||
            getCurrentProfileRole() === "admin"
        )) decorateManagedTrackCard(card, track);
        container.append(card);
        observeRevealElement(card);
    });
    syncRenderedTrackCardsWithPlayerState(container);
}

function getCurrentProfileRole() {
    return document.body.dataset.currentProfileRole || "";
}

function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
}

function darkAccent(red, green, blue, alpha) {
    const maximum = Math.max(red, green, blue);
    const minimum = Math.min(red, green, blue);
    const saturation = maximum - minimum;
    const boost = maximum < 70 ? 1.55 : maximum > 190 ? 0.62 : 0.9;
    const neutral = (red + green + blue) / 3;
    const saturationScale = saturation < 24 ? 1.15 : 0.78;
    const channel = (value) => clamp(
        Math.round((neutral + (value - neutral) * saturationScale) * boost),
        28,
        155
    );
    return `rgba(${channel(red)}, ${channel(green)}, ${channel(blue)}, ${alpha})`;
}

function sampleBannerColors(url, crop = { x: 0.5, y: 0.5, zoom: 1 }) {
    const cacheKey = `${url}|${crop.x}|${crop.y}|${crop.zoom}`;
    if (artistColorCache.has(cacheKey)) return artistColorCache.get(cacheKey);
    const promise = new Promise((resolve, reject) => {
        const image = new Image();
        image.crossOrigin = "anonymous";
        image.onload = () => {
            try {
                const canvas = document.createElement("canvas");
                canvas.width = 64;
                canvas.height = 36;
                const context = canvas.getContext("2d", { willReadFrequently: true });
                const coverScale = Math.max(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
                const width = image.naturalWidth * coverScale * crop.zoom;
                const height = image.naturalHeight * coverScale * crop.zoom;
                const x = clamp(canvas.width / 2 - crop.x * width, canvas.width - width, 0);
                const y = clamp(canvas.height / 2 - crop.y * height, canvas.height - height, 0);
                context.drawImage(image, x, y, width, height);
                const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
                const totals = [[0, 0, 0, 0], [0, 0, 0, 0]];
                for (let index = 0; index < pixels.length; index += 4) {
                    if (pixels[index + 3] < 128) continue;
                    const pixelIndex = index / 4;
                    const x = pixelIndex % canvas.width;
                    const y = Math.floor(pixelIndex / canvas.width);
                    if (y < canvas.height * 0.5) continue;
                    const zone = x <= canvas.width * 0.62
                        ? 0
                        : x >= canvas.width * 0.68
                            ? 1
                            : -1;
                    if (zone < 0) continue;
                    totals[zone][0] += pixels[index];
                    totals[zone][1] += pixels[index + 1];
                    totals[zone][2] += pixels[index + 2];
                    totals[zone][3] += 1;
                }
                const averages = totals.map((total) => {
                    const count = Math.max(total[3], 1);
                    return [total[0] / count, total[1] / count, total[2] / count];
                });
                const luminance = ([red, green, blue]) =>
                    (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
                resolve({
                    colors: averages.map((color, index) => darkAccent(...color, index === 0 ? 0.12 : 0.08)),
                    identityLuminance: luminance(averages[0]),
                    controlsLuminance: luminance(averages[1])
                });
            } catch (error) {
                reject(error);
            }
        };
        image.onerror = reject;
        image.src = url;
    }).catch(() => null);
    artistColorCache.set(cacheKey, promise);
    return promise;
}

function resetArtistAmbient() {
    document.body.style.removeProperty("--artist-accent-1");
    document.body.style.removeProperty("--artist-accent-2");
    const hero = document.querySelector(".artist-hero");
    hero?.style.removeProperty("--hero-overlay");
    hero?.style.removeProperty("--hero-text");
    hero?.style.removeProperty("--hero-muted");
    hero?.style.removeProperty("--hero-text-shadow");
    hero?.style.removeProperty("--hero-control-bg");
    hero?.style.removeProperty("--hero-control-fg");
    hero?.style.removeProperty("--hero-control-border");
    hero?.style.removeProperty("--hero-control-shadow");
}

async function applyArtistAmbient(url, crop, expectedRenderId) {
    resetArtistAmbient();
    if (!url) return;
    const colors = await sampleBannerColors(url, crop);
    if (!colors || expectedRenderId !== routeRenderId || getRoute().name !== "artist") return;
    document.body.style.setProperty("--artist-accent-1", colors.colors[0]);
    document.body.style.setProperty("--artist-accent-2", colors.colors[1]);
    const hero = document.querySelector(".artist-hero");
    const identityIsBright = colors.identityLuminance > 0.58;
    const controlsAreBright = colors.controlsLuminance > 0.56;
    hero?.style.setProperty("--hero-overlay", String(identityIsBright ? 0.16 : 0.34));
    hero?.style.setProperty("--hero-text", identityIsBright ? "#151319" : "#fff");
    hero?.style.setProperty("--hero-muted", identityIsBright ? "rgba(21,19,25,.72)" : "rgba(255,255,255,.76)");
    hero?.style.setProperty("--hero-text-shadow", identityIsBright
        ? "0 0 2px rgba(255,255,255,.92), 0 1px 16px rgba(255,255,255,.62)"
        : "0 2px 20px rgba(0,0,0,.55)");
    hero?.style.setProperty("--hero-control-bg", controlsAreBright
        ? "rgba(17,16,20,.76)"
        : "rgba(255,255,255,.84)");
    hero?.style.setProperty("--hero-control-fg", controlsAreBright ? "#fff" : "#17151b");
    hero?.style.setProperty("--hero-control-border", controlsAreBright
        ? "rgba(255,255,255,.24)"
        : "rgba(255,255,255,.58)");
    hero?.style.setProperty("--hero-control-shadow", controlsAreBright
        ? "0 8px 26px rgba(0,0,0,.32)"
        : "0 8px 26px rgba(0,0,0,.25)");
}

async function getAuthModule() {
    authModulePromise ||= import("./auth.js");
    return authModulePromise;
}

function setArtistMediaStatus(text, type = "") {
    const status = document.querySelector("[data-artist-media-controls] .artist-media-status");
    if (!status) return;
    status.textContent = text;
    status.dataset.type = type;
}

async function renderArtistView(slug) {
    const view = document.querySelector("#artist-profile");
    if (!view) return;
    const renderId = ++routeRenderId;
    let artist = findCatalogArtist(slug);
    const loadingTimer = window.setTimeout(() => {
        if (renderId !== routeRenderId || getRoute().artistSlug !== slug) return;
        showArtistLoadingShell(view, artist?.displayName);
    }, 130);
    const storedArtist = await fetchArtistBySlug(slug);
    window.clearTimeout(loadingTimer);
    artist = storedArtist || artist;
    if (renderId !== routeRenderId || getRoute().artistSlug !== slug) return;
    view.classList.remove("is-loading");
    view.removeAttribute("aria-busy");

    renderedArtist = artist;
    const artistName = artist?.displayName || "Артист не найден";
    let tracks = artist
        ? sortTracksByReleaseDate(getCatalogTracks().filter((track) => (
            isPlayableRelease(track) && trackIncludesArtist(track, artist)
        )))
        : [];
    view.querySelector("[data-artist-name]").textContent = artistName;
    view.querySelector("[data-artist-release-count]").textContent = `${tracks.length} ${tracks.length === 1 ? "релиз" : "релизов"}`;
    const bio = view.querySelector("[data-artist-bio]");
    if (bio) {
        bio.textContent = artist?.bio || "";
        bio.hidden = !artist?.bio;
    }
    setAvatar(view.querySelector("[data-artist-avatar]"), artistName, artist?.avatarUrl, artist?.avatarCrop);

    const banner = view.querySelector("[data-artist-banner]");
    const bannerUrl = getHttpUrl(artist?.bannerUrl);
    const deliveredBannerUrl = applyArtworkBackground(
        banner,
        bannerUrl,
        {
            width: ARTWORK_WIDTHS.banner,
            height: ARTWORK_WIDTHS.banner,
            quality: 82,
            resize: "contain"
        },
        (backgroundUrl) => applyFocalBackground(
            banner,
            backgroundUrl,
            artist?.bannerCrop
        )
    );
    banner.classList.toggle("has-image", Boolean(bannerUrl));

    const auth = await getAuthModule();
    const authState = auth.getCurrentAuthState();
    document.body.dataset.currentProfileRole = authState.profile?.role || "";
    const owner = isArtistOwner(artist, authState.user?.id);
    renderedArtistOwner = owner;
    view.querySelector(".artist-hero")?.classList.toggle("is-owner", owner);
    if (owner) {
        try {
            const managed = await getOwnedArtistTracks(artist.id, { existingTracks: tracks });
            const byId = new Map(tracks.map((track) => [track.id, track]));
            managed.forEach((track) => byId.set(track.id, track));
            tracks = sortTracksByReleaseDate([...byId.values()]);
        } catch (error) {
            console.warn("Не удалось загрузить owner-состояния треков.", error);
        }
    }
    if (renderId !== routeRenderId) return;
    renderArtistTracks(view, tracks, owner, authState.profile?.id);
    view.querySelector("[data-artist-media-controls]").hidden = !owner;
    view.querySelector("[data-artist-owner-actions]").hidden = !owner;
    view.querySelectorAll("[data-change-artist-avatar], [data-change-artist-banner]")
        .forEach((control) => { control.hidden = !owner; });
    setArtistMediaStatus("");
    document.title = `${artistName} — ${DEFAULT_TITLE}`;
    void applyArtistAmbient(deliveredBannerUrl, artist?.bannerCrop, renderId);
}

function renderArtistTracks(view, tracks, owner, profileId) {
    let filters = view.querySelector(".artist-profile-filters");
    if (owner && !filters) {
        filters = document.createElement("div");
        filters.className = "artist-profile-filters";
        [["published", "Опубликованные"], ["hidden", "Скрытые"], ["pending", "На проверке"]].forEach(([value, label]) => {
            const button = document.createElement("button");
            button.type = "button"; button.className = "artist-profile-filter";
            button.dataset.artistTrackFilter = value; button.textContent = label;
            button.addEventListener("click", () => {
                activeArtistTrackFilter = value;
                renderArtistTracks(view, tracks, owner, profileId);
            });
            filters.append(button);
        });
        view.querySelector(".artist-releases .section-title")?.after(filters);
    }
    if (!owner) { filters?.remove(); filters = null; activeArtistTrackFilter = "published"; }
    filters?.querySelectorAll("button").forEach((button) => button.classList.toggle("is-active", button.dataset.artistTrackFilter === activeArtistTrackFilter));
    const effectiveStatus = (track) => track.status || "published";
    const visible = tracks.filter((track) => owner ? effectiveStatus(track) === activeArtistTrackFilter : effectiveStatus(track) === "published");
    renderTrackCards(view.querySelector("[data-artist-tracks]"), visible, {
        canManage: owner,
        profileId,
        showArtistAction: false
    });
    view.querySelector("[data-artist-empty]").hidden = visible.length > 0;
    view.querySelector("[data-artist-release-count]").textContent = `${tracks.filter((track) => effectiveStatus(track) === "published").length} релизов`;
}

function updateProfileMenu(artist) {
    const profile = document.querySelector("[data-profile-action='profile']");
    const myTracks = document.querySelector("[data-profile-action='tracks']");
    const artistPage = document.querySelector("[data-profile-action='artist']");
    if (myTracks) myTracks.hidden = !artist;
    if (artistPage) artistPage.hidden = !artist;
    if (profile) profile.hidden = false;
}

async function refreshLinkedArtist(profileId) {
    linkedArtist = await fetchLinkedArtist(profileId);
    updateProfileMenu(linkedArtist);
    return linkedArtist;
}

async function renderAccountView() {
    const view = document.querySelector("#account-profile");
    if (!view) return;
    const renderId = ++routeRenderId;
    const auth = await getAuthModule();
    const state = auth.getCurrentAuthState();
    const profile = state.profile;
    const name = profile?.display_name?.trim() ||
        state.user?.user_metadata?.display_name?.trim() ||
        state.user?.email || "Профиль";
    if (renderId !== routeRenderId || getRoute().name !== "settings") return;

    view.querySelector("[data-account-name]").textContent = name;
    view.querySelector("[data-account-meta]").textContent = state.user
        ? "Данные аккаунта"
        : "Войдите, чтобы открыть профиль";
    view.querySelector("[data-account-username]").textContent = profile?.username
        ? `@${profile.username}`
        : "Не задано";
    view.querySelector("[data-account-role]").textContent = ROLE_LABELS[profile?.role] || "Профиль загружается";
    view.querySelector("[data-account-email]").textContent = state.user?.email || "—";
    setAvatar(view.querySelector("[data-account-avatar]"), name, profile?.avatar_url);
    view.querySelector("[data-account-actions]").hidden = !state.user;

    const artist = profile ? await refreshLinkedArtist(profile.id) : null;
    if (renderId !== routeRenderId || getRoute().name !== "settings") return;
    view.querySelector("[data-account-my-tracks]").hidden = !artist;
    view.querySelector("[data-account-artist-page]").hidden = !artist;
    document.title = `Настройки — ${DEFAULT_TITLE}`;
}

function trackHasStructuredArtist(track, artistId) {
    return getTrackArtists(track).some((candidate) => (
        !candidate.isFallback && candidate.id === artistId
    ));
}

async function renderMyTracksView() {
    const view = document.querySelector("#my-tracks");
    if (!view) return;
    const renderId = ++routeRenderId;
    const auth = await getAuthModule();
    const profileId = auth.getCurrentAuthState().profile?.id;
    const artist = await refreshLinkedArtist(profileId);
    if (renderId !== routeRenderId || getRoute().name !== "myTracks") return;

    const tracks = artist
        ? sortTracksByReleaseDate(getCatalogTracks().filter((track) => (
            isPlayableRelease(track) && trackHasStructuredArtist(track, artist.id)
        )))
        : [];
    view.querySelector("[data-my-tracks-description]").textContent = artist
        ? `Опубликованные релизы, где указан артист ${artist.displayName}.`
        : "Раздел доступен аккаунту, связанному с артистом.";
    renderTrackCards(view.querySelector("[data-my-tracks-list]"), tracks);
    view.querySelector("[data-my-tracks-empty]").hidden = tracks.length > 0;
    document.title = `Мои треки — ${DEFAULT_TITLE}`;
}

async function renderRoute({ scroll = false } = {}) {
    announceExclusivePopupOpen(null);
    setArtistOwnerMenuOpen(false);
    const route = getRoute();
    setActiveView(route.name);
    if (route.name === "artist") await renderArtistView(route.artistSlug);
    else if (route.name === "settings") await renderAccountView();
    else if (route.name === "myTracks") await renderMyTracksView();
    else {
        ++routeRenderId;
        renderedArtist = null;
        document.title = DEFAULT_TITLE;
    }
    syncRenderedTrackCardsWithPlayerState();
    if (scroll) window.scrollTo({ top: 0, behavior: "smooth" });
}

export async function openCurrentProfile({ scroll = true } = {}) {
    const auth = await getAuthModule();
    let state = auth.getCurrentAuthState();

    if (!state.user) {
        document.querySelector(".auth-open-button")?.click();
        return false;
    }

    if (state.profileState !== "ready") {
        await auth.reloadCurrentProfile();
        state = auth.getCurrentAuthState();
    }

    const artist = await refreshLinkedArtist(state.profile?.id);
    navigate(getProfileDestination({
        user: state.user,
        profile: state.profile,
        artist
    }), { scroll });
    return true;
}


export async function openSettings({ scroll = true } = {}) {
    const auth = await getAuthModule();
    if (!auth.getCurrentAuthState().user) {
        document.querySelector(".auth-open-button")?.click();
        return false;
    }
    navigate({ name: "settings" }, { scroll });
    return true;
}

export function openCatalogView({ scroll = true } = {}) {
    clearActiveSearch();
    navigate({ name: "catalog" }, { scroll });
}

function navigate(route, { replace = false, scroll = true } = {}) {
    history[replace ? "replaceState" : "pushState"]({}, "", buildRouteUrl(route));
    void renderRoute({ scroll });
}

async function handleAccountAvatar(file) {
    const message = document.querySelector("#account-profile .profile-form-message");
    const button = document.querySelector("[data-change-account-avatar]");
    const auth = await getAuthModule();
    try {
        button.disabled = true;
        message.textContent = "Подготавливаем и загружаем аватар…";
        message.dataset.type = "";
        await uploadAccountAvatar(file, auth.getCurrentAuthState());
        await auth.reloadCurrentProfile();
        message.textContent = "Аватар обновлён.";
        message.dataset.type = "success";
        await renderAccountView();
    } catch (error) {
        console.error("Не удалось обновить аватар аккаунта:", error);
        message.textContent = error?.message || "Не удалось обновить аватар.";
        message.dataset.type = "error";
    } finally {
        button.disabled = false;
    }
}

async function handleArtistMedia(file, kind) {
    const controls = document.querySelector("[data-artist-media-controls]");
    const buttons = controls.querySelectorAll("button");
    try {
        buttons.forEach((button) => { button.disabled = true; });
        setArtistMediaStatus(`Настройте кадр для ${kind === "avatar" ? "аватара" : "баннера"}.`);
        const result = await openImageCropper({ source: file, mode: kind, upload: true });
        setArtistMediaStatus("Загружаем изображение…");
        await uploadArtistMedia(file, renderedArtist, kind, result.crop, result.blob);
        setArtistMediaStatus("Изображение обновлено.", "success");
        await renderArtistView(renderedArtist.slug);
    } catch (error) {
        console.error("Не удалось обновить медиа артиста:", error);
        setArtistMediaStatus(error?.message || "Не удалось обновить изображение.", "error");
    } finally {
        buttons.forEach((button) => { button.disabled = false; });
    }
}

async function recropArtistMedia(kind) {
    const url = kind === "avatar" ? renderedArtist?.avatarUrl : renderedArtist?.bannerUrl;
    if (!url) {
        document.querySelector(`[data-artist-${kind}-input]`)?.click();
        return;
    }
    try {
        const crop = kind === "avatar" ? renderedArtist.avatarCrop : renderedArtist.bannerCrop;
        const result = await openImageCropper({
            source: url,
            mode: kind,
            crop,
            upload: false,
            allowReplace: true
        });
        if (result.replacementFile) {
            await uploadArtistMedia(
                result.replacementFile,
                renderedArtist,
                kind,
                result.crop,
                result.blob
            );
        } else {
            await saveArtistCrop(renderedArtist, kind, result.crop);
        }
        await renderArtistView(renderedArtist.slug);
    } catch (error) {
        if (error?.name !== "AbortError") setArtistMediaStatus(error?.message || "Не удалось изменить кадр.", "error");
    }
}

function closeProfileEditor() {
    const modal = document.querySelector("[data-profile-editor-modal]");
    if (modal) modal.hidden = true;
}

async function openProfileEditor() {
    if (!renderedArtistOwner || !renderedArtist) return;
    const auth = await getAuthModule();
    const state = auth.getCurrentAuthState();
    const form = document.querySelector("[data-profile-editor-form]");
    form.elements.display_name.value = renderedArtist.displayName;
    const usernameField = form.querySelector("[data-profile-username-field]");
    usernameField.hidden = !state.profile?.username;
    form.elements.handle.value = state.profile?.username ? `@${state.profile.username}` : "";
    form.elements.email.value = state.user?.email || "";
    form.elements.role.value = ROLE_LABELS[state.profile?.role] || state.profile?.role || "";
    form.querySelector("[data-profile-editor-status]").textContent = "";
    const modal = document.querySelector("[data-profile-editor-modal]");
    announceExclusivePopupOpen(modal);
    modal.hidden = false;
    form.elements.display_name.focus();
}

async function saveProfileEditor(event) {
    event.preventDefault();
    if (!renderedArtistOwner || !renderedArtist) return;
    const form = event.currentTarget;
    const status = form.querySelector("[data-profile-editor-status]");
    const submit = form.querySelector("[type='submit']");
    try {
        submit.disabled = true;
        status.textContent = "Сохраняем…";
        const { error } = await supabase.rpc("update_artist_profile", {
            target_artist_id: renderedArtist.id,
            new_display_name: form.elements.display_name.value
        });
        if (error) throw error;
        invalidateArtistData();
        const slug = renderedArtist.slug;
        closeProfileEditor();
        const { refreshCatalog } = await import("./script.js");
        await refreshCatalog({ force: true, source: "artist-profile" });
        await renderArtistView(slug);
    } catch (error) {
        status.textContent = error?.message || "Не удалось сохранить профиль.";
        status.dataset.type = "error";
    } finally { submit.disabled = false; }
}

export function refreshActiveRoute() {
    const route = getRoute();
    if (["artist", "myTracks"].includes(route.name)) {
        void renderRoute();
        return true;
    }
    return false;
}

export function initializeAppNavigation() {
    if (navigationInitialized) {
        void renderRoute();
        return;
    }
    const elements = getElements();
    if (Object.values(elements).some((element) => !element)) return;
    navigationInitialized = true;

    document.addEventListener("click", (event) => {
        const ownerMenuToggle = event.target.closest(
            "[data-toggle-artist-owner-menu]"
        );
        if (ownerMenuToggle) {
            event.preventDefault();
            event.stopPropagation();
            const willOpen = ownerMenuToggle.getAttribute("aria-expanded") !== "true";
            setArtistOwnerMenuOpen(willOpen, {
                focusFirstItem: willOpen && event.detail === 0
            });
            return;
        }

        if (!event.target.closest(".artist-owner-menu")) {
            setArtistOwnerMenuOpen(false);
        }

        const artistLink = event.target.closest("[data-artist-slug]");
        if (artistLink) {
            event.preventDefault();
            event.stopPropagation();
            navigate({ name: "artist", artistSlug: artistLink.dataset.artistSlug });
            return;
        }
        const action = event.target.closest("[data-profile-action]")?.dataset.profileAction;
        if (action) {
            event.preventDefault();
            closeProfileMenu();
            if (action === "profile") void openCurrentProfile();
            if (action === "settings") void openSettings();
            return;
        }
        if (event.target.closest("[data-account-my-tracks]")) {
            navigate({ name: "myTracks" });
            return;
        }
        if (event.target.closest("[data-account-artist-page]") && linkedArtist) {
            navigate({ name: "artist", artistSlug: linkedArtist.slug });
            return;
        }
        if (event.target.closest("[data-change-account-avatar]")) {
            document.querySelector("[data-account-avatar-input]")?.click();
            return;
        }
        if (event.target.closest("[data-change-artist-avatar]")) {
            if (renderedArtistOwner) void recropArtistMedia("avatar");
            return;
        }
        if (event.target.closest("[data-change-artist-banner]")) {
            setArtistOwnerMenuOpen(false);
            if (renderedArtistOwner) void recropArtistMedia("banner");
            return;
        }
        if (event.target.closest("[data-open-artist-profile-editor]")) {
            setArtistOwnerMenuOpen(false);
            void openProfileEditor();
            return;
        }
        if (event.target.closest("[data-open-account-settings]")) {
            setArtistOwnerMenuOpen(false);
            void openSettings();
            return;
        }
        if (event.target.closest("[data-profile-quick-upload]")) {
            setArtistOwnerMenuOpen(false);
            announceExclusivePopupOpen(
                document.querySelector("#track-upload-modal")
            );
            document.querySelector(".profile-menu .track-upload-open-button")?.click();
            return;
        }
        if (event.target.closest("[data-close-profile-editor]")) {
            closeProfileEditor();
            return;
        }
        const homeAction = event.target.closest("[data-nav-home]");
        if (!homeAction) return;
        event.preventDefault();
        closeProfileMenu();
        clearActiveSearch();
        navigate({ name: "catalog" });
    });

    window.addEventListener(EXCLUSIVE_POPUP_OPEN_EVENT, (event) => {
        const wrapper = document.querySelector(".artist-owner-menu");
        const owner = event.detail?.owner;
        if (wrapper && (!owner || !wrapper.contains(owner))) {
            setArtistOwnerMenuOpen(false);
        }
    });

    window.addEventListener("scroll", () => {
        announceExclusivePopupOpen(null);
    }, { passive: true });

    document.addEventListener("keydown", (event) => {
        if (
            event.key === "Escape" &&
            document.querySelector(".artist-owner-menu.is-open")
        ) {
            event.preventDefault();
            setArtistOwnerMenuOpen(false, { restoreFocus: true });
        }
    });

    document.querySelector("[data-account-avatar-input]")?.addEventListener("change", (event) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = "";
        if (file) void handleAccountAvatar(file);
    });
    document.querySelector("[data-artist-avatar-input]")?.addEventListener("change", (event) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = "";
        if (file) void handleArtistMedia(file, "avatar");
    });
    document.querySelector("[data-artist-banner-input]")?.addEventListener("change", (event) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = "";
        if (file) void handleArtistMedia(file, "banner");
    });
    document.querySelector("[data-profile-editor-form]")?.addEventListener("submit", saveProfileEditor);
    initializeTrackManagement();

    window.addEventListener("popstate", () => void renderRoute());
    window.addEventListener("artistmediachange", () => void renderRoute());
    void getAuthModule().then((auth) => {
        unsubscribeAuthState ||= auth.subscribeToAuthState((state) => {
            document.body.dataset.currentProfileRole = state.profile?.role || "";
            void refreshLinkedArtist(state.profile?.id);
            if (["settings", "myTracks", "artist"].includes(getRoute().name)) {
                void renderRoute();
            }
        });
    });
    window.addEventListener("managedtrackchange", () => {
        if (getRoute().name === "artist") void renderRoute();
    });
    void renderRoute();
}
