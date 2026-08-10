import { isPlayableRelease } from "./tracks-utils.js";
import {
    getCatalogTrackById,
    getCatalogTracks,
    replaceCatalogTrack,
    sortTracksByReleaseDate
} from "./catalog-state.js";
import {
    getPlaybackContext,
    reconcilePlaybackContext,
    restorePlaybackContext,
    setPlaybackContext,
    setPlaybackContextCurrent
} from "./playback-context.js";
import {
    renderFullscreenArtistIdentity,
    renderArtistLinks
} from "./artist-utils.js";
import {
    getHistoryDecision,
    getSequentialQueueId,
    getShuffleDecision,
    shouldRepeatCurrentTrack
} from "./queue-decisions.js";
import {
    prefetchTrackAudio,
    refreshTrackAudio,
    resolveTrackAudio,
    shouldRetrySignedAudioError
} from "./audio-url-resolver.js";
import { getTrackCardArtwork } from "./artwork.js";
import {
    loadPlayerSnapshot,
    reconcilePlayerSnapshot,
    savePlayerSnapshot
} from "./player-persistence.js";
import { createMediaSessionController } from "./media-session.js";


/* =========================================================
   1. СОЗДАНИЕ АУДИОПЛЕЕРА
   ========================================================= */

/*
Единственный Audio является источником истины для mini-player,
fullscreen, очереди и Media Session. CORS-режим задаётся до src,
чтобы одинаково обрабатывать локальные и подписанные URL.
*/
const audio = new Audio();
audio.crossOrigin = "anonymous";
audio.preload = "auto";

const FALLBACK_COVER = "img/cover.jpg";
const FALLBACK_PLAYER_ACCENT = {
    red: 226,
    green: 173,
    blue: 255
};
const COVER_COLOR_SAMPLE_SIZE = 32;
const TRACK_FADE_OUT_DURATION_MS = 220;
const TRACK_FADE_IN_DURATION_MS = 360;
const REPEAT_MODES = [
    "off",
    "all",
    "one"
];
/* Начальная пользовательская громкость: 10% */
let userVolume = 0.1;

audio.volume = userVolume;



/* =========================================================
   2. СОСТОЯНИЕ ПЛЕЕРА
   ========================================================= */

/*
Текущий объект трека из runtime-каталога.

Теперь плеер хранит именно трек,
а не конкретную карточку на странице.
*/
let currentTrack = null;


/*
Карточка, через которую пользователь
последний раз запустил текущий трек.

Она нужна только как запасной источник
информации для мини-плеера.
*/
let currentCard = null;


/* Пользователь сейчас двигает полосу прогресса */
let isSeeking = false;


/*
Время последней throttled-записи позиции
в versioned player snapshot.
*/
let lastPositionSaveTime = -Infinity;
let pendingSnapshotSaveTimer = null;
let pendingRestoredPosition = 0;
let knownDuration = 0;
let playbackIntentId = 0;

/*
Таймер плавной смены трека.

Нужен, чтобы быстрые нажатия Next
не запускали несколько смен одновременно.
*/
let trackSwitchTimer = null;
let trackSwitchCleanupTimer = null;
let trackSwitchId = 0;
let isTrackSwitchPending = false;
let pendingTrackCatalogId = null;
let transitionGain = 1;
let volumeTransitionFrame = null;
let volumeTransitionFallbackTimer = null;
let volumeTransitionResolve = null;
let fullscreenCloseTimer = null;
let fullscreenReturnFocus = null;
let fullscreenArtistIdentity = null;
let fullscreenArtworkRequestId = 0;
let coverFloatSettleTimer = null;
let shuffleEnabled = false;
let repeatMode = "off";
let shuffleHistory = [];
let shuffleHistoryIndex = -1;
let pendingShuffleHistoryIndex = null;
let shuffleCycleIds = new Set();
let autoplayErrorAttempts = 0;
let audioErrorRecoveryPending = false;
let audioErrorRetrySwitchId = -1;
let playerAccentRequestId = 0;
const coverAccentCache = new Map();
let mediaSessionController = {
    updateMetadata() {},
    clear() {},
    syncPlaybackState() {},
    syncPosition() {}
};


/* =========================================================
   3. ЭЛЕМЕНТЫ МИНИ-ПЛЕЕРА
   ========================================================= */

let miniPlayer;
let playerCover;
let playerTitle;
let playerArtist;
let playerToggle;
let playerPrev;
let playerNext;
let playerProgress;
let playerProgressFill;
let currentTimeElement;
let durationTimeElement;
let volumeControl;
let volumeButton;
let volumeSlider;
let shuffleButtons = [];
let repeatButtons = [];


/* =========================================================
   ЭЛЕМЕНТЫ ПОЛНОЭКРАННОГО ПЛЕЕРА
   ========================================================= */

let fullscreenPlayer;
let fullscreenBackground;
let fullscreenCoverFloat;
let fullscreenCoverInteraction;
let fullscreenCover;
let fullscreenCoverNext;
let fullscreenTitle;
let fullscreenArtist;
let fullscreenDesktopCollapse;
let fullscreenToggle;
let fullscreenPrev;
let fullscreenNext;
let fullscreenProgress;
let fullscreenProgressFill;
let fullscreenCurrentTime;
let fullscreenDurationTime;
let fullscreenVolumeSlider;
let coverTiltFrame = null;
let coverPointerClientX = 0;
let coverPointerClientY = 0;


/* =========================================================
   4. ФОРМАТИРОВАНИЕ ВРЕМЕНИ
   ========================================================= */

/*
Преобразует секунды в формат:

0:07
1:24
12:05
*/
function formatTime(seconds) {
    if (!Number.isFinite(seconds)) {
        return "0:00";
    }

    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);

    return `${minutes}:${secs
        .toString()
        .padStart(2, "0")}`;
}


/* =========================================================
   5. ОЧЕРЕДЬ ВОСПРОИЗВЕДЕНИЯ
   ========================================================= */

/*
Возвращает полноценную очередь плеера.

Раньше очередь могла строиться из карточек,
поэтому один и тот же трек повторялся.

Теперь очередь строится напрямую из объединённого runtime-каталога.
*/
function getCatalogPlaybackQueue() {
    /*
    Оставляем только полноценные релизы.
    */
    const releaseTracks = getCatalogTracks().filter(
        isPlayableRelease
    );

    /*
    Убираем возможные дубли по пути к аудиофайлу.
    */
    const uniqueTracks = releaseTracks.filter(
        (track, index, trackList) => {
            return (
                trackList.findIndex((otherTrack) => {
                    return (
                        otherTrack.catalogId === track.catalogId
                    );
                }) === index
            );
        }
    );

    /*
    Самые новые треки идут первыми.

    Создаём копию массива,
    чтобы не менять исходный runtime-каталог.
    */
    return sortTracksByReleaseDate(uniqueTracks);
}


function updateFullscreenProgressAccessibility(
    position = audio.currentTime,
    duration = audio.duration
) {
    if (!fullscreenProgress) return;

    const safeDuration = Number.isFinite(duration) && duration > 0
        ? duration
        : 0;
    const safePosition = safeDuration > 0 && Number.isFinite(position)
        ? Math.min(Math.max(position, 0), safeDuration)
        : 0;

    fullscreenProgress.setAttribute(
        "aria-valuemax",
        String(Math.round(safeDuration))
    );
    fullscreenProgress.setAttribute(
        "aria-valuenow",
        String(Math.round(safePosition))
    );
    fullscreenProgress.setAttribute(
        "aria-valuetext",
        `${formatTime(safePosition)} из ${formatTime(safeDuration)}`
    );
}


function setFullscreenLoadingState(isLoading) {
    fullscreenPlayer?.setAttribute(
        "aria-busy",
        String(Boolean(isLoading))
    );
    fullscreenPlayer?.classList.toggle(
        "is-buffering",
        Boolean(isLoading)
    );
}


/* =========================================================
   6. ПОИСК ТРЕКА В ОЧЕРЕДИ
   ========================================================= */

/*
Находит трек в очереди по пути к аудиофайлу.
*/
function findTrackByAudio(audioPath) {
    return (
        getPlaybackQueue().find((track) => {
            return track.audio === audioPath;
        }) || null
    );
}


/*
Возвращает индекс текущего трека в очереди.
*/
function getCurrentTrackIndex(
    playbackQueue = getPlaybackQueue()
) {
    if (!currentTrack) return -1;

    return playbackQueue.findIndex((track) => {
        return track.catalogId === currentTrack.catalogId;
    });
}

function findTrackByCatalogId(catalogId) {
    return getCatalogTrackById(catalogId) || null;
}


/* =========================================================
   6.1. SHUFFLE И REPEAT
   ========================================================= */

function savePlaybackModes() {
    savePlayerState();
}


function getPlaybackQueue() {
    const context = getPlaybackContext();
    const queue = context.queueIds
        .map((catalogId) => getCatalogTrackById(catalogId))
        .filter((track) => track && isPlayableRelease(track));

    if (queue.length || context.type !== "catalog") return queue;
    return getCatalogPlaybackQueue();
}


function updatePlaybackModeButtons() {
    shuffleButtons.forEach((button) => {
        button.classList.toggle(
            "is-active",
            shuffleEnabled
        );

        button.setAttribute(
            "aria-pressed",
            String(shuffleEnabled)
        );

        const label = shuffleEnabled
            ? "Выключить перемешивание"
            : "Включить перемешивание";

        button.setAttribute("aria-label", label);
        button.title = shuffleEnabled
            ? "Перемешивание включено"
            : "Перемешивание выключено";
    });

    const repeatIsActive = repeatMode !== "off";
    const repeatIsOne = repeatMode === "one";

    const repeatLabel =
        repeatMode === "all"
            ? "Повтор всех треков"
            : repeatIsOne
                ? "Повтор одного трека"
                : "Повтор выключен";

    repeatButtons.forEach((button) => {
        button.classList.toggle(
            "is-active",
            repeatIsActive
        );

        button.classList.toggle(
            "is-repeat-one",
            repeatIsOne
        );

        button.dataset.repeatMode = repeatMode;

        button.setAttribute(
            "aria-pressed",
            String(repeatIsActive)
        );

        button.setAttribute(
            "aria-label",
            repeatLabel
        );

        button.title = repeatLabel;
    });
}


function resetShuffleHistory(
    initialTrack = currentTrack
) {
    shuffleHistory = initialTrack
        ? [initialTrack.catalogId]
        : [];

    shuffleHistoryIndex =
        shuffleHistory.length - 1;

    pendingShuffleHistoryIndex = null;
    shuffleCycleIds = new Set(
        initialTrack ? [initialTrack.catalogId] : []
    );
}


function recordTrackInShuffleHistory(track) {
    if (!track) return;

    if (
        pendingShuffleHistoryIndex !== null &&
        shuffleHistory[
            pendingShuffleHistoryIndex
        ] === track.catalogId
    ) {
        shuffleHistoryIndex =
            pendingShuffleHistoryIndex;

        pendingShuffleHistoryIndex = null;
        shuffleCycleIds.add(track.catalogId);
        return;
    }

    pendingShuffleHistoryIndex = null;

    if (
        shuffleHistory[
            shuffleHistoryIndex
        ] === track.catalogId
    ) {
        return;
    }

    shuffleHistory = shuffleHistory.slice(
        0,
        shuffleHistoryIndex + 1
    );

    shuffleHistory.push(track.catalogId);
    shuffleHistoryIndex =
        shuffleHistory.length - 1;
    shuffleCycleIds.add(track.catalogId);

    if (shuffleHistory.length > 100) {
        const removed = shuffleHistory.length - 100;
        shuffleHistory = shuffleHistory.slice(removed);
        shuffleHistoryIndex = Math.max(0, shuffleHistoryIndex - removed);
    }
}


