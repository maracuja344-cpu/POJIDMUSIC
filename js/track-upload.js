import {
    getCurrentAuthState,
    subscribeToAuthState
} from "./auth.js";

import {
    supabase
} from "./supabase/client.js";
import { openImageCropper } from "./image-cropper.js";
import { getArtistRow } from "./data-repository.js";


const AUDIO_BUCKET = "track-audio";
const COVER_BUCKET = "track-covers";
const TRACK_STATUS = "pending";

const TITLE_MAX_LENGTH = 200;
const ARTIST_MAX_LENGTH = 200;
const PRIMARY_ARTIST_MAX_COUNT = 10;
const FEATURED_ARTIST_MAX_COUNT = 10;
const DESCRIPTION_MAX_LENGTH = 2000;
const ARTIST_SEARCH_DELAY_MS = 180;

const RELEASE_TYPES = new Set([
    "demo",
    "single",
    "album_track"
]);

const AUDIO_RULES = {
    maxSize: 50 * 1024 * 1024,
    extensions: new Set(["mp3", "wav", "flac"]),
    mimeByExtension: {
        mp3: new Set(["audio/mpeg"]),
        wav: new Set(["audio/wav", "audio/x-wav"]),
        flac: new Set(["audio/flac", "audio/x-flac"])
    },
    defaultMimeByExtension: {
        mp3: "audio/mpeg",
        wav: "audio/wav",
        flac: "audio/flac"
    }
};

const COVER_RULES = {
    maxSize: 5 * 1024 * 1024,
    extensions: new Set(["jpg", "jpeg", "png", "webp"]),
    mimeByExtension: {
        jpg: new Set(["image/jpeg"]),
        jpeg: new Set(["image/jpeg"]),
        png: new Set(["image/png"]),
        webp: new Set(["image/webp"])
    },
    defaultMimeByExtension: {
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        png: "image/png",
        webp: "image/webp"
    }
};

const STATE_MESSAGES = {
    validating: "Проверяем данные",
    "uploading-audio": "Загружаем аудио",
    "uploading-cover": "Загружаем обложку",
    "creating-track": "Создаём трек",
    "cleaning-up": "Удаляем незавершённые файлы"
};


let uploadInitialized = false;
let uploadPending = false;
let previouslyFocusedElement = null;
let coverPreviewUrl = null;
let unsubscribeAuthState = null;
let defaultArtistHandledForUserId = null;
let activeUploadUserId = null;
const selectedArtistCredits = {
    primary: [],
    featured: []
};
const artistSearchState = {
    primary: { timer: null, requestId: 0, options: [], activeIndex: -1 },
    featured: { timer: null, requestId: 0, options: [], activeIndex: -1 }
};


class TrackUploadError extends Error {
    constructor(message, stage, technicalMessage = "") {
        super(message);
        this.name = "TrackUploadError";
        this.stage = stage;
        this.technicalMessage = technicalMessage;
    }
}


function getUploadElements() {
    const modal = document.querySelector(".track-upload-modal");

    const getPicker = (role) => {
        const group = modal?.querySelector(
            `[data-artist-picker="${role}"]`
        );

        return {
            group,
            list: group?.querySelector("[data-artist-credit-list]"),
            input: group?.querySelector("[data-artist-picker-input]"),
            suggestions: group?.querySelector("[data-artist-suggestions]")
        };
    };

    return {
        openButton:
            document.querySelector(".track-upload-open-button"),
        modal,
        dialog:
            modal?.querySelector(".track-upload-dialog"),
        closeButtons:
            modal?.querySelectorAll("[data-track-upload-close]"),
        closeButton:
            modal?.querySelector(".track-upload-close-button"),
        form:
            modal?.querySelector(".track-upload-form"),
        message:
            modal?.querySelector(".track-upload-message"),
        audioInput:
            modal?.querySelector("#track-upload-audio"),
        coverInput:
            modal?.querySelector("#track-upload-cover"),
        audioDetails:
            modal?.querySelector(
                "[data-track-upload-audio-details]"
            ),
        coverDetails:
            modal?.querySelector(
                "[data-track-upload-cover-details]"
            ),
        coverPreview:
            modal?.querySelector(".track-upload-cover-preview"),
        coverPreviewImage:
            modal?.querySelector(".track-upload-cover-preview img"),
        artistPickers: {
            primary: getPicker("primary"),
            featured: getPicker("featured")
        }
    };
}


