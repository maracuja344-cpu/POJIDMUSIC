import {
    getCurrentAuthState,
    subscribeToAuthState
} from "./auth.js";

import {
    supabase
} from "./supabase/client.js";


const AUDIO_BUCKET = "track-audio";
const COVER_BUCKET = "track-covers";
const TRACK_STATUS = "pending";

const TITLE_MAX_LENGTH = 200;
const ARTIST_MAX_LENGTH = 200;
const DESCRIPTION_MAX_LENGTH = 2000;

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
            modal?.querySelector(".track-upload-cover-preview img")
    };
}


function isArtistState(authState) {
    return (
        authState?.user?.id &&
        authState.profileState === "ready" &&
        authState.profile?.role === "artist"
    );
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
    const artistInput =
        elements.form.elements.namedItem("artist_name");
    const descriptionInput =
        elements.form.elements.namedItem("description");
    const releaseTypeInput =
        elements.form.elements.namedItem("release_type");

    const title = String(titleInput?.value || "").trim();
    const artistName =
        String(artistInput?.value || "").trim();
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

    if (!artistName) {
        throw new TrackUploadError(
            "Укажите исполнителя.",
            "validating"
        );
    }

    if (artistName.length > ARTIST_MAX_LENGTH) {
        throw new TrackUploadError(
            `Имя исполнителя должно быть не длиннее ${ARTIST_MAX_LENGTH} символов.`,
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
        artistName,
        description: description || null,
        releaseType,
        audio,
        cover
    };
}


async function getFreshArtistIdentity() {
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

    if (profile.role !== "artist") {
        throw new TrackUploadError(
            "Загрузка доступна только профилю артиста.",
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

    try {
        const {
            userId
        } = await getFreshArtistIdentity();
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
            error: trackError
        } = await supabase
            .from("tracks")
            .insert({
                owner_id: userId,
                title: values.title,
                artist_name: values.artistName,
                description: values.description,
                cover_path: coverPath,
                audio_path: audioPath,
                release_type: values.releaseType,
                status: TRACK_STATUS
            });

        if (trackError) {
            throw new TrackUploadError(
                "Не удалось создать запись трека.",
                "creating-track",
                trackError.message
            );
        }

        resetUploadForm(elements);
        setUploadState(
            elements,
            "success",
            "Трек успешно загружен. Трек отправлен на проверку.",
            "success"
        );
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

    if (!isArtistState(authState) || uploadPending) {
        return;
    }

    previouslyFocusedElement =
        document.activeElement instanceof HTMLElement
            ? document.activeElement
            : elements.openButton;

    const artistInput =
        elements.form.elements.namedItem("artist_name");
    const displayName =
        typeof authState.profile?.display_name === "string"
            ? authState.profile.display_name.trim()
            : "";

    if (
        artistInput instanceof HTMLInputElement &&
        !artistInput.value.trim() &&
        displayName
    ) {
        artistInput.value = displayName;
    }

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
    const artist = isArtistState(authState);
    elements.openButton.hidden = !artist;

    if (
        !artist &&
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
        !elements.coverPreviewImage
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

    elements.coverInput.addEventListener("change", () => {
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
            updateCoverPreview(elements, file);
            setUploadState(elements, "idle");
        } catch (error) {
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