function toggleShuffleMode() {
    shuffleEnabled = !shuffleEnabled;
    pendingShuffleHistoryIndex = null;
    shuffleCycleIds = new Set(currentTrack ? [currentTrack.catalogId] : []);

    savePlaybackModes();
    updatePlaybackModeButtons();
}


function cycleRepeatMode() {
    const currentModeIndex =
        REPEAT_MODES.indexOf(repeatMode);

    repeatMode = REPEAT_MODES[
        (currentModeIndex + 1) %
        REPEAT_MODES.length
    ];

    savePlaybackModes();
    updatePlaybackModeButtons();
}


function restorePlaybackModes(snapshot) {
    shuffleEnabled = snapshot.shuffle;
    repeatMode = REPEAT_MODES.includes(snapshot.repeatMode)
        ? snapshot.repeatMode
        : "off";

    updatePlaybackModeButtons();
}


function getSequentialTrack(direction, playbackQueue) {
    const catalogId = getSequentialQueueId({
        queueIds: playbackQueue.map((track) => track.catalogId),
        currentId: currentTrack?.catalogId,
        direction,
        repeatMode
    });
    return playbackQueue.find((track) => track.catalogId === catalogId) || null;
}

function getShuffledTrack(direction, playbackQueue) {
    const decision = getShuffleDecision({
        queueIds: playbackQueue.map((track) => track.catalogId),
        currentId: currentTrack?.catalogId,
        direction,
        repeatMode,
        historyIds: shuffleHistory,
        historyIndex: shuffleHistoryIndex,
        validHistoryIds: getCatalogTracks().map((track) => track.catalogId),
        cycleIds: [...shuffleCycleIds]
    });
    pendingShuffleHistoryIndex = decision.historyIndex;
    shuffleCycleIds = new Set(decision.cycleIds);
    return findTrackByCatalogId(decision.catalogId);
}

function getHistoryTrack(direction) {
    const validTracks = getCatalogPlaybackQueue();
    const decision = getHistoryDecision({
        historyIds: shuffleHistory,
        historyIndex: shuffleHistoryIndex,
        direction,
        validIds: validTracks.map((track) => track.catalogId)
    });
    pendingShuffleHistoryIndex = decision.historyIndex;
    return findTrackByCatalogId(decision.catalogId);
}

function shuffled(values) {
    const result = [...values];
    for (let index = result.length - 1; index > 0; index -= 1) {
        const target = Math.floor(Math.random() * (index + 1));
        [result[index], result[target]] = [result[target], result[index]];
    }
    return result;
}

function beginAutoplay() {
    if (getPlaybackContext().type !== "autoplay") {
        autoplayErrorAttempts = 0;
    }
    const catalog = getCatalogPlaybackQueue();
    if (!catalog.length) return null;
    const recentIds = new Set(shuffleHistory.slice(-15));
    let candidates = catalog.filter((track) => (
        track.catalogId !== currentTrack?.catalogId &&
        !recentIds.has(track.catalogId)
    ));
    if (!candidates.length) {
        candidates = catalog.filter((track) => (
            track.catalogId !== currentTrack?.catalogId
        ));
    }
    if (!candidates.length) candidates = [...catalog];
    candidates = shuffled(candidates);
    setPlaybackContext({
        type: "autoplay",
        id: `autoplay:${Date.now()}`,
        label: "Автовоспроизведение",
        queueIds: candidates.map((track) => track.catalogId)
    });
    shuffleCycleIds = new Set();
    return candidates[0] || null;
}

function getTrackForNavigation(
    direction,
    { fromError = false, reason = "manual" } = {}
) {
    pendingShuffleHistoryIndex = null;
    if (direction < 0) return getHistoryTrack(-1);

    if (shouldRepeatCurrentTrack({
        reason,
        fromError,
        repeatMode,
        currentId: currentTrack?.catalogId
    })) {
        return currentTrack;
    }

    const futureHistoryTrack = getHistoryTrack(1);
    if (futureHistoryTrack && !fromError) return futureHistoryTrack;
    pendingShuffleHistoryIndex = null;

    const playbackQueue = getPlaybackQueue();
    const targetTrack = shuffleEnabled
        ? getShuffledTrack(1, playbackQueue)
        : getSequentialTrack(1, playbackQueue);
    if (targetTrack && (!fromError || targetTrack.catalogId !== currentTrack?.catalogId)) {
        return targetTrack;
    }
    return beginAutoplay();
}


/* =========================================================
   7. РАБОТА С КАРТОЧКАМИ
   ========================================================= */

/*
Возвращает все реальные карточки страницы.

Клоны карусели сюда не попадают.
*/
function getTrackCards() {
    return Array.from(
        document.querySelectorAll(
            ".release-card:not([data-clone]), " +
            ".recommendation-card:not([data-clone])"
        )
    );
}


/*
Если пользователь нажал на клон карусели,
находим обычную карточку того же трека.
*/
function findOriginalCard(card) {
    if (!card) return null;

    /*
    Обычная карточка уже является оригиналом.
    */
    if (card.dataset.clone !== "true") {
        return card;
    }

    const catalogId = card.dataset.trackId;

    return (
        getTrackCards().find((trackCard) => {
            return (
                trackCard.dataset.trackId === catalogId
            );
        }) || card
    );
}


/*
Находит любую существующую карточку
для указанного трека.
*/
function findCardForTrack(track) {
    if (!track) return null;

    return (
        getTrackCards().find((card) => {
            return (
                card.dataset.trackId === track.catalogId
            );
        }) || null
    );
}


/* =========================================================
   8. ОТКРЫТИЕ И ЗАКРЫТИЕ БОЛЬШОГО ПЛЕЕРА
   ========================================================= */

/*
Открывает полноэкранный режим.

Музыка при этом не запускается заново,
потому что используется тот же объект audio.
*/
function openFullscreenPlayer() {
    if (!currentTrack || !fullscreenPlayer) {
        return;
    }

    window.clearTimeout(fullscreenCloseTimer);

    if (
        document.activeElement instanceof HTMLElement &&
        !fullscreenPlayer.contains(document.activeElement)
    ) {
        fullscreenReturnFocus = document.activeElement;
    } else if (!fullscreenReturnFocus) {
        fullscreenReturnFocus = playerCover;
    }

    fullscreenPlayer.classList.remove(
        "closing",
        "is-dragging"
    );

    fullscreenPlayer.style.removeProperty("transition");
    fullscreenPlayer.style.removeProperty("transform");
    fullscreenPlayer.style.removeProperty("opacity");

    fullscreenBackground?.style.removeProperty("opacity");
    fullscreenBackground?.style.removeProperty("transition");

    const fullscreenParticles =
        fullscreenPlayer.querySelector(
            ".fullscreen-particles"
        );

    fullscreenParticles?.style.removeProperty("opacity");
    fullscreenParticles?.style.removeProperty("transition");

    fullscreenPlayer.classList.add("open");

    fullscreenPlayer.setAttribute(
        "aria-hidden",
        "false"
    );

    document.body.classList.add(
        "fullscreen-player-open"
    );
    document.documentElement.classList.add(
        "fullscreen-player-open"
    );

    void promoteFullscreenArtwork();

    window.setTimeout(() => {
        if (!fullscreenPlayer.classList.contains("open")) return;

        const initialControl =
            fullscreenDesktopCollapse?.getClientRects().length
                ? fullscreenDesktopCollapse
                : fullscreenToggle;
        initialControl?.focus();
    }, 100);
}

async function promoteFullscreenArtwork() {
    const track = currentTrack;
    const requestedCover = track?.cover || FALLBACK_COVER;
    const requestId = ++fullscreenArtworkRequestId;

    if (!track || !fullscreenPlayer?.classList.contains("open")) return;

    try {
        const cover = await preloadImage(requestedCover);
        if (
            requestId !== fullscreenArtworkRequestId ||
            currentTrack?.catalogId !== track.catalogId ||
            !fullscreenPlayer.classList.contains("open")
        ) return;

        if (fullscreenCover) fullscreenCover.src = cover;
        fullscreenBackground?.style.setProperty(
            "--fullscreen-cover",
            `url("${cover}")`
        );
    } catch {
        // The already rendered compact artwork remains as the visual fallback.
    }
}


/*
Закрывает полноэкранный плеер.
*/
function closeFullscreenPlayer(fromDrag = false) {
    if (!fullscreenPlayer) return;

    /*
    Если плеер уже закрыт,
    ничего не делаем.
    */
    if (
        !fullscreenPlayer.classList.contains(
            "open"
        )
    ) {
        return;
    }

    window.clearTimeout(fullscreenCloseTimer);
    resetFullscreenCoverInteraction();
    startAudioReactionLoop();

    fullscreenPlayer.classList.remove("is-dragging");
    fullscreenPlayer.classList.add("closing");

    fullscreenPlayer.style.removeProperty("opacity");

    const fullscreenParticles =
        fullscreenPlayer.querySelector(
            ".fullscreen-particles"
        );

    if (fromDrag) {
        fullscreenPlayer.style.transition =
            "transform 300ms " +
            "cubic-bezier(0.32, 0, 0.67, 0)";

        fullscreenPlayer.style.transform =
            "translate3d(0, 100vh, 0)";

        if (fullscreenBackground) {
            fullscreenBackground.style.transition =
                "opacity 260ms ease";

            fullscreenBackground.style.opacity = "0";
        }

        if (fullscreenParticles) {
            fullscreenParticles.style.transition =
                "opacity 220ms ease";

            fullscreenParticles.style.opacity = "0";
        }
    } else {
        fullscreenPlayer.style.removeProperty(
            "transition"
        );

        fullscreenPlayer.style.removeProperty(
            "transform"
        );

        fullscreenBackground?.style.removeProperty(
            "opacity"
        );

        fullscreenBackground?.style.removeProperty(
            "transition"
        );

        fullscreenParticles?.style.removeProperty(
            "opacity"
        );

        fullscreenParticles?.style.removeProperty(
            "transition"
        );
    }

    /*
    Длительность должна совпадать
    с transition в CSS.
    */
    fullscreenCloseTimer = window.setTimeout(() => {
        fullscreenPlayer.classList.remove(
            "open",
            "closing"
        );

        fullscreenPlayer.setAttribute(
            "aria-hidden",
            "true"
        );

        document.body.classList.remove(
            "fullscreen-player-open"
        );
        document.documentElement.classList.remove(
            "fullscreen-player-open"
        );

        fullscreenPlayer.style.removeProperty(
            "transition"
        );

        fullscreenPlayer.style.removeProperty(
            "transform"
        );

        fullscreenPlayer.style.removeProperty(
            "opacity"
        );

        fullscreenBackground?.style.removeProperty(
            "opacity"
        );

        fullscreenBackground?.style.removeProperty(
            "transition"
        );

        fullscreenParticles?.style.removeProperty(
            "opacity"
        );

        fullscreenParticles?.style.removeProperty(
            "transition"
        );

        stopAudioReactionLoop();

        const returnTarget = fullscreenReturnFocus;
        fullscreenReturnFocus = null;

        if (
            returnTarget instanceof HTMLElement &&
            returnTarget.isConnected
        ) {
            returnTarget.focus();
        } else if (
            document.activeElement instanceof HTMLElement
        ) {
            document.activeElement.blur();
        }
    }, 340);
}


/* =========================================================
   9. ОБНОВЛЕНИЕ ИНФОРМАЦИИ ПЛЕЕРА
   ========================================================= */