function canUploadTracks(authState) {
    return (
        authState?.user?.id &&
        authState.profileState === "ready" &&
        ["artist", "admin"].includes(authState.profile?.role)
    );
}


function normalizeCreditName(value) {
    return String(value || "")
        .trim()
        .replace(/\s+/g, " ")
        .toLocaleLowerCase();
}


function getCreditKey(credit) {
    return credit.id
        ? `id:${credit.id}`
        : `name:${normalizeCreditName(credit.displayName)}`;
}


function creditAlreadySelected(credit) {
    const normalizedName = normalizeCreditName(credit.displayName);

    return [
        ...selectedArtistCredits.primary,
        ...selectedArtistCredits.featured
    ].some((selected) => {
        return (
            getCreditKey(selected) === getCreditKey(credit) ||
            normalizeCreditName(selected.displayName) === normalizedName
        );
    });
}


function closeArtistSuggestions(elements, role) {
    const picker = elements.artistPickers[role];
    const state = artistSearchState[role];

    window.clearTimeout(state.timer);
    state.timer = null;
    state.requestId += 1;
    state.options = [];
    state.activeIndex = -1;
    picker.suggestions.replaceChildren();
    picker.suggestions.hidden = true;
    picker.input.setAttribute("aria-expanded", "false");
    picker.input.removeAttribute("aria-activedescendant");
}


function renderSelectedArtistCredits(elements, role) {
    const picker = elements.artistPickers[role];
    const fragment = document.createDocumentFragment();

    selectedArtistCredits[role].forEach((credit, index) => {
        const chip = document.createElement("span");
        const name = document.createElement("span");
        const removeButton = document.createElement("button");

        chip.className = "track-upload-credit-chip";
        name.textContent = credit.displayName;
        removeButton.className = "track-upload-credit-remove";
        removeButton.type = "button";
        removeButton.textContent = "×";
        removeButton.dataset.creditIndex = String(index);
        removeButton.setAttribute(
            "aria-label",
            `Удалить артиста ${credit.displayName}`
        );
        chip.append(name, removeButton);
        fragment.append(chip);
    });

    picker.list.replaceChildren(fragment);
}


function addArtistCredit(
    elements,
    role,
    credit,
    { prepend = false } = {}
) {
    const limit = role === "primary"
        ? PRIMARY_ARTIST_MAX_COUNT
        : FEATURED_ARTIST_MAX_COUNT;

    if (selectedArtistCredits[role].length >= limit) {
        setUploadState(
            elements,
            "error",
            `Можно указать не больше ${limit} ${
                role === "primary" ? "основных" : "приглашённых"
            } артистов.`,
            "error"
        );
        return false;
    }

    if (creditAlreadySelected(credit)) {
        setUploadState(
            elements,
            "error",
            "Один и тот же артист не должен повторяться в кредитах.",
            "error"
        );
        return false;
    }

    const selectedCredit = Object.freeze({
        id: credit.id || null,
        displayName: String(credit.displayName || "").trim(),
        normalizedName:
            credit.normalizedName || normalizeCreditName(credit.displayName),
        slug: credit.slug || "",
        handle: credit.handle || "",
        isPlaceholder: !credit.id
    });

    if (prepend) {
        selectedArtistCredits[role].unshift(selectedCredit);
    } else {
        selectedArtistCredits[role].push(selectedCredit);
    }
    renderSelectedArtistCredits(elements, role);
    elements.artistPickers[role].input.value = "";
    closeArtistSuggestions(elements, role);
    setUploadState(elements, "idle");
    return true;
}


function removeArtistCredit(elements, role, index) {
    if (!Number.isInteger(index) || index < 0) return;
    selectedArtistCredits[role].splice(index, 1);
    renderSelectedArtistCredits(elements, role);
}


function setActiveArtistOption(elements, role, nextIndex) {
    const state = artistSearchState[role];
    const buttons = Array.from(
        elements.artistPickers[role].suggestions.querySelectorAll(
            ".track-upload-artist-option"
        )
    );

    if (!buttons.length) return;
    state.activeIndex = Math.max(0, Math.min(nextIndex, buttons.length - 1));
    buttons.forEach((button, index) => {
        button.classList.toggle("is-active", index === state.activeIndex);
        button.setAttribute(
            "aria-selected",
            String(index === state.activeIndex)
        );
    });
    const activeButton = buttons[state.activeIndex];
    elements.artistPickers[role].input.setAttribute(
        "aria-activedescendant",
        activeButton.id
    );
    activeButton.scrollIntoView({ block: "nearest" });
}


