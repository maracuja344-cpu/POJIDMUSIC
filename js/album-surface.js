import { supabase } from "./supabase/client.js";
import { getCatalogTracks } from "./catalog-state.js";
import { createTrackCard } from "./render.js";
import { setPlaybackContext } from "./playback-context.js";
import { syncRenderedTrackCardsWithPlayerState } from "./player.js";

const COVER_BUCKET = "track-covers";
const albumState = { albums: new Map(), tracksByAlbum: new Map(), ready: false };
let observer = null;
let decorating = false;

function coverUrl(path) {
    if (!path) return "img/cover.jpg";
    const { data } = supabase.storage.from(COVER_BUCKET).getPublicUrl(path);
    return data?.publicUrl || "img/cover.jpg";
}

function catalogTrackByDatabaseId(id) {
    return getCatalogTracks().find((track) => track.id === id) || null;
}

function getAlbumTracks(albumId) {
    return (albumState.tracksByAlbum.get(albumId) || [])
        .map((row) => ({ row, track: catalogTrackByDatabaseId(row.id) }))
        .filter((entry) => entry.track)
        .sort((a, b) => Number(a.row.album_position || 0) - Number(b.row.album_position || 0));
}

async function loadAlbums() {
    const [{ data: albums, error: albumError }, { data: rows, error: trackError }] = await Promise.all([
        supabase.from("albums").select("id,owner_id,title,description,cover_path,release_date,created_at").order("release_date", { ascending: false }),
        supabase.from("tracks").select("id,album_id,album_position,release_date,status").not("album_id", "is", null).eq("status", "published")
    ]);
    if (albumError || trackError) {
        console.warn("Album surface unavailable", albumError || trackError);
        return;
    }
    albumState.albums.clear();
    albumState.tracksByAlbum.clear();
    for (const album of albums || []) albumState.albums.set(album.id, album);
    for (const row of rows || []) {
        if (!albumState.tracksByAlbum.has(row.album_id)) albumState.tracksByAlbum.set(row.album_id, []);
        albumState.tracksByAlbum.get(row.album_id).push(row);
    }
    albumState.ready = true;
}

function albumArtist(albumId) {
    const first = getAlbumTracks(albumId)[0]?.track;
    return first?.artist || "";
}

function createAlbumCard(album, { compact = false } = {}) {
    const card = document.createElement("article");
    card.className = compact ? "album-card album-card-compact" : "album-card";
    card.dataset.albumId = album.id;
    card.tabIndex = 0;
    card.setAttribute("role", "link");
    card.setAttribute("aria-label", `Открыть альбом ${album.title}`);

    const artwork = document.createElement("div");
    artwork.className = "album-card-artwork";
    const image = document.createElement("img");
    image.src = coverUrl(album.cover_path);
    image.alt = `Обложка альбома ${album.title}`;
    image.loading = compact ? "eager" : "lazy";
    artwork.append(image);

    const info = document.createElement("div");
    info.className = "album-card-info";
    const title = document.createElement("div");
    title.className = "album-card-title";
    title.textContent = album.title;
    const meta = document.createElement("div");
    meta.className = "album-card-meta";
    const artist = document.createElement("span");
    artist.textContent = albumArtist(album.id);
    const badge = document.createElement("span");
    badge.className = "album-card-badge";
    badge.textContent = "ALBUM";
    meta.append(artist, badge);
    info.append(title, meta);
    card.append(artwork, info);
    return card;
}

function openAlbum(albumId, { replace = false } = {}) {
    if (!albumState.albums.has(albumId)) return;
    const url = new URL(location.href);
    url.searchParams.delete("artist");
    url.searchParams.delete("view");
    url.searchParams.set("album", albumId);
    history[replace ? "replaceState" : "pushState"]({}, "", `${url.pathname}${url.search}`);
    renderAlbumRoute(albumId);
}

function closeAlbum() {
    const url = new URL(location.href);
    url.searchParams.delete("album");
    history.pushState({}, "", `${url.pathname}${url.search}`);
    document.querySelector("#album-view")?.remove();
    document.body.classList.remove("album-view-open");
    document.querySelector("#catalog-view")?.removeAttribute("hidden");
    window.dispatchEvent(new PopStateEvent("popstate"));
}