function rgbToHsl(red, green, blue) {
    const normalizedRed = red / 255;
    const normalizedGreen = green / 255;
    const normalizedBlue = blue / 255;
    const maximum = Math.max(
        normalizedRed,
        normalizedGreen,
        normalizedBlue
    );
    const minimum = Math.min(
        normalizedRed,
        normalizedGreen,
        normalizedBlue
    );
    const lightness = (maximum + minimum) / 2;
    const difference = maximum - minimum;

    if (difference === 0) {
        return {
            hue: 0,
            saturation: 0,
            lightness
        };
    }

    const saturation =
        difference /
        (
            1 -
            Math.abs(2 * lightness - 1)
        );

    let hue;

    if (maximum === normalizedRed) {
        hue =
            (
                (
                    normalizedGreen -
                    normalizedBlue
                ) /
                difference
            ) % 6;
    } else if (maximum === normalizedGreen) {
        hue =
            (
                normalizedBlue -
                normalizedRed
            ) /
            difference +
            2;
    } else {
        hue =
            (
                normalizedRed -
                normalizedGreen
            ) /
            difference +
            4;
    }

    hue /= 6;

    if (hue < 0) {
        hue += 1;
    }

    return {
        hue,
        saturation,
        lightness
    };
}


function hslToRgb(
    hue,
    saturation,
    lightness
) {
    const chroma =
        (
            1 -
            Math.abs(2 * lightness - 1)
        ) *
        saturation;
    const hueSection = hue * 6;
    const secondary =
        chroma *
        (
            1 -
            Math.abs(
                hueSection % 2 - 1
            )
        );

    let red = 0;
    let green = 0;
    let blue = 0;

    if (hueSection < 1) {
        red = chroma;
        green = secondary;
    } else if (hueSection < 2) {
        red = secondary;
        green = chroma;
    } else if (hueSection < 3) {
        green = chroma;
        blue = secondary;
    } else if (hueSection < 4) {
        green = secondary;
        blue = chroma;
    } else if (hueSection < 5) {
        red = secondary;
        blue = chroma;
    } else {
        red = chroma;
        blue = secondary;
    }

    const match =
        lightness - chroma / 2;

    return {
        red: Math.round((red + match) * 255),
        green: Math.round((green + match) * 255),
        blue: Math.round((blue + match) * 255)
    };
}


function normalizePlayerAccent(color) {
    const hsl = rgbToHsl(
        color.red,
        color.green,
        color.blue
    );

    /*
    Серый цвет не даёт полезного оттенка.
    В этом случае безопаснее сохранить фирменный фиолетовый.
    */
    if (hsl.saturation < 0.12) {
        return {
            ...FALLBACK_PLAYER_ACCENT
        };
    }

    return hslToRgb(
        hsl.hue,
        Math.min(
            0.84,
            Math.max(
                0.56,
                hsl.saturation * 1.08
            )
        ),
        Math.min(
            0.64,
            Math.max(0.48, hsl.lightness)
        )
    );
}


function loadCoverForColor(source) {
    return new Promise((resolve, reject) => {
        const image = new Image();

        image.decoding = "async";
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = source;
    });
}


async function extractCoverAccent(source) {
    const image = await loadCoverForColor(source);
    const canvas = document.createElement("canvas");

    canvas.width = COVER_COLOR_SAMPLE_SIZE;
    canvas.height = COVER_COLOR_SAMPLE_SIZE;

    const context = canvas.getContext(
        "2d",
        {
            willReadFrequently: true
        }
    );

    if (!context) {
        throw new Error(
            "Canvas 2D context is unavailable"
        );
    }

    context.drawImage(
        image,
        0,
        0,
        canvas.width,
        canvas.height
    );

    const pixels = context.getImageData(
        0,
        0,
        canvas.width,
        canvas.height
    ).data;
    const colorBins = new Map();

    for (
        let pixelIndex = 0;
        pixelIndex < pixels.length;
        pixelIndex += 4
    ) {
        const alpha = pixels[pixelIndex + 3];

        if (alpha < 160) continue;

        const red = pixels[pixelIndex];
        const green = pixels[pixelIndex + 1];
        const blue = pixels[pixelIndex + 2];
        const hsl = rgbToHsl(
            red,
            green,
            blue
        );

        /*
        Почти чёрные, белые и серые пиксели не должны
        становиться главным свечением интерфейса.
        */
        if (
            hsl.lightness < 0.05 ||
            hsl.lightness > 0.96 ||
            hsl.saturation < 0.12
        ) {
            continue;
        }

        const hueBin =
            Math.floor(hsl.hue * 18);
        const saturationBin =
            Math.floor(hsl.saturation * 4);
        const lightnessBin =
            Math.floor(hsl.lightness * 4);
        const binKey =
            `${hueBin}:${saturationBin}:` +
            `${lightnessBin}`;
        const weight =
            0.45 + hsl.saturation;
        const colorBin =
            colorBins.get(binKey) || {
                weight: 0,
                red: 0,
                green: 0,
                blue: 0
            };

        colorBin.weight += weight;
        colorBin.red += red * weight;
        colorBin.green += green * weight;
        colorBin.blue += blue * weight;

        colorBins.set(binKey, colorBin);
    }

    const dominantBin = Array.from(
        colorBins.values()
    ).sort((firstBin, secondBin) => {
        return secondBin.weight - firstBin.weight;
    })[0];

    if (!dominantBin) {
        return {
            ...FALLBACK_PLAYER_ACCENT
        };
    }

    return normalizePlayerAccent({
        red:
            dominantBin.red /
            dominantBin.weight,
        green:
            dominantBin.green /
            dominantBin.weight,
        blue:
            dominantBin.blue /
            dominantBin.weight
    });
}


function applyPlayerAccent(color) {
    document.documentElement.style.setProperty(
        "--player-accent",
        `rgb(${color.red} ${color.green} ${color.blue})`
    );
}


async function updatePlayerAccent(
    track,
    cover
) {
    const requestId = ++playerAccentRequestId;
    const requestedCover = track?.cover;
    const coverIsFallback =
        !requestedCover ||
        (
            cover === FALLBACK_COVER &&
            requestedCover !== FALLBACK_COVER
        );

    let accent = {
        ...FALLBACK_PLAYER_ACCENT
    };

    if (!coverIsFallback) {
        if (!coverAccentCache.has(cover)) {
            coverAccentCache.set(
                cover,
                extractCoverAccent(cover)
                    .catch(() => {
                        return {
                            ...FALLBACK_PLAYER_ACCENT
                        };
                    })
            );
        }

        accent = await coverAccentCache.get(cover);
    }

    if (
        requestId !== playerAccentRequestId ||
        currentTrack?.catalogId !== track?.catalogId
    ) {
        return;
    }

    applyPlayerAccent(accent);
}

/*
Обновляет обложку, название и исполнителя.

Основные данные берутся из объекта track.
Если какого-то поля нет, используем данные карточки.
*/
function updatePlayerInformation(
    track,
    card = null,
    {
        coverSource = null,
        updateFullscreenCover = true
    } = {}
) {
    if (!track) return;

    /*
    Запасные данные берём из карточки,
    если в tracks.js какое-то поле отсутствует.
    */
    const fallbackCover =
        card?.querySelector(
            ".cover, .recommendation-cover"
        )?.src || "";

    const fallbackTitle =
        card?.querySelector(
            ".track-title, .recommendation-title"
        )?.textContent?.trim() || "Без названия";

    const fallbackArtist =
        card?.querySelector(
            ".artist-name, .recommendation-artist"
        )?.textContent?.trim() ||
        "Неизвестный исполнитель";

    /*
    Собираем готовые данные текущего трека.
    */
    const originalCover =
        track.cover ||
        fallbackCover ||
        FALLBACK_COVER;
    const compactCover = getTrackCardArtwork(originalCover).small;
    const cover = coverSource || (
        fullscreenPlayer?.classList.contains("open")
            ? originalCover
            : compactCover
    );

    const title =
        track.title || fallbackTitle;

    const artist =
        track.artist || fallbackArtist;

    updatePlayerAccent(track, cover);
    mediaSessionController.updateMetadata({
        ...track,
        title,
        artist,
        cover: originalCover
    });

    /*
    Обновляем нижний мини-плеер.
    */
    playerCover.src = compactCover;

    playerCover.alt =
        `Обложка трека ${title}`;

    playerTitle.textContent = title;
    if (track.artists?.length) {
        renderArtistLinks(playerArtist, track);
    } else {
        playerArtist.textContent = artist;
    }

    miniPlayer.classList.add("active");

    /*
    Обновляем полноэкранный плеер.
    */
    if (
        fullscreenCover &&
        updateFullscreenCover
    ) {
        fullscreenCover.src = cover;

        fullscreenCover.alt =
            `Обложка трека ${title}`;
    }

    if (fullscreenTitle) {
        fullscreenTitle.textContent = title;
    }

    if (fullscreenArtist) {
        if (track.artists?.length) {
            renderArtistLinks(fullscreenArtist, track);
        } else {
            fullscreenArtist.textContent = artist;
        }
    }

    /*
    Передаём обложку в размытый фон
    через CSS-переменную.
    */
    if (fullscreenArtistIdentity) {
        renderFullscreenArtistIdentity(
            fullscreenArtistIdentity,
            track,
            {
                onSelect: closeFullscreenPlayer
            }
        );
    }

    if (fullscreenBackground) {
        fullscreenBackground.style.setProperty(
            "--fullscreen-cover",
            `url("${cover}")`
        );
    }
}


/* =========================================================
   10. ПОДСВЕТКА ИГРАЮЩЕГО ТРЕКА
   ========================================================= */

/*
Удаляет playing у всех карточек.
*/
function clearTrackCardStateClasses() {
    document
        .querySelectorAll(
            ".release-card.current, " +
            ".release-card.playing, " +
            ".recommendation-card.current, " +
            ".recommendation-card.playing"
        )
        .forEach((card) => {
            card.classList.remove("current", "playing");
        });
}


/*
Подсвечивает все карточки текущего трека.
*/
export function syncRenderedTrackCardsWithPlayerState(root = document) {
    const selector = ".release-card, .recommendation-card";
    const cards = [];

    if (root instanceof Element && root.matches(selector)) {
        cards.push(root);
    }

    cards.push(...root.querySelectorAll(selector));

    const currentCatalogId = currentTrack?.catalogId ?? null;
    const isPlaying = Boolean(currentCatalogId) &&
        !audio.paused &&
        !audio.ended;

    cards.forEach((card) => {
        const isCurrent = Boolean(currentCatalogId) &&
            card.dataset.trackId === currentCatalogId;

        card.classList.toggle("current", isCurrent);
        card.classList.toggle("playing", isCurrent && isPlaying);
    });
}


function setPlayingState(isPlaying) {
    syncRenderedTrackCardsWithPlayerState();

    playerToggle.classList.toggle(
        "playing",
        isPlaying
    );

    fullscreenToggle?.classList.toggle(
        "playing",
        isPlaying
    );

    const toggleLabel = isPlaying
        ? "Поставить на паузу"
        : "Воспроизвести";
    playerToggle.setAttribute("aria-label", toggleLabel);
    fullscreenToggle?.setAttribute("aria-label", toggleLabel);
    mediaSessionController.syncPlaybackState(
        currentTrack ? (isPlaying ? "playing" : "paused") : "none"
    );
}