function renderArtistSuggestions(elements, role, options) {
    const picker = elements.artistPickers[role];
    const state = artistSearchState[role];
    const fragment = document.createDocumentFragment();

    state.options = options;
    state.activeIndex = -1;

    options.forEach((option, index) => {
        const button = document.createElement("button");
        const name = document.createElement("span");

        button.id = `track-upload-${role}-option-${index}`;
        button.className = "track-upload-artist-option";
        button.type = "button";
        button.setAttribute("role", "option");
        button.setAttribute("aria-selected", "false");
        button.dataset.optionIndex = String(index);
        name.textContent = option.isPlaceholder
            ? `Создать артиста «${option.displayName}»`
            : option.displayName;
        button.append(name);

        if (option.handle) {
            const handle = document.createElement("small");
            handle.textContent = `@${option.handle}`;
            button.append(handle);
        }

        if (option.isPlaceholder) {
            button.classList.add("is-placeholder");
        }

        fragment.append(button);
    });

    picker.suggestions.replaceChildren(fragment);
    picker.suggestions.hidden = options.length === 0;
    picker.input.setAttribute("aria-expanded", String(options.length > 0));
}


async function searchArtists(elements, role, rawQuery) {
    const query = String(rawQuery || "").trim();
    const searchTerm = query.replace(/^@/, "");
    const state = artistSearchState[role];
    const requestId = ++state.requestId;

    if (!searchTerm) {
        closeArtistSuggestions(elements, role);
        return;
    }

    const { data, error } = await supabase.rpc(
        "search_artists_for_credit",
        {
            search_term: searchTerm,
            result_limit: 8
        }
    );

    if (requestId !== state.requestId) return;

    const rows = error || !Array.isArray(data) ? [] : data;
    const exactMatch = rows.some((row) => {
        return (
            row.normalized_name === normalizeCreditName(searchTerm) ||
            row.handle === normalizeCreditName(searchTerm)
        );
    });
    const options = rows
        .map((row) => ({
            id: row.id,
            displayName: row.display_name,
            normalizedName: row.normalized_name,
            slug: row.slug,
            handle: row.handle || "",
            isPlaceholder: false
        }))
        .filter((credit) => !creditAlreadySelected(credit));

    if (
        !query.startsWith("@") &&
        !exactMatch &&
        searchTerm.length <= ARTIST_MAX_LENGTH
    ) {
        options.push({
            id: null,
            displayName: searchTerm.replace(/\s+/g, " "),
            normalizedName: normalizeCreditName(searchTerm),
            slug: "",
            handle: "",
            isPlaceholder: true
        });
    }

    renderArtistSuggestions(elements, role, options);
}


function scheduleArtistSearch(elements, role) {
    const state = artistSearchState[role];
    const query = elements.artistPickers[role].input.value;

    window.clearTimeout(state.timer);
    state.timer = window.setTimeout(() => {
        void searchArtists(elements, role, query);
    }, ARTIST_SEARCH_DELAY_MS);
}


async function addCurrentArtistDefault(elements) {
    const authState = getCurrentAuthState();
    const userId = authState.user?.id;

    if (
        !userId ||
        defaultArtistHandledForUserId === userId
    ) {
        return;
    }

    defaultArtistHandledForUserId = userId;
    let data = null;
    try {
        data = await getArtistRow("linked_profile_id", userId);
    } catch {
        return;
    }

    if (
        !data ||
        getCurrentAuthState().user?.id !== userId ||
        defaultArtistHandledForUserId !== userId
    ) {
        return;
    }

    const currentArtist = {
        id: data.id,
        displayName: data.display_name,
        normalizedName: data.normalized_name,
        slug: data.slug
    };

    if (creditAlreadySelected(currentArtist)) return;
    addArtistCredit(
        elements,
        "primary",
        currentArtist,
        { prepend: true }
    );
}


function resetArtistCredits(elements, { resetDefault = true } = {}) {
    selectedArtistCredits.primary.splice(0);
    selectedArtistCredits.featured.splice(0);

    for (const role of ["primary", "featured"]) {
        renderSelectedArtistCredits(elements, role);
        elements.artistPickers[role].input.value = "";
        closeArtistSuggestions(elements, role);
    }

    if (resetDefault) {
        defaultArtistHandledForUserId = null;
    }
}