function renderAlbumRoute(albumId) {
    const album = albumState.albums.get(albumId);
    if (!album) return;
    document.querySelector("#album-view")?.remove();
    ["#catalog-view", "#artist-profile", "#account-profile", "#my-tracks"].forEach((selector) => {
        const element = document.querySelector(selector);
        if (element) element.hidden = true;
    });
    document.body.classList.add("album-view-open");

    const entries = getAlbumTracks(albumId);
    const main = document.createElement("main");
    main.id = "album-view";
    main.className = "album-view";
    main.innerHTML = `
        <section class="album-hero">
            <button class="album-back" type="button" aria-label="Назад">‹</button>
            <img class="album-hero-cover" alt="">
            <div class="album-hero-copy">
                <span class="album-eyebrow">ALBUM</span>
                <h1></h1>
                <p class="album-artist"></p>
                <p class="album-count"></p>
            </div>
            <button class="album-play-all" type="button">▶ Воспроизвести</button>
        </section>
        <section class="album-tracks">
            <h2>ТРЕКИ</h2>
            <div class="album-track-list"></div>
        </section>`;
    main.querySelector(".album-hero-cover").src = coverUrl(album.cover_path);
    main.querySelector(".album-hero-cover").alt = `Обложка альбома ${album.title}`;
    main.querySelector("h1").textContent = album.title;
    main.querySelector(".album-artist").textContent = albumArtist(albumId);
    main.querySelector(".album-count").textContent = `${entries.length} ${entries.length === 1 ? "трек" : entries.length < 5 ? "трека" : "треков"}`;

    const list = main.querySelector(".album-track-list");
    entries.forEach(({ row, track }, index) => {
        const card = createTrackCard(track, { loading: index < 4 ? "eager" : "lazy" });
        card.classList.add("album-track-card");
        card.dataset.albumPosition = row.album_position;
        const number = document.createElement("span");
        number.className = "album-track-number";
        number.textContent = String(row.album_position).padStart(2, "0");
        card.prepend(number);
        list.append(card);
    });
    syncRenderedTrackCardsWithPlayerState(list);
    document.querySelector(".mini-player")?.before(main);

    const setAlbumContext = (catalogId) => queueMicrotask(() => {
        const queueIds = entries.map((entry) => entry.track.catalogId);
        setPlaybackContext({
            type: "album",
            id: `album:${albumId}`,
            label: album.title,
            queueIds,
            currentIndex: Math.max(0, queueIds.indexOf(catalogId))
        });
    });
    list.addEventListener("click", (event) => {
        const card = event.target.closest(".release-card");
        if (card) setAlbumContext(card.dataset.trackId);
    });
    main.querySelector(".album-play-all").addEventListener("click", () => {
        const first = list.querySelector(".release-card");
        if (!first) return;
        setAlbumContext(first.dataset.trackId);
        first.click();
    });
    main.querySelector(".album-back").addEventListener("click", closeAlbum);
    document.title = `${album.title} — POJIDMUSIC`;
    window.scrollTo({ top: 0, behavior: "auto" });
}

function decorateArtistPage() {
    const artistView = document.querySelector("#artist-profile");
    const trackContainer = artistView?.querySelector("[data-artist-tracks]");
    if (!artistView || !trackContainer || artistView.hidden) return;
    const visibleIds = new Set(Array.from(trackContainer.querySelectorAll("[data-track-id]")).map((card) => card.dataset.trackId));
    const albums = [];
    for (const album of albumState.albums.values()) {
        if (getAlbumTracks(album.id).some(({ track }) => visibleIds.has(track.catalogId))) albums.push(album);
    }
    let section = artistView.querySelector(".artist-albums");
    if (!albums.length) { section?.remove(); return; }
    if (!section) {
        section = document.createElement("section");
        section.className = "artist-albums";
        section.innerHTML = '<h2 class="section-title">АЛЬБОМЫ</h2><div class="artist-album-grid"></div>';
        artistView.querySelector(".artist-releases")?.before(section);
    }
    const grid = section.querySelector(".artist-album-grid");
    grid.replaceChildren(...albums.map((album) => createAlbumCard(album)));
    const releasesTitle = artistView.querySelector(".artist-releases > .section-title");
    if (releasesTitle) releasesTitle.textContent = "ВСЕ ТРЕКИ";
}

function replaceHomeAlbumTracks(container) {
    if (!container || container.closest("#artist-profile") || container.closest("#album-view")) return;
    const seen = new Set();
    for (const card of Array.from(container.querySelectorAll("[data-track-id]"))) {
        const catalogTrack = getCatalogTracks().find((track) => track.catalogId === card.dataset.trackId);
        if (!catalogTrack) continue;
        let albumId = null;
        for (const [candidateId, rows] of albumState.tracksByAlbum) {
            if (rows.some((row) => row.id === catalogTrack.id)) { albumId = candidateId; break; }
        }
        if (!albumId) continue;
        if (seen.has(albumId)) { card.remove(); continue; }
        seen.add(albumId);
        const album = albumState.albums.get(albumId);
        if (album) card.replaceWith(createAlbumCard(album, { compact: container.closest("#recommendations") != null }));
    }
}

function decorateHome() {
    replaceHomeAlbumTracks(document.querySelector("#new .tracks-row"));
    replaceHomeAlbumTracks(document.querySelector("#all-tracks .tracks-row"));
    replaceHomeAlbumTracks(document.querySelector("#recommendations .recommendations-track"));
}

function decorate() {
    if (!albumState.ready || decorating) return;
    decorating = true;
    try {
        decorateArtistPage();
        decorateHome();
    } finally { decorating = false; }
}

function handleAlbumActivation(event) {
    const card = event.target.closest("[data-album-id]");
    if (!card) return;
    event.preventDefault();
    event.stopPropagation();
    openAlbum(card.dataset.albumId);
}

async function initialize() {
    await loadAlbums();
    decorate();
    document.addEventListener("click", handleAlbumActivation, true);
    document.addEventListener("keydown", (event) => {
        if ((event.key === "Enter" || event.key === " ") && event.target.matches("[data-album-id]")) {
            event.preventDefault();
            openAlbum(event.target.dataset.albumId);
        }
    });
    observer = new MutationObserver(() => requestAnimationFrame(decorate));
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("popstate", () => {
        const albumId = new URL(location.href).searchParams.get("album");
        if (albumId) setTimeout(() => renderAlbumRoute(albumId), 0);
        else {
            document.querySelector("#album-view")?.remove();
            document.body.classList.remove("album-view-open");
        }
    });
    const albumId = new URL(location.href).searchParams.get("album");
    if (albumId) renderAlbumRoute(albumId);
}

void initialize();
