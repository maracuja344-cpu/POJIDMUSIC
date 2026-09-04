import { supabase } from "./supabase/client.js";

const AUDIO_BUCKET = "track-audio";
const COVER_BUCKET = "track-covers";
const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
const MAX_COVER_BYTES = 5 * 1024 * 1024;
const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "flac"]);
const COVER_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);

let albumUploadPending = false;
let albumCoverPreviewUrl = null;

function extensionOf(file) {
    return String(file?.name || "").split(".").pop()?.toLowerCase() || "";
}

function contentTypeForAudio(extension, reported) {
    if (reported) return reported;
    if (extension === "mp3") return "audio/mpeg";
    if (extension === "wav") return "audio/wav";
    return "audio/flac";
}

function formatSize(bytes) {
    return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

function createPath(userId, extension) {
    return `${userId}/${crypto.randomUUID()}.${extension}`;
}

function getTelegramTopInset() {
    const webApp = window.Telegram?.WebApp;
    const candidates = [
        Number(webApp?.contentSafeAreaInset?.top),
        Number(webApp?.safeAreaInset?.top)
    ].filter((value) => Number.isFinite(value) && value >= 0);
    return candidates.length ? Math.max(...candidates) : 0;
}

function applyTelegramInset(modal) {
    const inset = getTelegramTopInset();
    const inTelegram = document.documentElement.dataset.telegramMiniApp === "true" || Boolean(window.Telegram?.WebApp);
    modal.style.setProperty("--album-tg-top", `${inTelegram ? Math.max(inset, 64) : inset}px`);
}

function createTrackRow(index) {
    const row = document.createElement("div");
    row.className = "album-upload-track-row";
    row.innerHTML = `
        <div class="album-upload-track-number">${index}</div>
        <div class="album-upload-track-fields">
            <input type="text" maxlength="200" placeholder="Название трека" data-album-track-title required>
            <label class="album-upload-file-button">
                <input type="file" accept=".mp3,.wav,.flac,audio/mpeg,audio/wav,audio/x-wav,audio/flac,audio/x-flac" data-album-track-audio hidden required>
                <span data-album-track-file>Выбрать аудио</span>
            </label>
        </div>
        <button type="button" class="album-upload-track-remove" data-remove-album-track aria-label="Удалить трек">×</button>
    `;
    row.querySelector("[data-album-track-audio]").addEventListener("change", (event) => {
        const file = event.target.files?.[0];
        row.querySelector("[data-album-track-file]").textContent = file ? `${file.name} · ${formatSize(file.size)}` : "Выбрать аудио";
    });
    row.querySelector("[data-remove-album-track]").addEventListener("click", () => {
        const list = row.parentElement;
        if (!list || list.children.length <= 2) return;
        row.remove();
        renumberTracks(list);
    });
    return row;
}

function renumberTracks(list) {
    [...list.children].forEach((row, index) => {
        row.querySelector(".album-upload-track-number").textContent = String(index + 1);
        row.querySelector("[data-remove-album-track]").disabled = list.children.length <= 2;
    });
}

function ensureModal() {
    let modal = document.querySelector("[data-album-upload-modal]");
    if (modal) return modal;

    modal = document.createElement("div");
    modal.className = "album-upload-modal";
    modal.dataset.albumUploadModal = "";
    modal.hidden = true;
    modal.innerHTML = `
        <div class="album-upload-dialog" role="dialog" aria-modal="true" aria-labelledby="album-upload-title">
            <div class="album-upload-heading">
                <div>
                    <p>Новый релиз</p>
                    <h2 id="album-upload-title">Загрузить альбом</h2>
                </div>
                <button type="button" data-close-album-upload aria-label="Закрыть">×</button>
            </div>
            <form class="album-upload-form" data-album-upload-form>
                <label class="album-upload-field">Название альбома
                    <input name="title" maxlength="200" required placeholder="Название альбома">
                </label>
                <label class="album-upload-field">Описание <span>необязательно</span>
                    <textarea name="description" maxlength="2000" rows="3"></textarea>
                </label>
                <div class="album-upload-cover-field">
                    <div class="album-upload-cover-preview" data-album-cover-preview>♪</div>
                    <label class="album-upload-cover-button">
                        <input name="cover" type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" hidden required>
                        Выбрать обложку
                    </label>
                </div>
                <div class="album-upload-track-heading">
                    <div><strong>Треклист</strong><span>минимум 2 трека</span></div>
                    <button type="button" data-add-album-track>+ трек</button>
                </div>
                <div class="album-upload-track-list" data-album-track-list></div>
                <p class="album-upload-status" data-album-upload-status role="status" aria-live="polite"></p>
                <div class="album-upload-actions">
                    <button type="button" data-close-album-upload>Отмена</button>
                    <button type="submit" class="album-upload-submit">Загрузить альбом</button>
                </div>
            </form>
        </div>
    `;
    document.body.append(modal);

    const list = modal.querySelector("[data-album-track-list]");
    list.append(createTrackRow(1), createTrackRow(2));
    renumberTracks(list);

    modal.querySelector("[data-add-album-track]").addEventListener("click", () => {
        list.append(createTrackRow(list.children.length + 1));
        renumberTracks(list);
        list.lastElementChild?.querySelector("[data-album-track-title]")?.focus();
    });

    const coverInput = modal.querySelector("input[name='cover']");
    coverInput.addEventListener("change", () => {
        if (albumCoverPreviewUrl) URL.revokeObjectURL(albumCoverPreviewUrl);
        albumCoverPreviewUrl = null;
        const preview = modal.querySelector("[data-album-cover-preview]");
        const file = coverInput.files?.[0];
        preview.replaceChildren();
        if (!file) {
            preview.textContent = "♪";
            return;
        }
        albumCoverPreviewUrl = URL.createObjectURL(file);
        const image = document.createElement("img");
        image.src = albumCoverPreviewUrl;
        image.alt = "";
        preview.append(image);
    });

    modal.querySelectorAll("[data-close-album-upload]").forEach((button) => {
        button.addEventListener("click", () => closeAlbumUpload());
    });
    modal.addEventListener("click", (event) => {
        if (event.target === modal) closeAlbumUpload();
    });
    modal.querySelector("[data-album-upload-form]").addEventListener("submit", handleSubmit);

    applyTelegramInset(modal);
    window.Telegram?.WebApp?.onEvent?.("safeAreaChanged", () => applyTelegramInset(modal));
    window.Telegram?.WebApp?.onEvent?.("contentSafeAreaChanged", () => applyTelegramInset(modal));
    return modal;
}

function setStatus(message, error = false) {
    const status = document.querySelector("[data-album-upload-status]");
    if (!status) return;
    status.textContent = message;
    status.dataset.type = error ? "error" : "";
}

function setPending(pending) {
    albumUploadPending = pending;
    const modal = ensureModal();
    modal.querySelectorAll("input, textarea, button").forEach((control) => {
        control.disabled = pending;
    });
}

async function getUploader() {
    const { data: sessionData, error } = await supabase.auth.getSession();
    const userId = sessionData?.session?.user?.id;
    if (error || !userId) throw new Error("Сессия завершилась. Открой POJIDMUSIC заново.");
    const { data: profile, error: profileError } = await supabase.from("profiles").select("id,role").eq("id", userId).maybeSingle();
    if (profileError || !profile || !["artist", "admin"].includes(profile.role)) throw new Error("У аккаунта нет права загружать релизы.");
    const { data: artist, error: artistError } = await supabase.from("artists").select("id,display_name").eq("linked_profile_id", userId).maybeSingle();
    if (artistError || !artist) throw new Error("Сначала привяжи профиль артиста к аккаунту.");
    return { userId, artist };
}

function validateAudio(file) {
    const extension = extensionOf(file);
    if (!(file instanceof File) || file.size <= 0) throw new Error("У каждого трека должен быть аудиофайл.");
    if (file.size > MAX_AUDIO_BYTES) throw new Error(`Аудиофайл ${file.name} больше 50 МБ.`);
    if (!AUDIO_EXTENSIONS.has(extension)) throw new Error(`Формат ${file.name} не поддерживается. Нужен MP3, WAV или FLAC.`);
    return { file, extension, contentType: contentTypeForAudio(extension, file.type) };
}

function validateCover(file) {
    const extension = extensionOf(file);
    if (!(file instanceof File) || file.size <= 0) throw new Error("Добавь обложку альбома.");
    if (file.size > MAX_COVER_BYTES) throw new Error("Обложка больше 5 МБ.");
    if (!COVER_EXTENSIONS.has(extension)) throw new Error("Обложка должна быть JPG, PNG или WebP.");
    return { file, extension, contentType: file.type || (extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg") };
}

function readForm(form) {
    const title = String(form.elements.title.value || "").trim();
    const description = String(form.elements.description.value || "").trim();
    if (!title) throw new Error("Укажи название альбома.");
    const cover = validateCover(form.elements.cover.files?.[0]);
    const rows = [...form.querySelectorAll(".album-upload-track-row")];
    if (rows.length < 2) throw new Error("В альбоме должно быть минимум два трека.");
    const tracks = rows.map((row, index) => {
        const trackTitle = String(row.querySelector("[data-album-track-title]").value || "").trim();
        if (!trackTitle) throw new Error(`Укажи название трека №${index + 1}.`);
        return { title: trackTitle, audio: validateAudio(row.querySelector("[data-album-track-audio]").files?.[0]) };
    });
    return { title, description: description || null, cover, tracks };
}

async function uploadObject(bucket, path, validated) {
    const { error } = await supabase.storage.from(bucket).upload(path, validated.file, {
        cacheControl: bucket === COVER_BUCKET ? "31536000" : "3600",
        contentType: validated.contentType,
        upsert: false
    });
    if (error) throw error;
}

async function handleSubmit(event) {
    event.preventDefault();
    if (albumUploadPending) return;
    const modal = ensureModal();
    const form = event.currentTarget;
    const uploadedObjects = [];
    const createdTrackIds = [];
    let createdAlbumId = null;
    try {
        setPending(true);
        setStatus("Проверяем альбом…");
        const { userId, artist } = await getUploader();
        const values = readForm(form);

        const coverPath = createPath(userId, values.cover.extension);
        setStatus("Загружаем обложку…");
        await uploadObject(COVER_BUCKET, coverPath, values.cover);
        uploadedObjects.push({ bucket: COVER_BUCKET, path: coverPath });

        setStatus("Создаём альбом…");
        const { data: album, error: albumError } = await supabase.from("albums").insert({
            owner_id: userId,
            title: values.title,
            description: values.description,
            cover_path: coverPath
        }).select("id").single();
        if (albumError) throw albumError;
        createdAlbumId = album.id;

        for (let index = 0; index < values.tracks.length; index += 1) {
            const item = values.tracks[index];
            setStatus(`Загружаем ${index + 1} из ${values.tracks.length}: ${item.title}`);
            const audioPath = createPath(userId, item.audio.extension);
            await uploadObject(AUDIO_BUCKET, audioPath, item.audio);
            uploadedObjects.push({ bucket: AUDIO_BUCKET, path: audioPath });

            const { data: track, error: trackError } = await supabase.from("tracks").insert({
                owner_id: userId,
                title: item.title,
                artist_name: artist.display_name,
                description: null,
                cover_path: coverPath,
                audio_path: audioPath,
                release_type: "album_track",
                status: "pending",
                album_id: createdAlbumId,
                album_position: index + 1
            }).select("id").single();
            if (trackError) throw trackError;
            createdTrackIds.push(track.id);

            const { error: creditsError } = await supabase.rpc("set_track_artist_credits", {
                target_track_id: track.id,
                primary_artist_name: artist.display_name,
                primary_artist_ids: [artist.id],
                primary_artist_names: [artist.display_name],
                featured_artist_ids: [],
                featured_artist_names: []
            });
            if (creditsError) throw creditsError;
        }

        setStatus("Альбом загружен и отправлен на проверку.");
        form.reset();
        resetAlbumRows(modal);
        window.dispatchEvent(new CustomEvent("managedtrackchange"));
        window.setTimeout(() => closeAlbumUpload(), 900);
    } catch (error) {
        console.error("Album upload failed", error);
        setStatus(error?.message || "Не удалось загрузить альбом.", true);
        if (createdTrackIds.length) await supabase.from("tracks").delete().in("id", createdTrackIds);
        if (createdAlbumId) await supabase.from("albums").delete().eq("id", createdAlbumId);
        for (const object of uploadedObjects.reverse()) {
            try { await supabase.storage.from(object.bucket).remove([object.path]); } catch {}
        }
    } finally {
        setPending(false);
    }
}

function resetAlbumRows(modal) {
    const list = modal.querySelector("[data-album-track-list]");
    list.replaceChildren(createTrackRow(1), createTrackRow(2));
    renumberTracks(list);
    const preview = modal.querySelector("[data-album-cover-preview]");
    preview.replaceChildren();
    preview.textContent = "♪";
    if (albumCoverPreviewUrl) URL.revokeObjectURL(albumCoverPreviewUrl);
    albumCoverPreviewUrl = null;
}

export function openAlbumUpload() {
    const modal = ensureModal();
    applyTelegramInset(modal);
    modal.hidden = false;
    document.body.classList.add("album-upload-open");
    setStatus("");
    requestAnimationFrame(() => modal.querySelector("[data-close-album-upload]")?.focus({ preventScroll: true }));
}

export function closeAlbumUpload() {
    if (albumUploadPending) return;
    const modal = document.querySelector("[data-album-upload-modal]");
    if (!modal) return;
    modal.hidden = true;
    document.body.classList.remove("album-upload-open");
}

function installModeSwitch() {
    const dialog = document.querySelector(".track-upload-dialog");
    if (!dialog || dialog.querySelector("[data-upload-mode-switch]")) return false;
    const progress = dialog.querySelector(".track-upload-wizard-progress");
    if (!progress) return false;
    const switcher = document.createElement("div");
    switcher.className = "upload-mode-switch";
    switcher.dataset.uploadModeSwitch = "";
    switcher.innerHTML = `
        <button type="button" class="is-active">Трек</button>
        <button type="button" data-open-album-upload>Альбом</button>
    `;
    progress.before(switcher);
    switcher.querySelector("[data-open-album-upload]").addEventListener("click", () => {
        dialog.querySelector("[data-track-upload-close]")?.click();
        window.setTimeout(() => openAlbumUpload(), 0);
    });
    return true;
}

function initialize() {
    ensureModal();
    if (installModeSwitch()) return;
    const observer = new MutationObserver(() => {
        if (installModeSwitch()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
}

initialize();