function setUploadState(
    elements,
    state,
    message = STATE_MESSAGES[state] || "",
    type = ""
) {
    elements.form.dataset.state = state;
    elements.message.textContent = message;
    elements.message.hidden = message === "";
    elements.message.classList.toggle(
        "is-error",
        type === "error"
    );
    elements.message.classList.toggle(
        "is-success",
        type === "success"
    );
}


function setUploadPending(elements, pending) {
    uploadPending = pending;
    elements.form.setAttribute("aria-busy", String(pending));
    elements.closeButton.disabled = pending;

    elements.form
        .querySelectorAll("input, textarea, select, button")
        .forEach((control) => {
            control.disabled = pending;
        });
}


function getFileExtension(fileName) {
    const lastDotIndex = fileName.lastIndexOf(".");

    if (
        lastDotIndex < 1 ||
        lastDotIndex === fileName.length - 1
    ) {
        return "";
    }

    return fileName.slice(lastDotIndex + 1).toLowerCase();
}


function formatFileSize(size) {
    if (!Number.isFinite(size) || size < 0) {
        return "неизвестный размер";
    }

    const units = ["Б", "КиБ", "МиБ", "ГиБ"];
    let value = size;
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }

    return (
        new Intl.NumberFormat("ru-RU", {
            maximumFractionDigits: unitIndex === 0 ? 0 : 1
        }).format(value) +
        " " +
        units[unitIndex]
    );
}


function showSelectedFile(detailsElement, file, fallbackText) {
    detailsElement.textContent = file
        ? `${file.name} · ${formatFileSize(file.size)}`
        : fallbackText;
}


function revokeCoverPreview(elements) {
    if (coverPreviewUrl) {
        URL.revokeObjectURL(coverPreviewUrl);
        coverPreviewUrl = null;
    }

    elements.coverPreviewImage.removeAttribute("src");
    elements.coverPreview.hidden = true;
}


function updateCoverPreview(elements, file) {
    revokeCoverPreview(elements);

    if (!file) return;

    coverPreviewUrl = URL.createObjectURL(file);
    elements.coverPreviewImage.src = coverPreviewUrl;
    elements.coverPreview.hidden = false;
}


function validateFile(file, rules, fileLabel) {
    if (!(file instanceof File)) {
        throw new TrackUploadError(
            `Выберите ${fileLabel}.`,
            "validating"
        );
    }

    if (file.size <= 0) {
        throw new TrackUploadError(
            `Выбранный ${fileLabel} пуст.`,
            "validating"
        );
    }

    if (file.size > rules.maxSize) {
        throw new TrackUploadError(
            `${fileLabel} превышает допустимый размер.`,
            "validating"
        );
    }

    const extension = getFileExtension(file.name);

    if (!rules.extensions.has(extension)) {
        throw new TrackUploadError(
            `Недопустимое расширение файла: ${fileLabel}.`,
            "validating"
        );
    }

    const reportedMime = String(file.type || "")
        .trim()
        .toLowerCase();
    const allowedMimes = rules.mimeByExtension[extension];

    if (reportedMime && !allowedMimes.has(reportedMime)) {
        throw new TrackUploadError(
            `Тип файла не соответствует расширению: ${fileLabel}.`,
            "validating"
        );
    }

    return {
        file,
        extension,
        contentType:
            reportedMime ||
            rules.defaultMimeByExtension[extension]
    };
}