export function reconcilePlayerWithCatalog() {
    const catalogQueue = getCatalogPlaybackQueue();
    reconcilePlaybackContext(
        catalogQueue.map((track) => track.catalogId),
        catalogQueue.map((track) => track.catalogId)
    );

    if (!currentTrack) {
        return "idle";
    }

    const previousTrack = currentTrack;
    const nextTrack = getCatalogTrackById(
        previousTrack.catalogId
    );

    if (!nextTrack) {
        ++trackSwitchId;
        isTrackSwitchPending = false;
        pendingTrackCatalogId = null;
        window.clearTimeout(trackSwitchTimer);
        window.clearTimeout(trackSwitchCleanupTimer);
        cancelVolumeTransition({ restoreGain: true });

        audio.pause();
        audio.removeAttribute("src");
        audio.load();

        currentTrack = null;
        currentCard = null;
        resetShuffleHistory(null);
        clearTrackCardStateClasses();
        setPlayingState(false);
        resetPlayerProgress();
        closeFullscreenPlayer();

        miniPlayer?.classList.remove("active");
        pendingRestoredPosition = 0;
        mediaSessionController.clear();
        savePlayerState();

        return "removed";
    }

    const sourceChanged =
        previousTrack.source === "supabase"
            ? previousTrack.storageAudioPath !==
                nextTrack.storageAudioPath
            : previousTrack.audio !== nextTrack.audio;
    const wasPlaying = !audio.paused && !audio.ended;

    const canKeepCurrentSignedAudio =
        previousTrack.source === "supabase" &&
        !sourceChanged &&
        previousTrack.audio !== nextTrack.audio;

    currentTrack = canKeepCurrentSignedAudio
        ? Object.freeze({
            ...nextTrack,
            audio: previousTrack.audio,
            audioExpiresAt: previousTrack.audioExpiresAt
        })
        : nextTrack;
    currentCard = findCardForTrack(nextTrack);
    setPlaybackContextCurrent(currentTrack.catalogId);

    if (sourceChanged) {
        assignAudioSource(nextTrack, {
            preserveCurrentTime: true
        });

        if (wasPlaying) {
            void startAudio(nextTrack.catalogId);
        }
    }

    updatePlayerInformation(currentTrack, currentCard);
    setPlayingState(wasPlaying);
    savePlayerState();

    return "retained";
}


/* =========================================================
   АУДИОРЕАКТИВНОЕ СВЕЧЕНИЕ FULLSCREEN
   ========================================================= */

/*
На устройствах с ограниченными ресурсами оставляем
спокойное статичное свечение и не запускаем анализ по кадрам.
*/
function applyAudioReactionMode() {
    fullscreenPlayer?.classList.toggle(
        "audio-reactive-static",
        true
    );

    fullscreenPlayer?.style.removeProperty(
        "--audio-reactive-level"
    );

    return true;
}


function startAudioReactionLoop() {
    applyAudioReactionMode();
}


function stopAudioReactionLoop() {
    applyAudioReactionMode();
}


async function ensurePlayableTrackAudio(track) {
    const latestTrack =
        getCatalogTrackById(track?.catalogId) || track;
    const playableTrack = await resolveTrackAudio(latestTrack);
    if (playableTrack !== latestTrack) replaceCatalogTrack(playableTrack);
    return playableTrack;
}

function getLikelyNextTrackForPrefetch() {
    if (
        !currentTrack ||
        shuffleEnabled ||
        shuffleHistoryIndex < shuffleHistory.length - 1
    ) {
        return null;
    }

    return getSequentialTrack(1, getPlaybackQueue());
}

function prefetchLikelyNextAudio(expectedCatalogId) {
    window.setTimeout(() => {
        if (currentTrack?.catalogId !== expectedCatalogId) return;
        const nextTrack = getLikelyNextTrackForPrefetch();
        if (nextTrack?.source !== "supabase") return;
        void prefetchTrackAudio(nextTrack).catch(() => {});
    }, 0);
}

function assignAudioSource(
    track,
    {
        preserveCurrentTime = false
    } = {}
) {
    if (
        !track?.audio ||
        audio.getAttribute("src") === track.audio
    ) {
        return false;
    }

    const previousTime =
        preserveCurrentTime &&
        Number.isFinite(audio.currentTime)
            ? audio.currentTime
            : 0;

    audio.src = track.audio;
    audio.load();

    if (pendingRestoredPosition > 0) {
        const restoredTrackId = track.catalogId;
        const restoredSource = track.audio;
        const applyRestoredPosition = () => {
            if (
                currentTrack?.catalogId !== restoredTrackId ||
                audio.getAttribute("src") !== restoredSource ||
                !Number.isFinite(audio.duration)
            ) {
                return;
            }
            audio.currentTime = Math.min(pendingRestoredPosition, audio.duration);
            pendingRestoredPosition = 0;
            mediaSessionController.syncPosition(audio, { force: true });
        };
        if (audio.readyState >= 1) applyRestoredPosition();
        else audio.addEventListener("loadedmetadata", applyRestoredPosition, { once: true });
    }

    if (previousTime > 0) {
        audio.addEventListener(
            "loadedmetadata",
            () => {
                if (Number.isFinite(audio.duration)) {
                    audio.currentTime = Math.min(
                        previousTime,
                        audio.duration
                    );
                }
            },
            { once: true }
        );
    }

    return true;
}

function showPlaybackError() {
    const message = "Не удалось воспроизвести трек";

    setPlayingState(false);
    settleFullscreenCoverFloat();

    if (playerArtist) {
        playerArtist.textContent = message;
    }

    if (fullscreenArtist) {
        fullscreenArtist.textContent = message;
    }
}

function clearPlaybackError() {
    if (!currentTrack) return;

    if (playerArtist) {
        renderArtistLinks(playerArtist, currentTrack);
    }

    if (fullscreenArtist) {
        renderArtistLinks(fullscreenArtist, currentTrack);
    }
}


/* =========================================================
   11. ЗАПУСК АУДИО
   ========================================================= */

/*
Пытается запустить текущий аудиофайл.
*/
async function startAudio(
    expectedCatalogId = currentTrack?.catalogId,
    expectedPlaybackIntentId = playbackIntentId
) {
    const targetAudio = audio;
    setFullscreenLoadingState(true);

    try {
        const playableTrack =
            await ensurePlayableTrackAudio(currentTrack);

        if (
            !playableTrack ||
            currentTrack?.catalogId !==
                expectedCatalogId ||
            playbackIntentId !== expectedPlaybackIntentId
        ) {
            return;
        }

        if (playableTrack !== currentTrack) {
            currentTrack = playableTrack;
            assignAudioSource(playableTrack, {
                preserveCurrentTime: true
            });
        }

        applyPlaybackVolume();

        await targetAudio.play();

        if (
            targetAudio !== audio ||
            currentTrack?.catalogId !==
                expectedCatalogId ||
            playbackIntentId !== expectedPlaybackIntentId
        ) {
            return;
        }

        prefetchLikelyNextAudio(expectedCatalogId);
    } catch {
        if (
            currentTrack?.catalogId !==
                expectedCatalogId ||
            playbackIntentId !== expectedPlaybackIntentId
        ) {
            return;
        }

        cancelVolumeTransition({
            restoreGain: true
        });
        setFullscreenLoadingState(false);
        showPlaybackError();
        console.error(
            "Не удалось запустить аудио:",
            {
                catalogId:
                    currentTrack?.catalogId ?? null,
                source:
                    currentTrack?.source ?? null
            }
        );
    }
}


/* =========================================================
   12. СОХРАНЕНИЕ СОСТОЯНИЯ
   ========================================================= */

/*
Сохраняет текущий трек,
позицию воспроизведения и громкость.
*/
function savePlayerState() {
    window.clearTimeout(pendingSnapshotSaveTimer);
    pendingSnapshotSaveTimer = null;
    const context = getPlaybackContext();
    savePlayerSnapshot({
        currentTrackId: currentTrack?.catalogId ?? null,
        position: currentTrack
            ? (pendingRestoredPosition > 0
                ? pendingRestoredPosition
                : Number.isFinite(audio.currentTime)
                ? audio.currentTime
                : 0)
            : 0,
        duration: currentTrack
            ? (Number.isFinite(audio.duration) && audio.duration > 0
                ? audio.duration
                : knownDuration)
            : 0,
        volume: userVolume,
        repeatMode,
        shuffle: shuffleEnabled,
        queue: {
            ids: context.queueIds,
            currentIndex: context.currentIndex
        },
        history: {
            ids: shuffleHistory,
            index: shuffleHistoryIndex
        },
        source: {
            type: context.type,
            id: context.id,
            label: context.label
        },
        paused: audio.paused
    });
}

function schedulePlayerStateSave(delay = 250) {
    window.clearTimeout(pendingSnapshotSaveTimer);
    pendingSnapshotSaveTimer = window.setTimeout(savePlayerState, delay);
}


/*
Оба интерфейса управляют громкостью единственного Audio.
*/
function applyPlaybackVolume() {
    audio.volume = Math.min(
        Math.max(userVolume * transitionGain, 0),
        1
    );
}


function cancelVolumeTransition({
    restoreGain = false
} = {}) {
    if (volumeTransitionFrame !== null) {
        cancelAnimationFrame(volumeTransitionFrame);
        volumeTransitionFrame = null;
    }

    window.clearTimeout(volumeTransitionFallbackTimer);
    volumeTransitionFallbackTimer = null;

    const resolveTransition = volumeTransitionResolve;
    volumeTransitionResolve = null;
    resolveTransition?.(false);

    if (restoreGain) {
        transitionGain = 1;
        applyPlaybackVolume();
    }
}


function animateTransitionGain(
    targetGain,
    duration,
    expectedSwitchId
) {
    cancelVolumeTransition();

    const safeTarget = Math.min(
        Math.max(targetGain, 0),
        1
    );
    const startGain = transitionGain;

    if (duration <= 0 || startGain === safeTarget) {
        transitionGain = safeTarget;
        applyPlaybackVolume();
        return Promise.resolve(
            expectedSwitchId === trackSwitchId
        );
    }

    const startTime = performance.now();

    return new Promise((resolve) => {
        volumeTransitionResolve = resolve;

        function updateGain(now) {
            if (expectedSwitchId !== trackSwitchId) {
                volumeTransitionFrame = null;
                window.clearTimeout(
                    volumeTransitionFallbackTimer
                );
                volumeTransitionFallbackTimer = null;
                volumeTransitionResolve = null;
                resolve(false);
                return;
            }

            const progress = Math.min(
                (now - startTime) / duration,
                1
            );
            const easedProgress =
                progress * progress * (3 - 2 * progress);

            transitionGain =
                startGain +
                (safeTarget - startGain) *
                    easedProgress;
            applyPlaybackVolume();

            if (progress < 1) {
                volumeTransitionFrame =
                    requestAnimationFrame(updateGain);
                return;
            }

            volumeTransitionFrame = null;
            window.clearTimeout(
                volumeTransitionFallbackTimer
            );
            volumeTransitionFallbackTimer = null;
            volumeTransitionResolve = null;
            resolve(true);
        }

        volumeTransitionFrame =
            requestAnimationFrame(updateGain);

        /*
        Background tabs and some embedded WebViews can suspend RAF.
        The fallback completes the same transition without leaving
        track switching permanently pending.
        */
        volumeTransitionFallbackTimer =
            window.setTimeout(() => {
                if (expectedSwitchId !== trackSwitchId) {
                    cancelVolumeTransition();
                    return;
                }

                if (volumeTransitionFrame !== null) {
                    cancelAnimationFrame(
                        volumeTransitionFrame
                    );
                    volumeTransitionFrame = null;
                }

                volumeTransitionFallbackTimer = null;
                volumeTransitionResolve = null;
                transitionGain = safeTarget;
                applyPlaybackVolume();
                resolve(true);
            }, duration + 80);
    });
}

/*
Обновляет визуальное заполнение громкости.
*/
function updateVolumeVisual() {
    const volumePercent =
        `${userVolume * 100}%`;

    [
        volumeSlider,
        fullscreenVolumeSlider
    ].forEach((slider) => {
        if (!slider) return;

        slider.value = String(userVolume);

        slider.style.setProperty(
            "--volume",
            volumePercent
        );
    });
}


/*
Оба интерфейса громкости используют один обработчик
и изменяют только сохранённый уровень пользователя.
*/
function updateVolumeFromSlider(event) {
    const nextVolume =
        Number(event.currentTarget.value);

    if (!Number.isFinite(nextVolume)) return;

    userVolume = Math.min(
        Math.max(nextVolume, 0),
        1
    );

    applyPlaybackVolume();
    updateVolumeVisual();
    schedulePlayerStateSave();
}


