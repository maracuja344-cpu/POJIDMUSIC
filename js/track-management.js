import { supabase } from "./supabase/client.js";
import {
    announceExclusivePopupOpen,
    EXCLUSIVE_POPUP_OPEN_EVENT,
    getTrackArtists
} from "./artist-utils.js";
import { openImageCropper } from "./image-cropper.js";
import { invalidateSignedAudioPath } from "./audio-url-resolver.js";
import { getOwnedArtistTracks } from "./tracks-api.js";
import { createTrackCard, observeRevealElement } from "./render.js";
import { syncRenderedTrackCardsWithPlayerState } from "./player.js";

const COVER_BUCKET = "track-covers";
const AUDIO_BUCKET = "track-audio";
const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
const AUDIO_TYPES = new Map([
    ["audio/mpeg", "mp3"],
    ["audio/wav", "wav"],
    ["audio/x-wav", "wav"],
    ["audio/flac", "flac"],
    ["audio/x-flac", "flac"]
]);
let editDraft = null;
let editorReturnFocus = null;
let suggestionRows = [];
let myTracksRenderToken = 0;
let myTracksFilter = "published";
let viewObserver = null;

const modal = () => document.querySelector("[data-track-editor-modal]");
const form = () => document.querySelector("[data-track-editor-form]");