function validateForm(elements) {
    const titleInput =
        elements.form.elements.namedItem("title");
    const descriptionInput =
        elements.form.elements.namedItem("description");
    const releaseTypeInput =
        elements.form.elements.namedItem("release_type");

    const title = String(titleInput?.value || "").trim();
    const primaryArtists = [...selectedArtistCredits.primary];
    const featuredArtists = [...selectedArtistCredits.featured];
    const description =
        String(descriptionInput?.value || "").trim();
    const releaseType =
        String(releaseTypeInput?.value || "");

    if (!title) {
        throw new TrackUploadError(
            "Укажите название трека.",
            "validating"
        );
    }

    if (title.length > TITLE_MAX_LENGTH) {
        throw new TrackUploadError(
            `Название должно быть не длиннее ${TITLE_MAX_LENGTH} символов.`,
            "validating"
        );
    }

    if (
        elements.artistPickers.primary.input.value.trim() ||
        elements.artistPickers.featured.input.value.trim()
    ) {
        throw new TrackUploadError(
            "Выберите артиста из подсказок или явно создайте placeholder.",
            "validating"
        );
    }

    if (primaryArtists.length < 1) {
        throw new TrackUploadError(
            "Укажите хотя бы одного основного артиста.",
            "validating"
        );
    }

    if (primaryArtists.length > PRIMARY_ARTIST_MAX_COUNT) {
        throw new TrackUploadError(
            `Можно указать не больше ${PRIMARY_ARTIST_MAX_COUNT} основных артистов.`,
            "validating"
        );
    }

    if (featuredArtists.length > FEATURED_ARTIST_MAX_COUNT) {
        throw new TrackUploadError(
            `Можно указать не больше ${FEATURED_ARTIST_MAX_COUNT} приглашённых артистов.`,
            "validating"
        );
    }

    const allArtists = [...primaryArtists, ...featuredArtists];

    if (allArtists.some((artist) => (
        !artist.displayName || artist.displayName.length > ARTIST_MAX_LENGTH
    ))) {
        throw new TrackUploadError(
            `Имя артиста должно содержать от 1 до ${ARTIST_MAX_LENGTH} символов.`,
            "validating"
        );
    }

    const creditKeys = allArtists.map(getCreditKey);
    const normalizedNames = allArtists.map((artist) => (
        normalizeCreditName(artist.displayName)
    ));

    if (
        new Set(creditKeys).size !== creditKeys.length ||
        new Set(normalizedNames).size !== normalizedNames.length
    ) {
        throw new TrackUploadError(
            "Один и тот же артист не должен повторяться в кредитах.",
            "validating"
        );
    }

    if (description.length > DESCRIPTION_MAX_LENGTH) {
        throw new TrackUploadError(
            `Описание должно быть не длиннее ${DESCRIPTION_MAX_LENGTH} символов.`,
            "validating"
        );
    }

    if (!RELEASE_TYPES.has(releaseType)) {
        throw new TrackUploadError(
            "Выберите допустимый тип релиза.",
            "validating"
        );
    }

    const audio = validateFile(
        elements.audioInput.files?.[0],
        AUDIO_RULES,
        "аудиофайл"
    );
    const cover = validateFile(
        elements.coverInput.files?.[0],
        COVER_RULES,
        "файл обложки"
    );

    return {
        title,
        primaryArtists,
        featuredArtists,
        artistCredit: primaryArtists
            .map((artist) => artist.displayName)
            .join(" & ") + (
            featuredArtists.length
                ? ` feat. ${featuredArtists
                    .map((artist) => artist.displayName)
                    .join(", ")}`
                : ""
        ),
        description: description || null,
        releaseType,
        audio,
        cover
    };
}


async function getFreshUploaderIdentity() {
    const {
        data: sessionData,
        error: sessionError
    } = await supabase.auth.getSession();
    const session = sessionData?.session || null;

    if (sessionError || !session?.user?.id) {
        throw new TrackUploadError(
            "Сессия завершилась. Войдите снова.",
            "validating",
            sessionError?.message
        );
    }

    const {
        data: profile,
        error: profileError
    } = await supabase
        .from("profiles")
        .select("id, role")
        .eq("id", session.user.id)
        .maybeSingle();

    if (profileError) {
        throw new TrackUploadError(
            "Не удалось проверить профиль. Попробуйте ещё раз.",
            "validating",
            profileError.message
        );
    }

    if (!profile) {
        throw new TrackUploadError(
            "Профиль ещё не готов. Попробуйте немного позже.",
            "validating"
        );
    }

    if (!["artist", "admin"].includes(profile.role)) {
        throw new TrackUploadError(
            "У этого аккаунта нет права загружать треки.",
            "validating"
        );
    }

    return {
        session,
        userId: session.user.id
    };
}


function createObjectPath(userId, extension) {
    if (typeof crypto.randomUUID !== "function") {
        throw new TrackUploadError(
            "Этот браузер не поддерживает безопасное создание имени файла.",
            "validating"
        );
    }

    return `${userId}/${crypto.randomUUID()}.${extension}`;
}


async function uploadObject(bucket, path, validatedFile) {
    const {
        error
    } = await supabase.storage
        .from(bucket)
        .upload(path, validatedFile.file, {
            cacheControl: "3600",
            contentType: validatedFile.contentType,
            upsert: false
        });

    if (error) {
        throw new TrackUploadError(
            bucket === AUDIO_BUCKET
                ? "Не удалось загрузить аудиофайл."
                : "Не удалось загрузить обложку.",
            bucket === AUDIO_BUCKET
                ? "uploading-audio"
                : "uploading-cover",
            error.message
        );
    }
}