function pausePlayback() {
    ++playbackIntentId;
    setFullscreenLoadingState(false);
    cancelVolumeTransition({
        restoreGain: true
    });
    audio.pause();
}


async function resumePlayback() {
    const intentId = ++playbackIntentId;
    await startAudio(currentTrack?.catalogId, intentId);
}


/* =========================================================
   13. ВОСПРОИЗВЕДЕНИЕ КОНКРЕТНОГО ТРЕКА
   ========================================================= */

function resetPlayerProgress() {
    knownDuration = 0;
    playerProgressFill.style.width = "0%";
    playerProgress.style.setProperty(
        "--progress",
        "0%"
    );

    currentTimeElement.textContent = "0:00";
    durationTimeElement.textContent = "0:00";

    if (fullscreenProgressFill) {
        fullscreenProgressFill.style.width = "0%";
    }

    fullscreenProgress?.style.setProperty(
        "--progress",
        "0%"
    );

    if (fullscreenCurrentTime) {
        fullscreenCurrentTime.textContent = "0:00";
    }

    if (fullscreenDurationTime) {
        fullscreenDurationTime.textContent = "0:00";
    }

    updateFullscreenProgressAccessibility(0, 0);

    lastPositionSaveTime = -Infinity;
}


/*
Запускает спокойное движение внешней карточки.
Сами изображения при этом остаются неподвижными.
*/
function startFullscreenCoverFloat() {
    if (!fullscreenPlayer || !fullscreenCoverFloat) {
        return;
    }

    window.clearTimeout(coverFloatSettleTimer);

    fullscreenCoverFloat.style.removeProperty(
        "animation"
    );

    fullscreenCoverFloat.style.removeProperty(
        "transition"
    );

    fullscreenCoverFloat.style.removeProperty(
        "transform"
    );

    fullscreenPlayer.classList.add("is-playing");
}


/*
Сохраняет текущую позицию анимации и мягко
возвращает внешнюю карточку в исходную точку.
*/
function settleFullscreenCoverFloat() {
    if (!fullscreenPlayer || !fullscreenCoverFloat) {
        fullscreenPlayer?.classList.remove(
            "is-playing"
        );

        return;
    }

    const currentTransform =
        getComputedStyle(
            fullscreenCoverFloat
        ).transform;

    fullscreenPlayer.classList.remove("is-playing");
    window.clearTimeout(coverFloatSettleTimer);

    fullscreenCoverFloat.style.animation = "none";
    fullscreenCoverFloat.style.transition = "none";
    fullscreenCoverFloat.style.transform =
        currentTransform === "none"
            ? "translateY(0)"
            : currentTransform;

    void fullscreenCoverFloat.offsetHeight;

    fullscreenCoverFloat.style.transition =
        "transform 300ms ease";

    fullscreenCoverFloat.style.transform =
        "translateY(0)";

    coverFloatSettleTimer = window.setTimeout(
        () => {
            fullscreenCoverFloat.style.removeProperty(
                "animation"
            );

            fullscreenCoverFloat.style.removeProperty(
                "transition"
            );

            fullscreenCoverFloat.style.removeProperty(
                "transform"
            );

            coverFloatSettleTimer = null;
        },
        320
    );
}


/*
Возвращает наклон и блик в нейтральное состояние.
Вызывается при уходе курсора, смене типа указателя
и закрытии fullscreen-плеера.
*/
function resetFullscreenCoverInteraction() {
    if (coverTiltFrame !== null) {
        cancelAnimationFrame(coverTiltFrame);
        coverTiltFrame = null;
    }

    if (!fullscreenCoverInteraction) {
        return;
    }

    fullscreenCoverInteraction.classList.remove(
        "is-pointer-active"
    );

    fullscreenCoverInteraction.style.setProperty(
        "--rotate-x",
        "0deg"
    );

    fullscreenCoverInteraction.style.setProperty(
        "--rotate-y",
        "0deg"
    );

    fullscreenCoverInteraction.style.setProperty(
        "--pointer-x",
        "50%"
    );

    fullscreenCoverInteraction.style.setProperty(
        "--pointer-y",
        "50%"
    );
}


/*
Подключает лёгкий наклон всей fullscreen-карточки.
Изображения не меняются: JavaScript управляет только
CSS-переменными отдельного interaction-wrapper.
*/
function initializeFullscreenCoverInteraction() {
    if (
        !fullscreenCoverInteraction ||
        fullscreenCoverInteraction.dataset
            .pointerInitialized
    ) {
        return;
    }

    fullscreenCoverInteraction.dataset.pointerInitialized =
        "true";

    const finePointerQuery = window.matchMedia(
        "(hover: hover) and (pointer: fine) " +
        "and (prefers-reduced-motion: no-preference)"
    );

    const clamp = (value, minimum, maximum) =>
        Math.min(Math.max(value, minimum), maximum);

    function updateFullscreenCoverTilt() {
        coverTiltFrame = null;

        if (
            !finePointerQuery.matches ||
            fullscreenPlayer?.classList.contains(
                "is-dragging"
            )
        ) {
            resetFullscreenCoverInteraction();
            return;
        }

        const rect =
            fullscreenCoverInteraction
                .getBoundingClientRect();

        if (rect.width === 0 || rect.height === 0) {
            resetFullscreenCoverInteraction();
            return;
        }

        const pointerX = clamp(
            (
                (
                    coverPointerClientX - rect.left
                ) / rect.width
            ) * 100,
            0,
            100
        );

        const pointerY = clamp(
            (
                (
                    coverPointerClientY - rect.top
                ) / rect.height
            ) * 100,
            0,
            100
        );

        const normalizedX = pointerX / 100 - 0.5;
        const normalizedY = pointerY / 100 - 0.5;

        const rotateX = clamp(
            normalizedY * -6,
            -3,
            3
        );

        const rotateY = clamp(
            normalizedX * 6,
            -3,
            3
        );

        fullscreenCoverInteraction.style.setProperty(
            "--rotate-x",
            `${rotateX}deg`
        );

        fullscreenCoverInteraction.style.setProperty(
            "--rotate-y",
            `${rotateY}deg`
        );

        fullscreenCoverInteraction.style.setProperty(
            "--pointer-x",
            `${pointerX}%`
        );

        fullscreenCoverInteraction.style.setProperty(
            "--pointer-y",
            `${pointerY}%`
        );
    }

    fullscreenCoverInteraction.addEventListener(
        "pointerenter",
        (event) => {
            if (
                !finePointerQuery.matches ||
                event.pointerType !== "mouse" ||
                fullscreenPlayer?.classList.contains(
                    "is-dragging"
                )
            ) {
                resetFullscreenCoverInteraction();
                return;
            }

            fullscreenCoverInteraction.classList.add(
                "is-pointer-active"
            );
        }
    );

    fullscreenCoverInteraction.addEventListener(
        "pointermove",
        (event) => {
            if (
                !finePointerQuery.matches ||
                event.pointerType !== "mouse" ||
                fullscreenPlayer?.classList.contains(
                    "is-dragging"
                )
            ) {
                resetFullscreenCoverInteraction();
                return;
            }

            coverPointerClientX = event.clientX;
            coverPointerClientY = event.clientY;

            fullscreenCoverInteraction.classList.add(
                "is-pointer-active"
            );

            if (coverTiltFrame === null) {
                coverTiltFrame = requestAnimationFrame(
                    updateFullscreenCoverTilt
                );
            }
        }
    );

    fullscreenCoverInteraction.addEventListener(
        "pointerleave",
        resetFullscreenCoverInteraction
    );

    fullscreenCoverInteraction.addEventListener(
        "pointercancel",
        resetFullscreenCoverInteraction
    );

    finePointerQuery.addEventListener(
        "change",
        ({ matches }) => {
            if (!matches) {
                resetFullscreenCoverInteraction();
            }
        }
    );
}


/*
Показывает уже загруженную обложку через верхний слой.
Идентификатор переключения не позволяет старому таймеру
завершить переход после более нового действия пользователя.
*/
function updateFullscreenCover(
    track,
    cover,
    currentSwitchId,
    applyCurrentTrack
) {
    fullscreenCoverNext.src = cover;
    fullscreenCoverNext.alt = "";
    fullscreenCoverNext.classList.add(
        "is-ready"
    );

    /*
    Фиксируем скрытое, но уже готовое состояние второго слоя.
    После этого opacity может безопасно завершить визуальную смену.
    */
    void fullscreenCoverNext.offsetWidth;

    fullscreenPlayer.classList.add(
        "track-changing"
    );

    trackSwitchTimer = window.setTimeout(
        () => {
            if (currentSwitchId !== trackSwitchId) {
                return;
            }

            applyCurrentTrack(false);

            fullscreenCoverNext.classList.add(
                "is-visible"
            );

            requestAnimationFrame(() => {
                if (
                    currentSwitchId === trackSwitchId
                ) {
                    fullscreenPlayer.classList.remove(
                        "track-changing"
                    );
                }
            });

            trackSwitchCleanupTimer =
                window.setTimeout(
                    () => {
                        if (
                            currentSwitchId !==
                            trackSwitchId
                        ) {
                            return;
                        }

                        fullscreenCover.src = cover;
                        fullscreenCover.alt =
                            `Обложка трека ${track.title}`;

                        fullscreenCoverNext.classList.remove(
                            "is-ready",
                            "is-visible"
                        );

                        trackSwitchTimer = null;
                        trackSwitchCleanupTimer = null;
                    },
                    430
                );
        },
        110
    );
}


async function playTrack(
    track,
    sourceCard = null
) {
    if (!track) return;

    track =
        getCatalogTrackById(track.catalogId) ||
        track;

    const card =
        findOriginalCard(sourceCard) ||
        findCardForTrack(track);

    const isCurrentTrack =
        currentTrack?.catalogId === track.catalogId;


    if (isCurrentTrack) {
        if (isTrackSwitchPending) return;

        currentCard = card;

        updatePlayerInformation(
            track,
            card
        );

        if (audio.paused) {
            resumePlayback();
        } else {
            pausePlayback();
        }

        return;
    }

    const requestedPlaybackIntentId = ++playbackIntentId;


    const currentSwitchId = ++trackSwitchId;
    isTrackSwitchPending = true;
    pendingTrackCatalogId = track.catalogId;
    cancelVolumeTransition({
        restoreGain: true
    });

    let cover;

    try {
        track = await ensurePlayableTrackAudio(track);
        cover = await getPreloadedCover(track);
    } catch {
        if (currentSwitchId === trackSwitchId) {
            isTrackSwitchPending = false;
            pendingTrackCatalogId = null;
            showPlaybackError();
            handleAutoplayFailure();
        }

        console.error(
            "Не удалось подготовить аудио:",
            {
                catalogId: track.catalogId,
                source: track.source
            }
        );
        return;
    }

    if (currentSwitchId !== trackSwitchId) {
        return;
    }

    const shouldFadeOut =
        Boolean(currentTrack) &&
        !audio.paused &&
        !audio.ended;

    if (shouldFadeOut) {
        const fadeCompleted =
            await animateTransitionGain(
                0,
                TRACK_FADE_OUT_DURATION_MS,
                currentSwitchId
            );

        if (!fadeCompleted) {
            return;
        }
    } else {
        transitionGain = 0;
        applyPlaybackVolume();
    }

    if (currentSwitchId !== trackSwitchId) {
        return;
    }

    window.clearTimeout(trackSwitchTimer);
    window.clearTimeout(trackSwitchCleanupTimer);

    fullscreenPlayer?.classList.remove(
        "track-changing"
    );

    fullscreenCoverNext?.classList.remove(
        "is-ready",
        "is-visible"
    );

    currentTrack = track;
    currentCard = card;
    pendingRestoredPosition = 0;
    knownDuration = 0;
    setPlaybackContextCurrent(track.catalogId);
    recordTrackInShuffleHistory(track);

    /*
    Аудиофайл начинает загружаться сразу, но play()
    вызывается только после актуальной визуальной смены.
    */
    assignAudioSource(track);
    savePlayerState();
    syncRenderedTrackCardsWithPlayerState();

    if (currentSwitchId !== trackSwitchId) {
        return;
    }

    const fullscreenIsOpen =
        Boolean(
            fullscreenPlayer?.classList.contains(
                "open"
            )
        );

    function applyCurrentTrack(
        updateFullscreenCover
    ) {
        if (currentSwitchId !== trackSwitchId) {
            return;
        }

        isTrackSwitchPending = false;
        pendingTrackCatalogId = null;

        updatePlayerInformation(
            track,
            card,
            {
                coverSource: cover,
                updateFullscreenCover
            }
        );

        resetPlayerProgress();

        knownDuration = Number.isFinite(audio.duration) && audio.duration > 0
            ? audio.duration
            : 0;
        const duration = formatTime(audio.duration);

        durationTimeElement.textContent = duration;

        if (fullscreenDurationTime) {
            fullscreenDurationTime.textContent =
                duration;
        }

        savePlayerState();

        startAudio(track.catalogId, requestedPlaybackIntentId);
    }

    if (
        !fullscreenIsOpen ||
        !fullscreenCoverNext ||
        !fullscreenCover
    ) {
        applyCurrentTrack(true);
        return;
    }

    updateFullscreenCover(
        track,
        cover,
        currentSwitchId,
        applyCurrentTrack
    );
}


