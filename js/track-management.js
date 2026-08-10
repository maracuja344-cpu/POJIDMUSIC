import { supabase } from "./supabase/client.js";
import {
    announceExclusivePopupOpen,
    EXCLUSIVE_POPUP_OPEN_EVENT,
    getTrackArtists
} from "./artist-utils.js";
import { openImageCropper } from "./image-cropper.js";
import { invalidateSignedAudioPath } from "./audio-url-resolver.js";

const COVER_BUCKET = "track-covers";
const AUDIO_BUCKET = "track-audio";
let editDraft = null;
let editorReturnFocus = null;
let suggestionRows = [];

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
    if (draft?.pendingCover?.previewUrl) {
        URL.revokeObjectURL(draft.pendingCover.previewUrl);
    }
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
    if (restoreFocus) editorReturnFocus?.focus?.();
    editorReturnFocus = null;
}

function openEditor(track, returnFocus) {
    announceExclusivePopupOpen(modal());
    revokePendingCoverPreview();
    const credits = getTrackArtists(track);
    editDraft = {
        track,
        title: track.title,
        primaryArtists: credits.filter((credit) => credit.role !== "featured"),
        featuredArtists: credits.filter((credit) => credit.role === "featured"),
        currentCover: {
            url: track.cover || "",
            path: track.storageCoverPath || ""
        },
        pendingCover: null
    };
    editorReturnFocus = returnFocus || document.activeElement;
    const element = modal();
    const editor = form();
    editor.elements.title.value = editDraft.title;
    const primary = document.querySelector("[data-edit-primary-artists]");
    const featured = document.querySelector("[data-edit-featured-artists]");
    primary.replaceChildren(); featured.replaceChildren();
    editDraft.primaryArtists.forEach((credit) => addCredit("primary", credit));
    editDraft.featuredArtists.forEach((credit) => addCredit("featured", credit));
    if (!primary.children.length) addCredit("primary");
    renderCoverDraft();
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
        const result = await openImageCropper({
            source,
            mode: "cover",
            upload: true,
            allowReplace: true,
            maxReplacementBytes: 5 * 1024 * 1024
        });
        const previewUrl = URL.createObjectURL(result.blob);
        revokePendingCoverPreview();
        editDraft.pendingCover = {
            blob: result.blob,
            crop: result.crop,
            sourceFile: result.replacementFile || null,
            previewUrl
        };
        renderCoverDraft();
        setStatus("");
    } catch (error) {
        if (error?.name !== "AbortError") {
            setStatus(error?.message || "Не удалось подготовить обложку.", true);
        }
    } finally {
        parentModal.hidden = false;
        trigger?.focus();
    }
}

async function refreshAfterMutation() {
    const { refreshCatalog } = await import("./script.js");
    await refreshCatalog({ force: true, source: "profile-management" });
    window.dispatchEvent(new CustomEvent("managedtrackchange"));
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
    let newPath = null;
    let oldPath = null;
    let uploadCompleted = false;
    let databaseUpdated = false;
    try {
        submit.disabled = true;
        setStatus("Сохраняем изменения…");
        if (draft.pendingCover?.blob) {
            newPath = `${draft.track.ownerId}/${crypto.randomUUID()}.webp`;
            const { error } = await supabase.storage.from(COVER_BUCKET).upload(newPath, draft.pendingCover.blob, {
                cacheControl: "31536000", contentType: "image/webp", upsert: false
            });
            if (error) throw error;
            uploadCompleted = true;
        }
        const result = await supabase.rpc("update_managed_track", {
            target_track_id: draft.track.id,
            new_title: draft.title,
            new_cover_path: newPath,
            primary_artist_ids: primary.map((credit) => credit.id),
            primary_artist_names: primary.map((credit) => credit.name),
            featured_artist_ids: featured.map((credit) => credit.id),
            featured_artist_names: featured.map((credit) => credit.name)
        });
        if (result.error) throw result.error;
        oldPath = result.data;
        databaseUpdated = true;
    } catch (error) {
        if (newPath && uploadCompleted && !databaseUpdated) {
            const { error: cleanupError } = await supabase.storage
                .from(COVER_BUCKET)
                .remove([newPath]);
            if (cleanupError) {
                console.warn("Не удалось удалить временный cover object.", cleanupError);
            }
        }
        setStatus(error?.message || "Не удалось сохранить трек.", true);
        submit.disabled = false;
        return;
    }

    if (newPath && oldPath && oldPath !== newPath) {
        const { error: cleanupError } = await supabase.storage
            .from(COVER_BUCKET)
            .remove([oldPath]);
        if (cleanupError) {
            console.warn("Трек обновлён, но старую обложку пока не удалось удалить.", cleanupError);
        }
    }

    submit.disabled = false;
    closeEditor();
    await refreshAfterMutation();
}

async function toggleVisibility(track) {
    const hide = track.status === "published";
    const { error } = await supabase.rpc("set_managed_track_visibility", {
        target_track_id: track.id,
        make_hidden: hide
    });
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
    card.classList.add("owner-track-card");
    if (track.status !== "published") {
        const badge = document.createElement("span");
        badge.className = "track-status-badge";
        badge.textContent = track.status === "hidden" ? "Скрыт" : track.status;
        card.append(badge);
    }
    const button = document.createElement("button");
    button.type = "button"; button.className = "track-manage-button";
    button.textContent = "⋯"; button.setAttribute("aria-label", `Управление треком ${track.title}`);
    const menu = document.createElement("div");
    menu.className = "track-manage-menu"; menu.hidden = true;
    const actions = [
        ["Редактировать", () => openEditor(track, button)],
        [track.status === "hidden" ? "Восстановить" : "Скрыть", () => toggleVisibility(track)],
        ["Удалить", () => deleteTrack(track)]
    ];
    actions.forEach(([label, action]) => {
        const item = document.createElement("button"); item.type = "button"; item.textContent = label;
        item.addEventListener("click", async (event) => {
            event.stopPropagation(); menu.hidden = true;
            try { await action(); } catch (error) { window.alert(error?.message || "Операция не выполнена."); }
        });
        menu.append(item);
    });
    button.addEventListener("click", (event) => {
        event.stopPropagation();
        const willOpen = menu.hidden;
        if (willOpen) announceExclusivePopupOpen(menu);
        menu.hidden = !willOpen;
    });
    card.append(button, menu);
}

export function initializeTrackManagement() {
    window.addEventListener(EXCLUSIVE_POPUP_OPEN_EVENT, (event) => {
        const owner = event.detail?.owner;
        document.querySelectorAll(".track-manage-menu:not([hidden])")
            .forEach((menu) => {
                if (menu !== owner && !menu.contains(owner)) menu.hidden = true;
            });
    });
    document.querySelectorAll("[data-close-track-editor]")
        .forEach((button) => button.addEventListener("click", () => closeEditor()));
    document.querySelector("[data-edit-cover]")?.addEventListener("click", () => void chooseCover());
    document.querySelector("[data-add-edit-primary]")?.addEventListener("click", () => addCredit("primary"));
    document.querySelector("[data-add-edit-featured]")?.addEventListener("click", () => addCredit("featured"));
    form()?.addEventListener("submit", saveEditor);
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && modal() && !modal().hidden) closeEditor();
    });
}