async function cleanupObjects(objects, elements) {
    if (objects.length === 0) return [];

    setUploadState(elements, "cleaning-up");

    const cleanupResults = await Promise.all(
        objects.map(async ({ bucket, path }) => {
            try {
                const {
                    error
                } = await supabase.storage
                    .from(bucket)
                    .remove([path]);

                if (error) {
                    throw error;
                }

                return null;
            } catch (error) {
                const safeDetails = {
                    bucket,
                    path,
                    message: String(error?.message || "Unknown error")
                };

                console.error(
                    "Не удалось удалить незавершённый Storage-объект.",
                    safeDetails
                );

                return safeDetails;
            }
        })
    );

    return cleanupResults.filter(Boolean);
}


function logUploadError(error) {
    console.error("Не удалось загрузить трек.", {
        stage: error?.stage || "unknown",
        message:
            error?.technicalMessage ||
            error?.message ||
            "Unknown error"
    });
}


function resetUploadForm(elements) {
    elements.form.reset();
    resetArtistCredits(elements);
    revokeCoverPreview(elements);
    showSelectedFile(
        elements.audioDetails,
        null,
        "MP3, WAV или FLAC, не больше 50 MiB"
    );
    showSelectedFile(
        elements.coverDetails,
        null,
        "JPG, PNG или WebP, не больше 5 MiB"
    );
}


async function handleUploadSubmit(event, elements) {
    event.preventDefault();

    if (uploadPending) return;

    setUploadPending(elements, true);
    setUploadState(elements, "validating");

    const attemptedObjects = [];
    let createdTrackId = null;

    try {
        const {
            userId
        } = await getFreshUploaderIdentity();
        const values = validateForm(elements);

        const audioPath = createObjectPath(
            userId,
            values.audio.extension
        );
        const coverPath = createObjectPath(
            userId,
            values.cover.extension
        );

        setUploadState(elements, "uploading-audio");
        attemptedObjects.push({
            bucket: AUDIO_BUCKET,
            path: audioPath
        });
        await uploadObject(
            AUDIO_BUCKET,
            audioPath,
            values.audio
        );

        setUploadState(elements, "uploading-cover");
        attemptedObjects.push({
            bucket: COVER_BUCKET,
            path: coverPath
        });
        await uploadObject(
            COVER_BUCKET,
            coverPath,
            values.cover
        );

        setUploadState(elements, "creating-track");

        const {
            data: createdTrack,
            error: trackError
        } = await supabase
            .from("tracks")
            .insert({
                owner_id: userId,
                title: values.title,
                artist_name: values.artistCredit,
                description: values.description,
                cover_path: coverPath,
                audio_path: audioPath,
                release_type: values.releaseType,
                status: TRACK_STATUS
            })
            .select("id")
            .single();

        if (trackError) {
            throw new TrackUploadError(
                "Не удалось создать запись трека.",
                "creating-track",
                trackError.message
            );
        }

        createdTrackId = createdTrack?.id || null;

        if (!createdTrackId) {
            throw new TrackUploadError(
                "Не удалось получить идентификатор нового трека.",
                "creating-track"
            );
        }

        const { error: creditsError } = await supabase.rpc(
            "set_track_artist_credits",
            {
                target_track_id: createdTrackId,
                primary_artist_name:
                    values.primaryArtists[0].displayName,
                primary_artist_ids:
                    values.primaryArtists.map((artist) => artist.id),
                primary_artist_names:
                    values.primaryArtists.map((artist) => artist.displayName),
                featured_artist_ids:
                    values.featuredArtists.map((artist) => artist.id),
                featured_artist_names:
                    values.featuredArtists.map((artist) => artist.displayName)
            }
        );

        if (creditsError) {
            throw new TrackUploadError(
                "Не удалось сохранить артистов трека.",
                "creating-track",
                creditsError.message
            );
        }

        resetUploadForm(elements);
        setUploadState(
            elements,
            "success",
            "Трек успешно загружен. Трек отправлен на проверку.",
            "success"
        );
        window.dispatchEvent(new CustomEvent("managedtrackchange"));
    } catch (error) {
        const uploadError =
            error instanceof TrackUploadError
                ? error
                : new TrackUploadError(
                    "Не удалось загрузить трек. Попробуйте ещё раз.",
                    "unknown",
                    String(error?.message || "")
                );

        logUploadError(uploadError);

        if (createdTrackId) {
            const { error: trackCleanupError } = await supabase
                .from("tracks")
                .delete()
                .eq("id", createdTrackId);

            if (trackCleanupError) {
                console.error(
                    "Не удалось удалить незавершённую запись трека.",
                    trackCleanupError.message
                );
            }
        }

        const cleanupErrors = await cleanupObjects(
            attemptedObjects,
            elements
        );
        const cleanupMessage = cleanupErrors.length > 0
            ? " Также не удалось полностью удалить незавершённые файлы."
            : "";

        setUploadState(
            elements,
            "error",
            uploadError.message + cleanupMessage,
            "error"
        );
    } finally {
        setUploadPending(elements, false);
    }
}