/*
Запускает трек по нажатой карточке.
*/
function getCardIds(container) {
    const seen = new Set();
    return Array.from(container?.querySelectorAll(
        ".release-card:not([data-clone]), .recommendation-card:not([data-clone])"
    ) || [])
        .map((card) => card.dataset.trackId)
        .filter((id) => {
            if (!id || seen.has(id) || !getCatalogTrackById(id)) return false;
            seen.add(id);
            return true;
        });
}

function setContextFromCard(card) {
    const artistContainer = card.closest("[data-artist-tracks]");
    const myTracksContainer = card.closest("[data-my-tracks-list]");
    const searchContainer = card.closest(".search-results-list");
    const recommendationsContainer = card.closest(".recommendations-track");
    let context;

    if (artistContainer) {
        const slug = new URL(window.location.href).searchParams.get("artist") || "artist";
        context = {
            type: "artist",
            id: `artist:${slug}`,
            label: "Релизы артиста",
            queueIds: getCardIds(artistContainer)
        };
    } else if (myTracksContainer) {
        context = {
            type: "my-tracks",
            id: "my-tracks",
            label: "Мои треки",
            queueIds: getCardIds(myTracksContainer)
        };
    } else if (searchContainer) {
        const query = document.querySelector(".search-input")?.value?.trim() || "";
        context = {
            type: "search",
            id: `search:${query.toLocaleLowerCase()}`,
            label: `Поиск: ${query}`,
            queueIds: getCardIds(searchContainer)
        };
    } else if (recommendationsContainer) {
        context = {
            type: "recommendations",
            id: "recommendations",
            label: "Рекомендации",
            queueIds: getCardIds(recommendationsContainer)
        };
    } else {
        const catalog = getCatalogPlaybackQueue();
        context = {
            type: "catalog",
            id: "catalog",
            label: "Каталог",
            queueIds: catalog.map((track) => track.catalogId)
        };
    }

    context.currentIndex = context.queueIds.indexOf(card.dataset.trackId);
    setPlaybackContext(context);
}

function playCard(selectedCard) {
    setContextFromCard(selectedCard);
    const card = findOriginalCard(selectedCard);

    if (!card) return;

    const catalogId = card.dataset.trackId;

    if (!catalogId) return;

    if (
        isTrackSwitchPending &&
        pendingTrackCatalogId === catalogId
    ) {
        cancelPendingTrackSwitch();
        return;
    }

    const track = findTrackByCatalogId(catalogId);

    if (!track) {
        console.error(
            "Трек не найден в очереди:",
            catalogId
        );

        return;
    }

    pendingShuffleHistoryIndex = null;

    playTrack(track, card);
}

function cancelPendingTrackSwitch() {
    const canceledCatalogId = pendingTrackCatalogId;
    if (!isTrackSwitchPending) return null;
    ++trackSwitchId;
    isTrackSwitchPending = false;
    pendingTrackCatalogId = null;
    cancelVolumeTransition({ restoreGain: true });
    return canceledCatalogId;
}


/* =========================================================
   14. СЛЕДУЮЩИЙ ТРЕК
   ========================================================= */

function playNextTrack({ fromError = false, reason = "manual" } = {}) {
    const canceledCatalogId = cancelPendingTrackSwitch();
    if (canceledCatalogId && !shuffleEnabled) {
        const queue = getPlaybackQueue();
        const targetId = getSequentialQueueId({
            queueIds: queue.map((track) => track.catalogId),
            currentId: canceledCatalogId,
            direction: 1,
            repeatMode
        });
        const targetTrack = queue.find((track) => track.catalogId === targetId);
        if (targetTrack) {
            playTrack(targetTrack);
            return;
        }
    }

    const nextTrack =
        getTrackForNavigation(1, { fromError, reason });

    if (!nextTrack) {
        if (audio.ended) {
            setPlayingState(false);
            savePlayerState();
        }

        return;
    }

    if (nextTrack.catalogId === currentTrack?.catalogId) {
        audio.currentTime = 0;
        void resumePlayback();
        return;
    }

    playTrack(nextTrack);
}

function handleAutoplayFailure() {
    if (getPlaybackContext().type !== "autoplay") return;
    if (autoplayErrorAttempts >= 5) {
        setPlayingState(false);
        return;
    }
    autoplayErrorAttempts += 1;
    window.setTimeout(() => playNextTrack({
        fromError: true,
        reason: "error"
    }), 0);
}

function reportAudioStreamError() {
    cancelVolumeTransition({ restoreGain: true });
    showPlaybackError();
    console.error(
        "Ошибка аудиопотока:",
        {
            catalogId: currentTrack?.catalogId ?? null,
            source: currentTrack?.source ?? null,
            mediaErrorCode: audio.error?.code ?? null
        }
    );
    handleAutoplayFailure();
}

function canRetrySignedAudioError() {
    return shouldRetrySignedAudioError({
        track: currentTrack,
        errorCode: audio.error?.code,
        recoveryPending: audioErrorRecoveryPending,
        retryAlreadyUsed: audioErrorRetrySwitchId === trackSwitchId
    });
}

async function recoverSignedAudioAfterError() {
    const expectedSwitchId = trackSwitchId;
    const expectedCatalogId = currentTrack?.catalogId;
    const expectedPlaybackIntentId = playbackIntentId;
    audioErrorRecoveryPending = true;
    audioErrorRetrySwitchId = expectedSwitchId;

    try {
        const refreshedTrack = await refreshTrackAudio(currentTrack);
        if (
            expectedSwitchId !== trackSwitchId ||
            currentTrack?.catalogId !== expectedCatalogId
        ) {
            return;
        }

        replaceCatalogTrack(refreshedTrack);
        currentTrack = refreshedTrack;
        assignAudioSource(refreshedTrack, { preserveCurrentTime: true });
        await startAudio(expectedCatalogId, expectedPlaybackIntentId);
    } catch {
        if (
            expectedSwitchId === trackSwitchId &&
            currentTrack?.catalogId === expectedCatalogId
        ) {
            reportAudioStreamError();
        }
    } finally {
        audioErrorRecoveryPending = false;
    }
}


/* =========================================================
   15. ПРЕДЫДУЩИЙ ТРЕК
   ========================================================= */

function playPreviousTrack() {
    cancelPendingTrackSwitch();
    const previousTrack =
        getTrackForNavigation(-1);

    if (!previousTrack) return;

    playTrack(previousTrack);
}


/* =========================================================
   16. ПЕРЕМОТКА
   ========================================================= */

/*
Меняет позицию трека по координате указателя.
*/
function seekAudio(event) {
    if (!Number.isFinite(audio.duration)) {
        return;
    }

    const rect =
        playerProgress.getBoundingClientRect();

    let percent =
        (event.clientX - rect.left) /
        rect.width;

    percent = Math.max(
        0,
        Math.min(1, percent)
    );

    audio.currentTime =
        percent * audio.duration;
}


/*
Перемотка через полноэкранную полосу.
*/
function seekFullscreenAudio(event) {
    if (!Number.isFinite(audio.duration)) {
        return;
    }

    const rect =
        fullscreenProgress.getBoundingClientRect();

    let percent =
        (event.clientX - rect.left) /
        rect.width;

    percent = Math.max(
        0,
        Math.min(1, percent)
    );

    audio.currentTime =
        percent * audio.duration;
}


/* =========================================================
   17. ВОССТАНОВЛЕНИЕ ПЛЕЕРА
   ========================================================= */

function restorePlayerState() {
    const catalogIds = getCatalogPlaybackQueue()
        .map((track) => track.catalogId);
    const loadedSnapshot = loadPlayerSnapshot({
        resolveLegacyTrackId: (audioPath) => (
            audioPath ? findTrackByAudio(audioPath)?.catalogId : null
        )
    });
    const snapshot = reconcilePlayerSnapshot(
        loadedSnapshot,
        catalogIds,
        catalogIds
    );
    savePlayerSnapshot(snapshot);
    restorePlaybackContext(snapshot);
    restorePlaybackModes(snapshot);
    userVolume = snapshot.volume;

    applyPlaybackVolume();
    updateVolumeVisual();

    if (!snapshot.currentTrackId) {
        mediaSessionController.clear();
        return;
    }

    const savedTrackObject = findTrackByCatalogId(snapshot.currentTrackId);
    if (!savedTrackObject) return;
    const savedCard =
        findCardForTrack(savedTrackObject);

    currentTrack = savedTrackObject;
    currentCard = savedCard;
    shuffleHistory = [...snapshot.history.ids];
    shuffleHistoryIndex = snapshot.history.index;
    if (!shuffleHistory.includes(savedTrackObject.catalogId)) {
        shuffleHistory.push(savedTrackObject.catalogId);
        shuffleHistoryIndex = shuffleHistory.length - 1;
    }
    pendingShuffleHistoryIndex = null;
    shuffleCycleIds = new Set([savedTrackObject.catalogId]);
    pendingRestoredPosition = snapshot.position;
    knownDuration = snapshot.duration;

    if (savedTrackObject.source === "local") {
        assignAudioSource(savedTrackObject);
    }

    updatePlayerInformation(
        savedTrackObject,
        savedCard
    );
    syncRenderedTrackCardsWithPlayerState();
    currentTimeElement.textContent = formatTime(snapshot.position);
    durationTimeElement.textContent = formatTime(knownDuration);
    if (fullscreenCurrentTime) {
        fullscreenCurrentTime.textContent = formatTime(snapshot.position);
    }
    if (fullscreenDurationTime) {
        fullscreenDurationTime.textContent = formatTime(knownDuration);
    }
    updateFullscreenProgressAccessibility(
        snapshot.position,
        knownDuration
    );
    setPlayingState(false);
    savePlayerState();
}


/* =========================================================
   18. ЗАПУСК ПЛЕЕРА
   ========================================================= */