function normalize(value) {
    return String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function setStatus(text, error = false) {
    const element = document.querySelector("[data-track-editor-status]");
    if (!element) return;
    element.textContent = text;
    element.dataset.type = error ? "error" : "";
}

function createCreditRow(credit = {}) {
    const row = document.createElement("div");
    row.className = "edit-credit-row";
    const input = document.createElement("input");
    input.required = true;
    input.maxLength = 200;
    input.placeholder = "Имя артиста";
    input.value = credit.displayName || "";
    input.dataset.artistId = credit.id || "";
    input.autocomplete = "off";
    input.addEventListener("input", () => {
        input.dataset.artistId = "";
        void updateSuggestions(input.value);
    });
    input.addEventListener("change", () => {
        const match = suggestionRows.find((item) => normalize(item.display_name) === normalize(input.value));
        if (match) {
            input.value = match.display_name;
            input.dataset.artistId = match.id;
        }
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", "Удалить артиста из credits");
    remove.addEventListener("click", () => row.remove());
    row.append(input, remove);
    return row;
}

async function updateSuggestions(value) {
    if (normalize(value).length < 2) return;
    const { data } = await supabase.rpc("search_artists_for_credit", {
        search_term: value,
        result_limit: 8
    });
    suggestionRows = data || [];
}

function addCredit(role, credit) {
    document.querySelector(`[data-edit-${role}-artists]`)?.append(createCreditRow(credit));
}

function getCredits(role) {
    return [...document.querySelectorAll(`[data-edit-${role}-artists] input`)].map((input) => ({
        id: input.dataset.artistId || null,
        name: input.value.trim()
    })).filter((credit) => credit.name);
}

function revokePendingCoverPreview(draft = editDraft) {
    if (draft?.pendingCover?.previewUrl) URL.revokeObjectURL(draft.pendingCover.previewUrl);
}

function renderCoverDraft() {
    const preview = document.querySelector("[data-edit-cover-preview]");
    const status = document.querySelector("[data-edit-cover-status]");
    if (!preview || !status || !editDraft) return;
    const pending = editDraft.pendingCover;
    preview.src = pending?.previewUrl || editDraft.currentCover.url;
    preview.hidden = !preview.src;
    status.textContent = pending
        ? "Новая обложка подготовлена. Сохраните изменения трека."
        : "Текущая опубликованная обложка";
}

function ensureAudioEditor() {
    const editor = form();
    if (!editor || editor.querySelector("[data-edit-audio-input]")) return;
    const coverEditor = editor.querySelector(".track-cover-editor");
    if (!coverEditor) return;
    const block = document.createElement("div");
    block.className = "track-audio-editor";
    block.innerHTML = `
        <div class="track-audio-editor-copy">
            <strong>Аудиофайл</strong>
            <span data-edit-audio-status>Текущий файл останется без изменений</span>
        </div>
        <input data-edit-audio-input type="file" accept=".mp3,.wav,.flac,audio/mpeg,audio/wav,audio/x-wav,audio/flac,audio/x-flac" hidden>
        <button type="button" data-edit-audio>Заменить аудиофайл</button>`;
    coverEditor.after(block);
    block.querySelector("[data-edit-audio]").addEventListener("click", () => block.querySelector("[data-edit-audio-input]").click());
    block.querySelector("[data-edit-audio-input]").addEventListener("change", (event) => {
        const file = event.target.files?.[0] || null;
        if (!editDraft) return;
        editDraft.pendingAudio = file;
        const status = block.querySelector("[data-edit-audio-status]");
        status.textContent = file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} МБ` : "Текущий файл останется без изменений";
        setStatus("");
    });
}

function resetAudioEditor() {
    ensureAudioEditor();
    const input = document.querySelector("[data-edit-audio-input]");
    const status = document.querySelector("[data-edit-audio-status]");
    if (input) input.value = "";
    if (status) status.textContent = "Текущий файл останется без изменений";
}

function syncDraftFromForm() {
    if (!editDraft) return;
    editDraft.title = form().elements.title.value;
    editDraft.primaryArtists = getCredits("primary");
    editDraft.featuredArtists = getCredits("featured");
}

function closeEditor({ restoreFocus = true } = {}) {
    const element = modal();
    if (element) element.hidden = true;
    document.body.classList.remove("track-editor-open");
    revokePendingCoverPreview();
    editDraft = null;
    resetAudioEditor();
    if (restoreFocus) editorReturnFocus?.focus?.();
    editorReturnFocus = null;
}

function openEditor(track, returnFocus) {
    announceExclusivePopupOpen(modal());
    revokePendingCoverPreview();
    ensureAudioEditor();
    const credits = getTrackArtists(track);
    editDraft = {
        track,
        title: track.title,
        primaryArtists: credits.filter((credit) => credit.role !== "featured"),
        featuredArtists: credits.filter((credit) => credit.role === "featured"),
        currentCover: { url: track.cover || "", path: track.storageCoverPath || "" },
        pendingCover: null,
        pendingAudio: null
    };
    editorReturnFocus = returnFocus || document.activeElement;
    const element = modal();
    const editor = form();
    editor.elements.title.value = editDraft.title;
    const primary = document.querySelector("[data-edit-primary-artists]");
    const featured = document.querySelector("[data-edit-featured-artists]");
    primary.replaceChildren();
    featured.replaceChildren();
    editDraft.primaryArtists.forEach((credit) => addCredit("primary", credit));
    editDraft.featuredArtists.forEach((credit) => addCredit("featured", credit));
    if (!primary.children.length) addCredit("primary");
    renderCoverDraft();
    resetAudioEditor();
    setStatus("");
    element.hidden = false;
    document.body.classList.add("track-editor-open");
    editor.elements.title.focus();
}

async function chooseCover() {
    if (!editDraft) return;
    syncDraftFromForm();
    const trigger = document.querySelector("[data-edit-cover]");
    const parentModal = modal();
    const source = editDraft.pendingCover?.blob || editDraft.currentCover.url;
    if (!source) {
        setStatus("Текущая обложка недоступна для редактирования.", true);
        return;
    }
    parentModal.hidden = true;
    try {
        const result = await openImageCropper({ source, mode: "cover", upload: true, allowReplace: true, maxReplacementBytes: 5 * 1024 * 1024 });
        const previewUrl = URL.createObjectURL(result.blob);
        revokePendingCoverPreview();
        editDraft.pendingCover = { blob: result.blob, crop: result.crop, sourceFile: result.replacementFile || null, previewUrl };
        renderCoverDraft();
        setStatus("");
    } catch (error) {
        if (error?.name !== "AbortError") setStatus(error?.message || "Не удалось подготовить обложку.", true);
    } finally {
        parentModal.hidden = false;
        trigger?.focus();
    }
}

function getAudioExtension(file) {
    const mimeExtension = AUDIO_TYPES.get(file?.type);
    if (mimeExtension) return mimeExtension;
    const extension = String(file?.name || "").split(".").pop()?.toLowerCase();
    return ["mp3", "wav", "flac"].includes(extension) ? extension : null;
}

async function uploadReplacementAudio(draft) {
    const file = draft.pendingAudio;
    if (!file) return { newPath: null, oldPath: null };
    if (file.size <= 0 || file.size > MAX_AUDIO_BYTES) throw new Error("Аудиофайл должен быть не больше 50 МБ.");
    const extension = getAudioExtension(file);
    if (!extension) throw new Error("Поддерживаются MP3, WAV и FLAC.");
    const newPath = `${draft.track.ownerId}/${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await supabase.storage.from(AUDIO_BUCKET).upload(newPath, file, {
        cacheControl: "3600",
        contentType: file.type || (extension === "mp3" ? "audio/mpeg" : extension === "wav" ? "audio/wav" : "audio/flac"),
        upsert: false
    });
    if (uploadError) throw uploadError;
    const { data: oldPath, error: rpcError } = await supabase.rpc("replace_managed_track_audio", {
        target_track_id: draft.track.id,
        new_audio_path: newPath
    });
    if (rpcError) {
        await supabase.storage.from(AUDIO_BUCKET).remove([newPath]);
        throw rpcError;
    }
    invalidateSignedAudioPath(draft.track.storageAudioPath);
    invalidateSignedAudioPath(newPath);
    return { newPath, oldPath };
}

async function refreshAfterMutation() {
    const { refreshCatalog } = await import("./script.js");
    await refreshCatalog({ force: true, source: "profile-management" });
    window.dispatchEvent(new CustomEvent("managedtrackchange"));
    if (document.body.dataset.appView === "myTracks") void renderManagedMyTracks();
}

async function saveEditor(event) {
    event.preventDefault();
    if (!editDraft) return;
    syncDraftFromForm();
    const draft = editDraft;
    const primary = draft.primaryArtists;
    const featured = draft.featuredArtists;
    if (!primary.length) { setStatus("Добавьте хотя бы одного основного артиста.", true); return; }
    const submit = form().querySelector("[type='submit']");
    let newCoverPath = null;
    let oldCoverPath = null;
    let coverUploaded = false;
    let metadataUpdated = false;
    let audioResult = null;
    try {
        submit.disabled = true;
        setStatus(draft.pendingAudio ? "Загружаем новую версию аудио…" : "Сохраняем изменения…");
        if (draft.pendingCover?.blob) {
            newCoverPath = `${draft.track.ownerId}/${crypto.randomUUID()}.webp`;
            const { error } = await supabase.storage.from(COVER_BUCKET).upload(newCoverPath, draft.pendingCover.blob, { cacheControl: "31536000", contentType: "image/webp", upsert: false });
            if (error) throw error;
            coverUploaded = true;
        }
        const result = await supabase.rpc("update_managed_track", {
            target_track_id: draft.track.id,
            new_title: draft.title,
            new_cover_path: newCoverPath,
            primary_artist_ids: primary.map((credit) => credit.id),
            primary_artist_names: primary.map((credit) => credit.name),
            featured_artist_ids: featured.map((credit) => credit.id),
            featured_artist_names: featured.map((credit) => credit.name)
        });
        if (result.error) throw result.error;
        oldCoverPath = result.data;
        metadataUpdated = true;
        if (draft.pendingAudio) audioResult = await uploadReplacementAudio(draft);
    } catch (error) {
        if (newCoverPath && coverUploaded && !metadataUpdated) {
            const { error: cleanupError } = await supabase.storage.from(COVER_BUCKET).remove([newCoverPath]);
            if (cleanupError) console.warn("Не удалось удалить временный cover object.", cleanupError);
        }
        setStatus(error?.message || "Не удалось сохранить трек.", true);
        submit.disabled = false;
        return;
    }
    if (newCoverPath && oldCoverPath && oldCoverPath !== newCoverPath) {
        const { error: cleanupError } = await supabase.storage.from(COVER_BUCKET).remove([oldCoverPath]);
        if (cleanupError) console.warn("Трек обновлён, но старую обложку пока не удалось удалить.", cleanupError);
    }
    if (audioResult?.oldPath && audioResult.oldPath !== audioResult.newPath) {
        const { error: cleanupError } = await supabase.storage.from(AUDIO_BUCKET).remove([audioResult.oldPath]);
        if (cleanupError) console.warn("Аудио обновлено, но старый файл пока не удалось удалить.", cleanupError);
    }
    submit.disabled = false;
    closeEditor();
    await refreshAfterMutation();
}

async function toggleVisibility(track) {
    const hide = track.status === "published";
    const { error } = await supabase.rpc("set_managed_track_visibility", { target_track_id: track.id, make_hidden: hide });
    if (error) throw error;
    await refreshAfterMutation();
}

async function deleteTrack(track) {
    if (!window.confirm(`Удалить трек «${track.title}»? Это действие нельзя отменить.`)) return;
    const { data, error } = await supabase.rpc("delete_managed_track", { target_track_id: track.id });
    if (error) throw error;
    const coverPath = data?.cover_path;
    const audioPath = data?.audio_path;
    invalidateSignedAudioPath(audioPath);
    if (coverPath) await supabase.storage.from(COVER_BUCKET).remove([coverPath]);
    if (audioPath) await supabase.storage.from(AUDIO_BUCKET).remove([audioPath]);
    await refreshAfterMutation();
}

export function decorateManagedTrackCard(card, track) {
    if (!card || card.querySelector(".track-manage-button")) return;
    card.classList.add("owner-track-card");
    if (track.status !== "published") {
        const badge = document.createElement("span");
        badge.className = "track-status-badge";
        badge.textContent = track.status === "hidden" ? "Скрыт" : track.status === "pending" ? "На проверке" : track.status;
        card.append(badge);
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "track-manage-button";
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", "false");
    button.textContent = "⋯";
    button.setAttribute("aria-label", `Управление треком ${track.title}`);
    const menu = document.createElement("div");
    menu.className = "track-manage-menu";
    menu.hidden = true;
    const actions = [
        ["Редактировать", () => openEditor(track, button)],
        ...(track.status === "published" || track.status === "hidden" ? [[track.status === "hidden" ? "Опубликовать" : "Скрыть", () => toggleVisibility(track)]] : []),
        ["Удалить", () => deleteTrack(track)]
    ];
    actions.forEach(([label, action]) => {
        const item = document.createElement("button");
        item.type = "button";
        item.textContent = label;
        item.addEventListener("click", async (event) => {
            event.stopPropagation();
            menu.hidden = true;
            button.setAttribute("aria-expanded", "false");
            try { await action(); } catch (error) { window.alert(error?.message || "Операция не выполнена."); }
        });
        menu.append(item);
    });
    button.addEventListener("click", (event) => {
        event.stopPropagation();
        const willOpen = menu.hidden;
        if (willOpen) announceExclusivePopupOpen(menu);
        menu.hidden = !willOpen;
        button.setAttribute("aria-expanded", String(willOpen));
    });
    card.append(button, menu);
}

function stripArtistTrackManagement() {
    const artistView = document.querySelector("#artist-profile");
    if (!artistView) return;
    artistView.querySelector(".artist-profile-filters")?.remove();
    artistView.querySelectorAll(".track-manage-button, .track-manage-menu, .track-status-badge").forEach((element) => element.remove());
    artistView.querySelectorAll(".owner-track-card").forEach((card) => card.classList.remove("owner-track-card"));
}

function ensureMyTracksFilters(view) {
    let filters = view.querySelector(".my-tracks-filters");
    if (filters) return filters;
    filters = document.createElement("div");
    filters.className = "artist-profile-filters my-tracks-filters";
    [["published", "Опубликованные"], ["hidden", "Скрытые"], ["pending", "На проверке"]].forEach(([value, label]) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "artist-profile-filter";
        button.dataset.myTracksFilter = value;
        button.textContent = label;
        button.addEventListener("click", () => {
            myTracksFilter = value;
            void renderManagedMyTracks();
        });
        filters.append(button);
    });
    view.querySelector("[data-my-tracks-description]")?.after(filters);
    return filters;
}

async function renderManagedMyTracks() {
    if (document.body.dataset.appView !== "myTracks") return;
    const view = document.querySelector("#my-tracks");
    const container = view?.querySelector("[data-my-tracks-list]");
    if (!view || !container) return;
    const token = ++myTracksRenderToken;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || token !== myTracksRenderToken || document.body.dataset.appView !== "myTracks") return;
    const { data: artist, error: artistError } = await supabase
        .from("artists")
        .select("id,display_name")
        .eq("linked_profile_id", user.id)
        .maybeSingle();
    if (artistError || !artist) return;
    let tracks;
    try {
        tracks = await getOwnedArtistTracks(artist.id);
    } catch (error) {
        console.warn("Не удалось загрузить управляемые треки.", error);
        return;
    }
    if (token !== myTracksRenderToken || document.body.dataset.appView !== "myTracks") return;
    const filters = ensureMyTracksFilters(view);
    filters.querySelectorAll("button").forEach((button) => button.classList.toggle("is-active", button.dataset.myTracksFilter === myTracksFilter));
    const effectiveStatus = (track) => track.status || "published";
    const visible = tracks.filter((track) => effectiveStatus(track) === myTracksFilter);
    container.replaceChildren();
    visible.forEach((track, index) => {
        const card = createTrackCard(track, { loading: index < 4 ? "eager" : "lazy" });
        decorateManagedTrackCard(card, track);
        container.append(card);
        observeRevealElement(card);
    });
    syncRenderedTrackCardsWithPlayerState(container);
    view.querySelector("[data-my-tracks-description]").textContent = `Релизы и управление · ${artist.display_name}`;
    const empty = view.querySelector("[data-my-tracks-empty]");
    if (empty) {
        empty.hidden = visible.length > 0;
        empty.textContent = myTracksFilter === "published" ? "Нет опубликованных треков." : myTracksFilter === "hidden" ? "Нет скрытых треков." : "Нет треков на проверке.";
    }
}

function syncManagementSurface() {
    if (document.body.dataset.appView === "artist") stripArtistTrackManagement();
    if (document.body.dataset.appView === "myTracks") void renderManagedMyTracks();
}

export function initializeTrackManagement() {
    ensureAudioEditor();
    window.addEventListener(EXCLUSIVE_POPUP_OPEN_EVENT, (event) => {
        const owner = event.detail?.owner;
        document.querySelectorAll(".track-manage-menu:not([hidden])").forEach((menu) => {
            if (!owner || (menu !== owner && !menu.contains(owner))) menu.hidden = true;
            if (menu.hidden) menu.previousElementSibling?.setAttribute("aria-expanded", "false");
        });
    });
    document.addEventListener("pointerdown", (event) => {
        document.querySelectorAll(".track-manage-menu:not([hidden])").forEach((menu) => {
            const toggle = menu.previousElementSibling;
            if (menu.contains(event.target) || toggle === event.target.closest?.(".track-manage-button")) return;
            menu.hidden = true;
            toggle?.setAttribute("aria-expanded", "false");
        });
    });
    window.addEventListener("scroll", () => announceExclusivePopupOpen(null), { passive: true });
    document.querySelectorAll("[data-close-track-editor]").forEach((button) => button.addEventListener("click", () => closeEditor()));
    document.querySelector("[data-edit-cover]")?.addEventListener("click", () => void chooseCover());
    document.querySelector("[data-add-edit-primary]")?.addEventListener("click", () => addCredit("primary"));
    document.querySelector("[data-add-edit-featured]")?.addEventListener("click", () => addCredit("featured"));
    form()?.addEventListener("submit", saveEditor);
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && modal() && !modal().hidden) closeEditor();
        if (event.key === "Escape") announceExclusivePopupOpen(null);
    });
    viewObserver?.disconnect();
    viewObserver = new MutationObserver(() => requestAnimationFrame(syncManagementSurface));
    viewObserver.observe(document.body, { attributes: true, attributeFilter: ["data-app-view"] });
    window.addEventListener("managedtrackchange", () => void renderManagedMyTracks());
    requestAnimationFrame(syncManagementSurface);
}