function openUploadModal(elements) {
    const authState = getCurrentAuthState();

    if (!canUploadTracks(authState) || uploadPending) {
        return;
    }

    previouslyFocusedElement =
        document.activeElement instanceof HTMLElement
            ? document.activeElement
            : elements.openButton;

    const coverFile = elements.coverInput.files?.[0];
    if (coverFile) {
        try {
            validateFile(
                coverFile,
                COVER_RULES,
                "файл обложки"
            );
            updateCoverPreview(elements, coverFile);
        } catch {
            revokeCoverPreview(elements);
        }
    }

    if (elements.form.dataset.state === "success") {
        setUploadState(elements, "idle");
    }

    elements.modal.hidden = false;
    document.body.classList.add("track-upload-modal-open");
    void addCurrentArtistDefault(elements);

    window.requestAnimationFrame(() => {
        elements.form
            .querySelector("input:not([disabled])")
            ?.focus();
    });
}


function closeUploadModal(elements) {
    if (uploadPending || elements.modal.hidden) {
        return;
    }

    elements.modal.hidden = true;
    document.body.classList.remove("track-upload-modal-open");
    revokeCoverPreview(elements);

    const previousElementIsVisible =
        previouslyFocusedElement &&
        document.contains(previouslyFocusedElement) &&
        !previouslyFocusedElement.closest("[hidden]");

    const focusTarget = previousElementIsVisible
        ? previouslyFocusedElement
        : document.querySelector(
            ".auth-profile-button:not([hidden])"
        );

    focusTarget?.focus();

    previouslyFocusedElement = null;
}


function trapModalFocus(event, elements) {
    if (
        event.key !== "Tab" ||
        elements.modal.hidden
    ) {
        return;
    }

    const focusableElements = Array.from(
        elements.modal.querySelectorAll(
            "button:not([disabled]), " +
            "input:not([disabled]), " +
            "textarea:not([disabled]), " +
            "select:not([disabled]), " +
            "[href], [tabindex]:not([tabindex='-1'])"
        )
    ).filter((element) => {
        return !element.closest("[hidden]");
    });

    if (focusableElements.length === 0) return;

    const firstElement = focusableElements[0];
    const lastElement =
        focusableElements[focusableElements.length - 1];

    if (
        event.shiftKey &&
        document.activeElement === firstElement
    ) {
        event.preventDefault();
        lastElement.focus();
    } else if (
        !event.shiftKey &&
        document.activeElement === lastElement
    ) {
        event.preventDefault();
        firstElement.focus();
    }
}


function handleAuthStateChange(authState, elements) {
    const canUpload = canUploadTracks(authState);
    const nextUserId = authState.user?.id || null;

    if (activeUploadUserId !== nextUserId) {
        activeUploadUserId = nextUserId;
        resetArtistCredits(elements);
    }

    elements.openButton.hidden = !canUpload;

    if (
        !canUpload &&
        !elements.modal.hidden &&
        !uploadPending
    ) {
        closeUploadModal(elements);
    }
}