export function initializePlayer() {
    /* =====================================================
       ПОИСК ЭЛЕМЕНТОВ МИНИ-ПЛЕЕРА
       ===================================================== */

    miniPlayer =
        document.querySelector(".mini-player");

    playerCover =
        document.querySelector(".player-cover");

    playerTitle =
        document.querySelector(".player-title");

    playerArtist =
        document.querySelector(".player-artist");

    playerToggle =
        document.querySelector(".player-toggle");

    playerPrev =
        document.querySelector(".player-prev");

    playerNext =
        document.querySelector(".player-next");

    playerProgress =
        document.querySelector(".player-progress");

    playerProgressFill =
        document.querySelector(
            ".player-progress-fill"
        );

    currentTimeElement =
        document.querySelector(".current-time");

    durationTimeElement =
        document.querySelector(".duration-time");

    volumeControl =
        document.querySelector(".volume-control");

    volumeButton =
        document.querySelector(".volume-button");

    volumeSlider =
        document.querySelector(".volume-slider");

    shuffleButtons = Array.from(
        document.querySelectorAll(
            "[data-player-mode='shuffle']"
        )
    );

    repeatButtons = Array.from(
        document.querySelectorAll(
            "[data-player-mode='repeat']"
        )
    );


    /* =====================================================
       ПОИСК ЭЛЕМЕНТОВ БОЛЬШОГО ПЛЕЕРА
       ===================================================== */

    fullscreenPlayer =
        document.querySelector(
            ".fullscreen-player"
        );

    fullscreenBackground =
    document.querySelector(
        ".fullscreen-player-background"
    );

fullscreenCoverFloat =
    document.querySelector(
        ".fullscreen-player-cover-float"
    );

fullscreenCoverInteraction =
    document.querySelector(
        ".fullscreen-player-cover-interaction"
    );

fullscreenCover =
    document.querySelector(
        ".fullscreen-player-cover"
    );

fullscreenCoverNext =
    document.querySelector(
        ".fullscreen-player-cover-next"
    );

    fullscreenTitle =
        document.querySelector(
            ".fullscreen-player-title"
        );

    fullscreenArtist =
        document.querySelector(
            ".fullscreen-player-artist"
        );

    fullscreenArtistIdentity =
        document.querySelector(
            ".fullscreen-player-artist-identity"
        );

    fullscreenDesktopCollapse =
        document.querySelector(
            ".fullscreen-player-desktop-collapse"
        );

    fullscreenToggle =
        document.querySelector(
            ".fullscreen-player-toggle"
        );

    fullscreenPrev =
        document.querySelector(
            ".fullscreen-player-prev"
        );

    fullscreenNext =
        document.querySelector(
            ".fullscreen-player-next"
        );

    fullscreenProgress =
        document.querySelector(
            ".fullscreen-player-progress"
        );

    fullscreenProgressFill =
        document.querySelector(
            ".fullscreen-player-progress-fill"
        );

    fullscreenCurrentTime =
        document.querySelector(
            ".fullscreen-current-time"
        );

    fullscreenDurationTime =
        document.querySelector(
            ".fullscreen-duration-time"
        );

    fullscreenVolumeSlider =
        document.querySelector(
            ".fullscreen-volume-slider"
        );


    /*
    Защита от отсутствующих элементов.
    */
    if (
        !miniPlayer ||
        !playerCover ||
        !playerTitle ||
        !playerArtist ||
        !playerToggle ||
        !playerProgress ||
        !playerProgressFill ||
        !currentTimeElement ||
        !durationTimeElement ||
        !volumeControl ||
        !volumeButton ||
        !volumeSlider ||
        !fullscreenVolumeSlider ||
        shuffleButtons.length === 0 ||
        repeatButtons.length === 0
    ) {
        console.error(
            "Не найдены элементы мини-плеера"
        );

        return;
    }

    initializeFullscreenCoverInteraction();
    applyAudioReactionMode();
    mediaSessionController = createMediaSessionController({
        actions: {
            getAudio: () => audio,
            play: () => {
                if (currentTrack) void resumePlayback();
            },
            pause: () => {
                if (currentTrack || isTrackSwitchPending) pausePlayback();
            },
            next: () => {
                if (currentTrack || isTrackSwitchPending) playNextTrack();
            },
            previous: () => {
                if (currentTrack || isTrackSwitchPending) playPreviousTrack();
            }
        }
    });

    window.addEventListener(
        "playbackcontextchange",
        () => {
            pendingShuffleHistoryIndex = null;
            shuffleCycleIds = new Set(
                currentTrack ? [currentTrack.catalogId] : []
            );
        }
    );

    /* =========================================================
       DRAG-TO-CLOSE ЧЕРЕЗ POINTER EVENTS
       ========================================================= */

    if (
        fullscreenPlayer &&
        !fullscreenPlayer.dataset.swipeInitialized
    ) {
        fullscreenPlayer.dataset.swipeInitialized =
            "true";

        const fullscreenParticles =
            fullscreenPlayer.querySelector(
                ".fullscreen-particles"
            );

        const blockedDragSelector = [
            "button",
            "input",
            "a",
            "select",
            "textarea",
            "[role='button']",
            ".fullscreen-player-progress"
        ].join(", ");

        let dragPointerId = null;
        let dragStartX = 0;
        let dragStartY = 0;
        let dragStartTime = 0;
        let dragDistance = 0;
        let isDraggingFullscreen = false;
        let returnTimer = null;

        function clearDragStyles() {
            window.clearTimeout(returnTimer);

            fullscreenPlayer.classList.remove(
                "is-dragging"
            );

            fullscreenPlayer.style.removeProperty(
                "transition"
            );

            fullscreenPlayer.style.removeProperty(
                "transform"
            );

            fullscreenPlayer.style.removeProperty(
                "opacity"
            );

            fullscreenBackground?.style.removeProperty(
                "opacity"
            );

            fullscreenParticles?.style.removeProperty(
                "opacity"
            );

            fullscreenBackground?.style.removeProperty(
                "transition"
            );

            fullscreenParticles?.style.removeProperty(
                "transition"
            );
        }

        function returnFullscreenToStart() {
            fullscreenPlayer.classList.remove(
                "is-dragging"
            );

            fullscreenPlayer.style.transition =
                "transform 260ms " +
                "cubic-bezier(0.22, 1, 0.36, 1)";

            fullscreenPlayer.style.transform =
                "translate3d(0, 0, 0)";

            if (fullscreenBackground) {
                fullscreenBackground.style.transition =
                    "opacity 220ms ease";

                fullscreenBackground.style.opacity = "1";
            }

            if (fullscreenParticles) {
                fullscreenParticles.style.transition =
                    "opacity 220ms ease";

                fullscreenParticles.style.opacity = "1";
            }

            returnTimer = window.setTimeout(
                clearDragStyles,
                280
            );
        }

        function finishFullscreenDrag(event, cancelled) {
            if (event.pointerId !== dragPointerId) {
                return;
            }

            if (
                fullscreenPlayer.hasPointerCapture(
                    event.pointerId
                )
            ) {
                fullscreenPlayer.releasePointerCapture(
                    event.pointerId
                );
            }

            const elapsed = Math.max(
                performance.now() - dragStartTime,
                1
            );

            const velocity = dragDistance / elapsed;
            const distanceThreshold = Math.min(
                150,
                window.innerHeight * 0.28
            );

            const shouldClose =
                !cancelled &&
                isDraggingFullscreen &&
                (
                    dragDistance >= distanceThreshold ||
                    (
                        dragDistance > 56 &&
                        velocity > 0.65
                    )
                );

            dragPointerId = null;
            isDraggingFullscreen = false;

            if (shouldClose) {
                closeFullscreenPlayer(true);
                return;
            }

            if (dragDistance > 0) {
                returnFullscreenToStart();
            } else {
                clearDragStyles();
            }
        }

        fullscreenPlayer.addEventListener(
            "pointerdown",
            (event) => {
                if (
                    event.isPrimary === false ||
                    event.button > 0 ||
                    !fullscreenPlayer.classList.contains(
                        "open"
                    ) ||
                    event.target.closest(
                        blockedDragSelector
                    )
                ) {
                    return;
                }

                dragPointerId = event.pointerId;
                dragStartX = event.clientX;
                dragStartY = event.clientY;
                dragStartTime = performance.now();
                dragDistance = 0;
                isDraggingFullscreen = false;

                fullscreenPlayer.setPointerCapture(
                    event.pointerId
                );
            }
        );

        /*
        На мобильных fullscreen объявлен как pan-y, чтобы Safari
        не воспринимал вертикальную серию касаний как zoom.
        Для одиночного свайпа вне элементов управления передаём
        жест существующей Pointer Events логике drag-to-close.
        Прокрутку обычной страницы это не затрагивает.
        */
        fullscreenPlayer.addEventListener(
            "touchstart",
            (event) => {
                if (
                    !document.documentElement
                        .classList.contains(
                            "mobile-device"
                        ) ||
                    event.touches.length !== 1 ||
                    !fullscreenPlayer.classList.contains(
                        "open"
                    ) ||
                    event.target.closest(
                        blockedDragSelector
                    )
                ) {
                    return;
                }

                event.preventDefault();
            },
            {
                passive: false
            }
        );

        fullscreenPlayer.addEventListener(
            "pointermove",
            (event) => {
                if (event.pointerId !== dragPointerId) {
                    return;
                }

                const deltaX =
                    event.clientX - dragStartX;

                const deltaY =
                    event.clientY - dragStartY;

                if (!isDraggingFullscreen) {
                    if (
                        Math.abs(deltaX) < 8 &&
                        Math.abs(deltaY) < 8
                    ) {
                        return;
                    }

                    if (
                        deltaY <= 0 ||
                        Math.abs(deltaX) >
                            Math.abs(deltaY)
                    ) {
                        return;
                    }

                    isDraggingFullscreen = true;

                    fullscreenPlayer.classList.add(
                        "is-dragging"
                    );

                    fullscreenPlayer.style.transition =
                        "none";
                }

                event.preventDefault();

                dragDistance = Math.max(0, deltaY);

                fullscreenPlayer.style.transform =
                    `translate3d(0, ${dragDistance}px, 0)`;

                const dragProgress = Math.min(
                    dragDistance /
                        Math.max(window.innerHeight * 0.65, 320),
                    1
                );

                if (fullscreenBackground) {
                    fullscreenBackground.style.opacity =
                        String(1 - dragProgress * 0.82);
                }

                if (fullscreenParticles) {
                    fullscreenParticles.style.opacity =
                        String(1 - dragProgress);
                }
            }
        );

        fullscreenPlayer.addEventListener(
            "pointerup",
            (event) => {
                finishFullscreenDrag(event, false);
            }
        );

        fullscreenPlayer.addEventListener(
            "pointercancel",
            (event) => {
                finishFullscreenDrag(event, true);
            }
        );
    }


    /* =====================================================
       ОТКРЫТИЕ И ЗАКРЫТИЕ БОЛЬШОГО ПЛЕЕРА
       ===================================================== */

    /*
    Нажатие на маленькую обложку
    открывает большой режим.
    */
    playerCover.addEventListener(
        "click",
        (event) => {
            event.stopPropagation();

            openFullscreenPlayer();
        }
    );

    playerCover.addEventListener(
        "keydown",
        (event) => {
            if (event.key !== "Enter" && event.key !== " ") return;

            event.preventDefault();
            openFullscreenPlayer();
        }
    );

    miniPlayer.addEventListener(
        "click",
        (event) => {
            const mobileLayout =
                document.documentElement.classList.contains(
                    "mobile-device"
                ) ||
                window.matchMedia("(max-width: 560px)").matches;
            const interactiveTarget = event.target.closest?.(
                "button, input, select, textarea"
            );

            if (!mobileLayout || interactiveTarget) return;

            event.preventDefault();
            openFullscreenPlayer();
        }
    );

    fullscreenArtist?.addEventListener(
        "click",
        (event) => {
            if (!event.target.closest("[data-artist-slug]")) return;
            closeFullscreenPlayer();
        }
    );


    fullscreenDesktopCollapse?.addEventListener(
        "click",
        (event) => {
            event.stopPropagation();
            closeFullscreenPlayer();
        }
    );


    /*
    Escape тоже закрывает экран.
    */
    document.addEventListener(
        "keydown",
        (event) => {
            if (!fullscreenPlayer?.classList.contains("open")) return;

            if (event.key === "Escape") {
                event.preventDefault();
                closeFullscreenPlayer();
                return;
            }

            if (event.key !== " ") return;

            const interactiveTarget = event.target.closest?.(
                "button, input, a, select, textarea, " +
                "[role='button'], [role='slider'], [contenteditable='true']"
            );

            if (interactiveTarget || !currentTrack) return;

            event.preventDefault();

            if (audio.paused) {
                void resumePlayback();
            } else {
                pausePlayback();
            }
        }
    );


    /* =====================================================
       НАЖАТИЕ НА КАРТОЧКУ
       ===================================================== */

    document.addEventListener(
        "click",
        (event) => {
            const clickedCard =
                event.target.closest(
                    ".release-card, " +
                    ".recommendation-card"
                );

            if (!clickedCard) return;

            const interactiveTarget = event.target.closest(
                "a, button, input, select, textarea, [role='button']"
            );

            if (
                interactiveTarget &&
                clickedCard.contains(interactiveTarget)
            ) {
                return;
            }

            playCard(clickedCard);
        }
    );


    /* =====================================================
       SHUFFLE И REPEAT
       ===================================================== */

    shuffleButtons.forEach((button) => {
        button.addEventListener(
            "click",
            (event) => {
                event.stopPropagation();
                toggleShuffleMode();
            }
        );
    });

    repeatButtons.forEach((button) => {
        button.addEventListener(
            "click",
            (event) => {
                event.stopPropagation();
                cycleRepeatMode();
            }
        );
    });


    /* =====================================================
       PLAY / PAUSE
       ===================================================== */

    playerToggle.addEventListener(
        "click",
        (event) => {
            event.stopPropagation();

            if (!currentTrack) return;

            if (audio.paused) {
                resumePlayback();
            } else {
                pausePlayback();
            }
        }
    );


    fullscreenToggle?.addEventListener(
        "click",
        (event) => {
            event.stopPropagation();

            if (!currentTrack) return;

            if (audio.paused) {
                resumePlayback();
            } else {
                pausePlayback();
            }
        }
    );


    /* =====================================================
       СЛЕДУЮЩИЙ ТРЕК
       ===================================================== */

    playerNext?.addEventListener(
        "click",
        (event) => {
            event.stopPropagation();

            playNextTrack();
        }
    );


    fullscreenNext?.addEventListener(
        "click",
        (event) => {
            event.stopPropagation();

            playNextTrack();
        }
    );


    /* =====================================================
       ПРЕДЫДУЩИЙ ТРЕК
       ===================================================== */

    playerPrev?.addEventListener(
        "click",
        (event) => {
            event.stopPropagation();

            playPreviousTrack();
        }
    );


    fullscreenPrev?.addEventListener(
        "click",
        (event) => {
            event.stopPropagation();

            playPreviousTrack();
        }
    );


    /* =====================================================
       ГРОМКОСТЬ
       ===================================================== */

    let isAdjustingVolume = false;

    volumeButton.addEventListener(
        "click",
        (event) => {
            event.stopPropagation();

            const isOpen =
                volumeControl.classList.toggle(
                    "is-open"
                );

            volumeButton.setAttribute(
                "aria-expanded",
                String(isOpen)
            );
        }
    );

    volumeSlider.addEventListener(
        "pointerdown",
        (event) => {
            isAdjustingVolume = true;

            volumeSlider.setPointerCapture(
                event.pointerId
            );
        }
    );

    function finishVolumeAdjustment(event) {
        isAdjustingVolume = false;

        if (
            volumeSlider.hasPointerCapture(
                event.pointerId
            )
        ) {
            volumeSlider.releasePointerCapture(
                event.pointerId
            );
        }
    }

    volumeSlider.addEventListener(
        "pointerup",
        finishVolumeAdjustment
    );

    volumeSlider.addEventListener(
        "pointercancel",
        finishVolumeAdjustment
    );

    document.addEventListener(
        "pointerdown",
        (event) => {
            if (
                isAdjustingVolume ||
                volumeControl.contains(event.target)
            ) {
                return;
            }

            volumeControl.classList.remove("is-open");

            volumeButton.setAttribute(
                "aria-expanded",
                "false"
            );
        }
    );

    volumeSlider.addEventListener(
        "input",
        updateVolumeFromSlider
    );

    fullscreenVolumeSlider.addEventListener(
        "input",
        updateVolumeFromSlider
    );


    /* =====================================================
       ПОЛОСА ПРОГРЕССА МИНИ-ПЛЕЕРА
       ===================================================== */

    playerProgress.addEventListener(
        "pointerdown",
        (event) => {
            event.preventDefault();

            isSeeking = true;
            playerProgress.classList.add("is-seeking");

            playerProgress.setPointerCapture(
                event.pointerId
            );

            seekAudio(event);
        }
    );


    playerProgress.addEventListener(
        "pointermove",
        (event) => {
            if (!isSeeking) return;

            seekAudio(event);
        }
    );


    playerProgress.addEventListener(
        "pointerup",
        (event) => {
            isSeeking = false;
            playerProgress.classList.remove("is-seeking");

            if (
                playerProgress.hasPointerCapture(
                    event.pointerId
                )
            ) {
                playerProgress.releasePointerCapture(
                    event.pointerId
                );
            }
        }
    );


    playerProgress.addEventListener(
        "pointercancel",
        () => {
            isSeeking = false;
            playerProgress.classList.remove("is-seeking");
        }
    );


    /* =====================================================
       ПОЛОСА ПРОГРЕССА БОЛЬШОГО ПЛЕЕРА
       ===================================================== */

    fullscreenProgress?.addEventListener(
        "pointerdown",
        (event) => {
            event.preventDefault();

            isSeeking = true;
            fullscreenProgress.classList.add(
                "is-seeking"
            );

            fullscreenProgress.setPointerCapture(
                event.pointerId
            );

            seekFullscreenAudio(event);
        }
    );


    fullscreenProgress?.addEventListener(
        "pointermove",
        (event) => {
            if (!isSeeking) return;

            seekFullscreenAudio(event);
        }
    );


    fullscreenProgress?.addEventListener(
        "pointerup",
        (event) => {
            isSeeking = false;
            fullscreenProgress.classList.remove(
                "is-seeking"
            );

            if (
                fullscreenProgress.hasPointerCapture(
                    event.pointerId
                )
            ) {
                fullscreenProgress.releasePointerCapture(
                    event.pointerId
                );
            }
        }
    );


    fullscreenProgress?.addEventListener(
        "pointercancel",
        () => {
            isSeeking = false;
            fullscreenProgress.classList.remove(
                "is-seeking"
            );
        }
    );

    fullscreenProgress?.addEventListener(
        "keydown",
        (event) => {
            if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;

            let nextTime = audio.currentTime;

            if (event.key === "Home") nextTime = 0;
            else if (event.key === "End") nextTime = audio.duration;
            else if (event.key === "ArrowLeft") nextTime -= 5;
            else if (event.key === "ArrowRight") nextTime += 5;
            else return;

            event.preventDefault();
            audio.currentTime = Math.min(
                Math.max(nextTime, 0),
                audio.duration
            );
            updateFullscreenProgressAccessibility();
        }
    );


    /* =====================================================
       СОБЫТИЯ AUDIO
       ===================================================== */

    audio.addEventListener("play", () => {
        mediaSessionController.syncPlaybackState("playing");
        startAudioReactionLoop();
    });

    audio.addEventListener("playing", () => {
        autoplayErrorAttempts = 0;
        setFullscreenLoadingState(false);
        clearPlaybackError();
        setPlayingState(true);
        startFullscreenCoverFloat();

        if (transitionGain < 1) {
            void animateTransitionGain(
                1,
                TRACK_FADE_IN_DURATION_MS,
                trackSwitchId
            );
        }
    });

    audio.addEventListener("pause", () => {
        setFullscreenLoadingState(false);
        setPlayingState(false);
        savePlayerState();
        settleFullscreenCoverFloat();
        startAudioReactionLoop();
    });

    audio.addEventListener("error", () => {
        setFullscreenLoadingState(false);
        if (canRetrySignedAudioError()) {
            void recoverSignedAudioAfterError();
            return;
        }

        reportAudioStreamError();
    });


    /*
    После завершения включается следующий трек.
    */
    audio.addEventListener("ended", () => {
        playNextTrack({ reason: "ended" });
        settleFullscreenCoverFloat();
        startAudioReactionLoop();
    });


    /*
    Показываем длительность после загрузки файла.
    */
    audio.addEventListener("loadedmetadata", () => {
        knownDuration = Number.isFinite(audio.duration) && audio.duration > 0
            ? audio.duration
            : 0;
        const duration = formatTime(audio.duration);

        durationTimeElement.textContent = duration;

        if (fullscreenDurationTime) {
            fullscreenDurationTime.textContent = duration;
        }
        updateFullscreenProgressAccessibility();
        mediaSessionController.syncPosition(audio, { force: true });
        savePlayerState();
    });

    audio.addEventListener("waiting", () => {
        setFullscreenLoadingState(true);
    });

    audio.addEventListener("stalled", () => {
        setFullscreenLoadingState(true);
    });

    audio.addEventListener("canplay", () => {
        setFullscreenLoadingState(false);
    });

    audio.addEventListener("seeked", () => {
        mediaSessionController.syncPosition(audio, { force: true });
        savePlayerState();
    });


    /*
    Обновляем прогресс и текущее время.
    */
    audio.addEventListener("timeupdate", () => {
        if (!Number.isFinite(audio.duration)) {
            return;
        }

        const progress =
            (
                audio.currentTime /
                audio.duration
            ) * 100;

        playerProgressFill.style.width =
            `${progress}%`;

        playerProgress.style.setProperty(
            "--progress",
            `${progress}%`
        );

        currentTimeElement.textContent =
            formatTime(audio.currentTime);

            /*
            Обновляем большой плеер.
            */
        if (fullscreenProgressFill) {
            fullscreenProgressFill.style.width =
                `${progress}%`;
        }

        fullscreenProgress?.style.setProperty(
            "--progress",
            `${progress}%`
        );

        if (fullscreenCurrentTime) {
            fullscreenCurrentTime.textContent =
                formatTime(audio.currentTime);
        }
        updateFullscreenProgressAccessibility();
        mediaSessionController.syncPosition(audio);

        const timestamp = Date.now();
        if (timestamp - lastPositionSaveTime >= 5000) {
            lastPositionSaveTime = timestamp;
            savePlayerState();
        }
    });

    window.addEventListener("pagehide", savePlayerState);
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") savePlayerState();
    });


    /* =====================================================
       ВОССТАНОВЛЕНИЕ ПОСЛЕДНЕГО ТРЕКА
       ===================================================== */

    restorePlayerState();

}


/*
Загружает изображение до того, как оно будет
подставлено в видимые элементы интерфейса.
*/
function preloadImage(source) {
    return new Promise((resolve, reject) => {
        const image = new Image();

        image.onload = () => {
            resolve(source);
        };

        image.onerror = reject;
        image.src = source;
    });
}


/*
Возвращает рабочую обложку. Если обложка трека
недоступна, заранее загружает локальную заглушку.
*/
async function getPreloadedCover(track) {
    const originalCover = track.cover || FALLBACK_COVER;
    const requestedCover = fullscreenPlayer?.classList.contains("open")
        ? originalCover
        : getTrackCardArtwork(originalCover).small;

    try {
        return await preloadImage(requestedCover);
    } catch {
        try {
            return await preloadImage(FALLBACK_COVER);
        } catch {
            return (
                fullscreenCover?.currentSrc ||
                fullscreenCover?.src ||
                playerCover?.currentSrc ||
                playerCover?.src ||
                FALLBACK_COVER
            );
        }
    }
}