export function initializeTrackUpload() {
    if (uploadInitialized) return;

    const elements = getUploadElements();

    if (
        !elements.openButton ||
        !elements.modal ||
        !elements.dialog ||
        !elements.closeButtons ||
        !elements.closeButton ||
        !elements.form ||
        !elements.message ||
        !elements.audioInput ||
        !elements.coverInput ||
        !elements.audioDetails ||
        !elements.coverDetails ||
        !elements.coverPreview ||
        !elements.coverPreviewImage ||
        ["primary", "featured"].some((role) => {
            const picker = elements.artistPickers[role];
            return !picker.group || !picker.list ||
                !picker.input || !picker.suggestions;
        })
    ) {
        return;
    }

    uploadInitialized = true;

    elements.openButton.addEventListener("click", () => {
        openUploadModal(elements);
    });

    elements.closeButtons.forEach((button) => {
        button.addEventListener("click", () => {
            closeUploadModal(elements);
        });
    });

    for (const role of ["primary", "featured"]) {
        const picker = elements.artistPickers[role];

        picker.list.addEventListener("click", (event) => {
            const button = event.target.closest("[data-credit-index]");
            if (!button) return;
            removeArtistCredit(
                elements,
                role,
                Number(button.dataset.creditIndex)
            );
            setUploadState(elements, "idle");
        });

        picker.input.addEventListener("input", () => {
            scheduleArtistSearch(elements, role);
        });

        picker.input.addEventListener("focus", () => {
            if (picker.input.value.trim()) {
                scheduleArtistSearch(elements, role);
            }
        });

        picker.input.addEventListener("keydown", (event) => {
            const state = artistSearchState[role];

            if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveArtistOption(
                    elements,
                    role,
                    state.activeIndex + 1
                );
                return;
            }

            if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveArtistOption(
                    elements,
                    role,
                    state.activeIndex <= 0
                        ? state.options.length - 1
                        : state.activeIndex - 1
                );
                return;
            }

            if (event.key === "Enter" && state.options.length) {
                event.preventDefault();
                const option = state.options[
                    state.activeIndex >= 0 ? state.activeIndex : 0
                ];
                if (option) addArtistCredit(elements, role, option);
                return;
            }

            if (event.key === "Escape") {
                event.stopPropagation();
                closeArtistSuggestions(elements, role);
            }
        });

        picker.suggestions.addEventListener("click", (event) => {
            const button = event.target.closest("[data-option-index]");
            const option = artistSearchState[role].options[
                Number(button?.dataset.optionIndex)
            ];
            if (option) addArtistCredit(elements, role, option);
        });
    }

    document.addEventListener("click", (event) => {
        for (const role of ["primary", "featured"]) {
            if (!elements.artistPickers[role].group.contains(event.target)) {
                closeArtistSuggestions(elements, role);
            }
        }
    });

    elements.audioInput.addEventListener("change", () => {
        const file = elements.audioInput.files?.[0] || null;
        showSelectedFile(
            elements.audioDetails,
            file,
            "MP3, WAV или FLAC, не больше 50 MiB"
        );

        if (!file) return;

        try {
            validateFile(file, AUDIO_RULES, "аудиофайл");
            setUploadState(elements, "idle");
        } catch (error) {
            setUploadState(
                elements,
                "error",
                error.message,
                "error"
            );
        }
    });

    elements.coverInput.addEventListener("change", async () => {
        const file = elements.coverInput.files?.[0] || null;
        showSelectedFile(
            elements.coverDetails,
            file,
            "JPG, PNG или WebP, не больше 5 MiB"
        );

        if (!file) {
            revokeCoverPreview(elements);
            return;
        }

        try {
            validateFile(file, COVER_RULES, "файл обложки");
            const cropResult = await openImageCropper({
                source: file,
                mode: "cover",
                upload: true
            });
            const croppedFile = new File(
                [cropResult.blob],
                "cover.webp",
                { type: "image/webp" }
            );
            const transfer = new DataTransfer();
            transfer.items.add(croppedFile);
            elements.coverInput.files = transfer.files;
            updateCoverPreview(elements, croppedFile);
            setUploadState(elements, "idle");
        } catch (error) {
            if (error?.name === "AbortError") {
                elements.coverInput.value = "";
                revokeCoverPreview(elements);
                return;
            }
            revokeCoverPreview(elements);
            setUploadState(
                elements,
                "error",
                error.message,
                "error"
            );
        }
    });

    elements.form.addEventListener("submit", (event) => {
        void handleUploadSubmit(event, elements);
    });

    document.addEventListener("keydown", (event) => {
        if (elements.modal.hidden) return;

        if (event.key === "Escape") {
            closeUploadModal(elements);
            return;
        }

        trapModalFocus(event, elements);
    });

    unsubscribeAuthState = subscribeToAuthState(
        (authState) => {
            handleAuthStateChange(authState, elements);
        }
    );

    window.addEventListener(
        "pagehide",
        () => {
            unsubscribeAuthState?.();
            unsubscribeAuthState = null;
            revokeCoverPreview(elements);
        },
        {
            once: true
        }
    );
}
