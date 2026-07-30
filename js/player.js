import { isPlayableRelease } from "./tracks-utils.js";
import {
    activateSearchWave,
    getPlaybackContext,
    restartSearchPlaybackQueue
} from "./playback-context.js";


/* =========================================================
   1. СОЗДАНИЕ АУДИОПЛЕЕРА
   ========================================================= */

/*
Два объекта Audio по очереди меняются ролями:
один играет текущий трек, второй готовит следующий.
Во время crossfade оба объекта звучат одновременно.
*/
const primaryAudio = new Audio();
const secondaryAudio = new Audio();
const audioElements = [
    primaryAudio,
    secondaryAudio
];

audioElements.forEach((mediaElement) => {
    mediaElement.preload = "auto";
});

let audio = primaryAudio;
let standbyAudio = secondaryAudio;

const FALLBACK_COVER = "img/cover.jpg";
const FALLBACK_PLAYER_ACCENT = {
    red: 226,
    green: 173,
    blue: 255
};
const COVER_COLOR_SAMPLE_SIZE = 32;
const TRACK_CROSSFADE_DURATION = 3000;
const REPEAT_MODES = [
    "off",
    "all",
    "one"
];
const audioReactionMotionQuery = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
);


/* Начальная пользовательская громкость: 10% */
let userVolume = 0.1;

audio.volume = userVolume;
standbyAudio.volume = 0;



/* =========================================================
   2. СОСТОЯНИЕ ПЛЕЕРА
   ========================================================= */

/*
Текущий объект трека из массива tracks.

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
Последняя секунда, на которой состояние
уже сохранялось в localStorage.
*/
let lastSavedSecond = -1;

/*
Таймер плавной смены трека.

Нужен, чтобы быстрые нажатия Next
не запускали несколько смен одновременно.
*/
let trackSwitchTimer = null;
let trackSwitchCleanupTimer = null;
let trackSwitchId = 0;
let isTrackSwitchPending = false;
let fullscreenCloseTimer = null;
let coverFloatSettleTimer = null;
let audioContext = null;
let audioMediaSources = [];
let audioAnalyser = null;
let audioFrequencyData = null;
let audioReactionFrame = null;
let smoothedBassLevel = 0;
let audioReactionUnavailable = false;
let crossfadeTimer = null;
let crossfadeRequestId = 0;
let crossfadeState = null;
let isCrossfadePreparing = false;
let shuffleEnabled = false;
let repeatMode = "off";
let shuffleHistory = [];
let shuffleHistoryIndex = -1;
let pendingShuffleHistoryIndex = null;
let playerAccentRequestId = 0;
const coverAccentCache = new Map();


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
let fullscreenClose;
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

Теперь очередь строится напрямую из tracks.js.
*/
function getCatalogPlaybackQueue() {
    /*
    Оставляем только полноценные релизы.
    */
    const releaseTracks = tracks.filter(
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
                        otherTrack.audio === track.audio
                    );
                }) === index
            );
        }
    );

    /*
    Самые новые треки идут первыми.

    Создаём копию массива,
    чтобы не менять исходный tracks.
    */
    return [...uniqueTracks].sort(
        (firstTrack, secondTrack) => {
            return (
                new Date(secondTrack.releaseDate) -
                new Date(firstTrack.releaseDate)
            );
        }
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
        return track.audio === currentTrack.audio;
    });
}


/* =========================================================
   6.1. SHUFFLE И REPEAT
   ========================================================= */

function savePlaybackModes() {
    localStorage.setItem(
        "player-shuffle",
        String(shuffleEnabled)
    );

    localStorage.setItem(
        "player-repeat",
        repeatMode
    );
}


function getPlaybackQueue() {
    const context = getPlaybackContext();

    if (
        context.searchActive &&
        !context.waveActive
    ) {
        return context.searchTracks;
    }

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
        ? [initialTrack.audio]
        : [];

    shuffleHistoryIndex =
        shuffleHistory.length - 1;

    pendingShuffleHistoryIndex = null;
}


function recordTrackInShuffleHistory(track) {
    const context = getPlaybackContext();
    const shouldRecordHistory =
        shuffleEnabled ||
        context.searchActive;

    if (!shouldRecordHistory || !track) return;

    if (
        pendingShuffleHistoryIndex !== null &&
        shuffleHistory[
            pendingShuffleHistoryIndex
        ] === track.audio
    ) {
        shuffleHistoryIndex =
            pendingShuffleHistoryIndex;

        pendingShuffleHistoryIndex = null;
        return;
    }

    pendingShuffleHistoryIndex = null;

    if (
        shuffleHistory[
            shuffleHistoryIndex
        ] === track.audio
    ) {
        return;
    }

    shuffleHistory = shuffleHistory.slice(
        0,
        shuffleHistoryIndex + 1
    );

    shuffleHistory.push(track.audio);
    shuffleHistoryIndex =
        shuffleHistory.length - 1;
}


function toggleShuffleMode() {
    shuffleEnabled = !shuffleEnabled;

    const context = getPlaybackContext();

    /*
    Внутри результатов поиска история одновременно отмечает,
    какие найденные треки уже прозвучали. При переключении
    Shuffle её нельзя терять.
    */
    if (
        !context.searchActive ||
        context.waveActive
    ) {
        resetShuffleHistory();
    } else {
        pendingShuffleHistoryIndex = null;
    }

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


function restorePlaybackModes() {
    shuffleEnabled =
        localStorage.getItem(
            "player-shuffle"
        ) === "true";

    const savedRepeatMode =
        localStorage.getItem(
            "player-repeat"
        );

    repeatMode = REPEAT_MODES.includes(
        savedRepeatMode
    )
        ? savedRepeatMode
        : "off";

    updatePlaybackModeButtons();
}


function getSequentialTrack(
    direction,
    playbackQueue
) {
    const currentIndex =
        getCurrentTrackIndex(playbackQueue);

    if (currentIndex === -1) {
        return playbackQueue[0] || null;
    }

    const targetIndex =
        currentIndex + direction;

    if (
        targetIndex >= 0 &&
        targetIndex < playbackQueue.length
    ) {
        return playbackQueue[targetIndex];
    }

    if (repeatMode !== "all") {
        return null;
    }

    return direction > 0
        ? playbackQueue[0]
        : playbackQueue[
            playbackQueue.length - 1
        ];
}


function getSequentialSearchTrack(
    direction,
    playbackQueue
) {
    if (direction < 0) {
        return getSequentialTrack(
            direction,
            playbackQueue
        );
    }

    /*
    Repeat All зацикливает несколько результатов поиска.
    Один результат не повторяется: исключение сделано
    только для Repeat One выше, в getTrackForNavigation().
    */
    if (
        repeatMode === "all" &&
        playbackQueue.length > 1
    ) {
        return getSequentialTrack(
            direction,
            playbackQueue
        );
    }

    const playedAudioPaths = new Set(
        shuffleHistory
    );
    const currentIndex =
        getCurrentTrackIndex(playbackQueue);

    for (
        let offset = 1;
        offset <= playbackQueue.length;
        offset++
    ) {
        const targetIndex =
            currentIndex === -1
                ? offset - 1
                : (
                    currentIndex + offset
                ) % playbackQueue.length;
        const candidate =
            playbackQueue[targetIndex];

        if (
            candidate.audio !==
                currentTrack?.audio &&
            !playedAudioPaths.has(
                candidate.audio
            )
        ) {
            return candidate;
        }
    }

    return null;
}


function getShuffledTrack(
    direction,
    playbackQueue
) {
    const context = getPlaybackContext();
    const isSearchResultQueue =
        context.searchActive &&
        !context.waveActive;

    if (!currentTrack) {
        return playbackQueue[
            Math.floor(
                Math.random() *
                playbackQueue.length
            )
        ] || null;
    }

    if (playbackQueue.length === 1) {
        return (
            repeatMode === "all" &&
            !isSearchResultQueue
        )
            ? currentTrack
            : null;
    }

    const historyTargetIndex =
        shuffleHistoryIndex + direction;

    if (
        historyTargetIndex >= 0 &&
        historyTargetIndex <
            shuffleHistory.length
    ) {
        const historyTrack = findTrackByAudio(
            shuffleHistory[
                historyTargetIndex
            ]
        );

        if (historyTrack) {
            pendingShuffleHistoryIndex =
                historyTargetIndex;

            return historyTrack;
        }
    }

    if (direction < 0) {
        return null;
    }

    let candidates = playbackQueue.filter(
        (track) => {
            return (
                track.audio !== currentTrack.audio
            );
        }
    );

    if (isSearchResultQueue) {
        const playedAudioPaths = new Set(
            shuffleHistory
        );

        candidates = candidates.filter((track) => {
            return !playedAudioPaths.has(
                track.audio
            );
        });

        if (
            candidates.length === 0 &&
            repeatMode === "all"
        ) {
            resetShuffleHistory();

            candidates = playbackQueue.filter(
                (track) => {
                    return (
                        track.audio !==
                        currentTrack.audio
                    );
                }
            );
        }
    }

    return candidates[
        Math.floor(
            Math.random() *
            candidates.length
        )
    ] || null;
}


function getTrackForNavigation(direction) {
    pendingShuffleHistoryIndex = null;

    const context = getPlaybackContext();
    const playbackQueue = getPlaybackQueue();

    if (playbackQueue.length === 0) {
        return null;
    }

    if (
        repeatMode === "one" &&
        currentTrack
    ) {
        return currentTrack;
    }

    if (context.waveActive) {
        return getShuffledTrack(
            direction,
            playbackQueue
        );
    }

    let targetTrack;

    if (
        context.searchActive &&
        !context.waveActive
    ) {
        targetTrack = shuffleEnabled
            ? getShuffledTrack(
                direction,
                playbackQueue
            )
            : getSequentialSearchTrack(
                direction,
                playbackQueue
            );
    } else {
        targetTrack = shuffleEnabled
            ? getShuffledTrack(
                direction,
                playbackQueue
            )
            : getSequentialTrack(
                direction,
                playbackQueue
            );
    }

    if (targetTrack) {
        return targetTrack;
    }

    /*
    После последнего найденного трека начинается
    «Моя волна по запросу»: случайный трек каталога,
    отличный от текущего.
    */
    if (
        direction > 0 &&
        context.searchActive &&
        !context.waveActive &&
        playbackQueue.length > 0 &&
        activateSearchWave()
    ) {
        return getShuffledTrack(
            1,
            getCatalogPlaybackQueue()
        );
    }

    return null;
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

    const audioPath = card.dataset.audio;

    return (
        getTrackCards().find((trackCard) => {
            return (
                trackCard.dataset.audio === audioPath
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
                card.dataset.audio === track.audio
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
    initializeAudioReaction();

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
            "translate3d(0, 100dvh, 0)";

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
        currentTrack?.audio !== track?.audio
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
    const cover =
        coverSource ||
        track.cover ||
        fallbackCover ||
        FALLBACK_COVER;

    const title =
        track.title || fallbackTitle;

    const artist =
        track.artist || fallbackArtist;

    updatePlayerAccent(track, cover);

    /*
    Обновляем нижний мини-плеер.
    */
    playerCover.src = cover;

    playerCover.alt =
        `Обложка трека ${title}`;

    playerTitle.textContent = title;
    playerArtist.textContent = artist;

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
        fullscreenArtist.textContent = artist;
    }

    /*
    Передаём обложку в размытый фон
    через CSS-переменную.
    */
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
function clearPlayingClasses() {
    document
        .querySelectorAll(
            ".release-card.playing, " +
            ".recommendation-card.playing"
        )
        .forEach((card) => {
            card.classList.remove("playing");
        });
}


/*
Подсвечивает все карточки текущего трека.
*/
function setPlayingState(isPlaying) {
    clearPlayingClasses();

    if (isPlaying && currentTrack) {
        document
            .querySelectorAll(
                ".release-card, " +
                ".recommendation-card"
            )
            .forEach((card) => {
                if (
                    card.dataset.audio ===
                    currentTrack.audio
                ) {
                    card.classList.add("playing");
                }
            });
    }

    playerToggle.classList.toggle(
        "playing",
        isPlaying
    );

    fullscreenToggle?.classList.toggle(
        "playing",
        isPlaying
    );
}


/* =========================================================
   АУДИОРЕАКТИВНОЕ СВЕЧЕНИЕ FULLSCREEN
   ========================================================= */

/*
На устройствах с ограниченными ресурсами оставляем
спокойное статичное свечение и не запускаем анализ по кадрам.
*/
function shouldUseStaticAudioReaction() {
    const deviceMemory =
        Number(navigator.deviceMemory) || Infinity;

    const processorCount =
        Number(navigator.hardwareConcurrency) || Infinity;

    return (
        audioReactionUnavailable ||
        audioReactionMotionQuery.matches ||
        navigator.connection?.saveData === true ||
        deviceMemory <= 4 ||
        processorCount <= 2
    );
}


function applyAudioReactionMode() {
    const useStaticGlow =
        shouldUseStaticAudioReaction();

    fullscreenPlayer?.classList.toggle(
        "audio-reactive-static",
        useStaticGlow
    );

    if (useStaticGlow) {
        if (audioReactionFrame !== null) {
            cancelAnimationFrame(audioReactionFrame);
            audioReactionFrame = null;
        }

        smoothedBassLevel = 0;

        fullscreenPlayer?.style.removeProperty(
            "--audio-reactive-level"
        );
    }

    return useStaticGlow;
}


function setAudioReactiveLevel(level) {
    if (!fullscreenPlayer) return;

    const safeLevel =
        Math.min(Math.max(level, 0), 1);

    fullscreenPlayer.style.setProperty(
        "--audio-reactive-level",
        safeLevel.toFixed(3)
    );
}


/*
Берём только низкочастотную область примерно 30–180 Гц.
AnalyserNode уже выполняет первичное сглаживание,
а ниже добавляется отдельное плавное нарастание и спад.
*/
function readBassLevel() {
    if (
        !audioAnalyser ||
        !audioFrequencyData ||
        !audioContext
    ) {
        return 0;
    }

    audioAnalyser.getByteFrequencyData(
        audioFrequencyData
    );

    const binWidth =
        audioContext.sampleRate /
        audioAnalyser.fftSize;

    const firstBassBin = Math.max(
        1,
        Math.floor(30 / binWidth)
    );

    const lastBassBin = Math.min(
        audioFrequencyData.length - 1,
        Math.ceil(180 / binWidth)
    );

    let bassTotal = 0;
    let bassBinCount = 0;

    for (
        let index = firstBassBin;
        index <= lastBassBin;
        index++
    ) {
        bassTotal += audioFrequencyData[index];
        bassBinCount++;
    }

    if (bassBinCount === 0) return 0;

    const rawBass =
        bassTotal / bassBinCount / 255;

    const noiseFloor = 0.06;
    const normalizedBass = Math.min(
        Math.max(
            (rawBass - noiseFloor) /
            (1 - noiseFloor),
            0
        ),
        1
    );

    return Math.pow(normalizedBass, 0.78);
}


function updateAudioReaction() {
    audioReactionFrame = null;

    if (applyAudioReactionMode()) {
        return;
    }

    const fullscreenIsActive =
        fullscreenPlayer?.classList.contains("open") &&
        !fullscreenPlayer?.classList.contains("closing");

    const canReadAudio =
        fullscreenIsActive &&
        !audio.paused &&
        !audio.ended &&
        audioContext?.state === "running";

    const targetBassLevel =
        canReadAudio ? readBassLevel() : 0;

    const smoothing =
        targetBassLevel > smoothedBassLevel
            ? 0.16
            : 0.055;

    smoothedBassLevel +=
        (
            targetBassLevel -
            smoothedBassLevel
        ) * smoothing;

    if (
        targetBassLevel === 0 &&
        smoothedBassLevel < 0.002
    ) {
        smoothedBassLevel = 0;
    }

    setAudioReactiveLevel(smoothedBassLevel);

    if (canReadAudio || smoothedBassLevel > 0) {
        audioReactionFrame = requestAnimationFrame(
            updateAudioReaction
        );
    }
}


function startAudioReactionLoop() {
    if (
        applyAudioReactionMode() ||
        !audioAnalyser ||
        audioReactionFrame !== null
    ) {
        return;
    }

    audioReactionFrame = requestAnimationFrame(
        updateAudioReaction
    );
}


function stopAudioReactionLoop() {
    if (audioReactionFrame !== null) {
        cancelAnimationFrame(audioReactionFrame);
        audioReactionFrame = null;
    }

    smoothedBassLevel = 0;

    if (shouldUseStaticAudioReaction()) {
        fullscreenPlayer?.style.removeProperty(
            "--audio-reactive-level"
        );
    } else {
        setAudioReactiveLevel(0);
    }
}


/*
Контекст и оба MediaElementSource создаются только здесь
и повторно не создаются при смене src объектов Audio.
*/
function initializeAudioReaction() {
    if (
        applyAudioReactionMode() ||
        audioReactionUnavailable
    ) {
        return;
    }

    if (!audioContext) {
        const AudioContextClass =
            window.AudioContext ||
            window.webkitAudioContext;

        if (!AudioContextClass) {
            audioReactionUnavailable = true;
            applyAudioReactionMode();
            return;
        }

        try {
            audioContext = new AudioContextClass();
            audioAnalyser =
                audioContext.createAnalyser();

            audioAnalyser.fftSize = 512;
            audioAnalyser.smoothingTimeConstant = 0.82;

            audioFrequencyData = new Uint8Array(
                audioAnalyser.frequencyBinCount
            );

            audioMediaSources = audioElements.map(
                (mediaElement) => {
                    const mediaSource =
                        audioContext
                            .createMediaElementSource(
                                mediaElement
                            );

                    mediaSource.connect(audioAnalyser);
                    return mediaSource;
                }
            );

            audioAnalyser.connect(
                audioContext.destination
            );
        } catch (error) {
            audioReactionUnavailable = true;
            applyAudioReactionMode();

            console.warn(
                "Аудиореактивное свечение недоступно:",
                error
            );

            return;
        }
    }

    resumeAudioReactionContext();
    startAudioReactionLoop();
}


function resumeAudioReactionContext() {
    if (!audioContext) {
        return Promise.resolve();
    }

    if (audioContext.state !== "suspended") {
        startAudioReactionLoop();
        return Promise.resolve();
    }

    return audioContext.resume()
        .then(() => {
            startAudioReactionLoop();
        })
        .catch((error) => {
            console.warn(
                "Не удалось возобновить AudioContext:",
                error
            );
        });
}


/* =========================================================
   11. ЗАПУСК АУДИО
   ========================================================= */

/*
Пытается запустить текущий аудиофайл.
*/
async function startAudio(
    expectedAudio = currentTrack?.audio
) {
    const targetAudio = audio;

    applyPlaybackVolume();

    const audioContextResume =
        resumeAudioReactionContext();

    try {
        await targetAudio.play();

        if (
            targetAudio !== audio ||
            (
                expectedAudio &&
                targetAudio.getAttribute("src") !==
                    expectedAudio
            )
        ) {
            return;
        }

        setPlayingState(true);
        await audioContextResume;
    } catch (error) {
        console.error(
            "Не удалось запустить аудио:",
            error
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
    if (!currentTrack) return;

    localStorage.setItem(
        "player-track",
        currentTrack.audio
    );

    localStorage.setItem(
        "player-time",
        audio.currentTime
    );

    localStorage.setItem(
        "player-volume",
        userVolume
    );
}


/*
Фактическая громкость равна пользовательскому уровню,
умноженному на временную огибающую плавного перехода.
*/
function applyPlaybackVolume() {
    if (crossfadeState) {
        const angle =
            crossfadeState.progress * Math.PI / 2;

        crossfadeState.incoming.volume =
            userVolume * Math.sin(angle);

        crossfadeState.outgoing.volume =
            userVolume * Math.cos(angle);

        return;
    }

    audio.volume = userVolume;
    standbyAudio.volume = 0;
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
    savePlayerState();
}


function clearCrossfadeTimer() {
    if (crossfadeTimer === null) return;

    window.clearTimeout(crossfadeTimer);
    crossfadeTimer = null;
}


function resetStandbyAudio(
    mediaElement = standbyAudio
) {
    mediaElement.pause();
    mediaElement.removeAttribute("src");
    mediaElement.load();
    mediaElement.volume = 0;
}


function finishCrossfadeImmediately() {
    if (!crossfadeState) return;

    clearCrossfadeTimer();

    const oldAudio = crossfadeState.outgoing;

    crossfadeState = null;
    audio.volume = userVolume;

    oldAudio.pause();
    resetStandbyAudio(oldAudio);
    standbyAudio = oldAudio;
}


function cancelCrossfadePreparation() {
    if (!isCrossfadePreparing) return;

    crossfadeRequestId++;
    isCrossfadePreparing = false;
    resetStandbyAudio();
}


function updateCrossfade() {
    crossfadeTimer = null;

    if (!crossfadeState || crossfadeState.paused) {
        return;
    }

    const elapsed =
        performance.now() - crossfadeState.startedAt;

    crossfadeState.elapsed = Math.min(
        elapsed,
        TRACK_CROSSFADE_DURATION
    );

    crossfadeState.progress =
        crossfadeState.elapsed /
        TRACK_CROSSFADE_DURATION;

    applyPlaybackVolume();

    if (crossfadeState.progress >= 1) {
        finishCrossfadeImmediately();
        savePlayerState();
        return;
    }

    crossfadeTimer = window.setTimeout(
        updateCrossfade,
        32
    );
}


function prepareAudioForTrack(
    mediaElement,
    track,
    requestId
) {
    return new Promise((resolve, reject) => {
        let timeoutId = null;

        function cleanup() {
            window.clearTimeout(timeoutId);

            mediaElement.removeEventListener(
                "canplay",
                handleCanPlay
            );

            mediaElement.removeEventListener(
                "error",
                handleError
            );
        }

        function handleCanPlay() {
            cleanup();

            if (requestId !== crossfadeRequestId) {
                reject(new DOMException(
                    "Crossfade cancelled",
                    "AbortError"
                ));
                return;
            }

            resolve();
        }

        function handleError() {
            cleanup();
            reject(
                mediaElement.error ||
                new Error("Track loading failed")
            );
        }

        mediaElement.pause();
        mediaElement.volume = 0;
        mediaElement.src = track.audio;
        mediaElement.currentTime = 0;

        mediaElement.addEventListener(
            "canplay",
            handleCanPlay
        );

        mediaElement.addEventListener(
            "error",
            handleError
        );

        timeoutId = window.setTimeout(
            () => {
                cleanup();
                reject(new Error("Track loading timed out"));
            },
            10000
        );

        mediaElement.load();

        if (
            mediaElement.readyState >=
            HTMLMediaElement.HAVE_FUTURE_DATA
        ) {
            handleCanPlay();
        }
    });
}


async function startTrackCrossfade(
    track,
    sourceCard = null
) {
    if (!track || !track.audio) return;

    if (crossfadeState) {
        finishCrossfadeImmediately();
    }

    if (isCrossfadePreparing) {
        cancelCrossfadePreparation();
    }

    const outgoing = audio;
    const incoming = standbyAudio;
    const requestId = ++crossfadeRequestId;

    isCrossfadePreparing = true;

    try {
        await prepareAudioForTrack(
            incoming,
            track,
            requestId
        );

        if (
            requestId !== crossfadeRequestId ||
            !isCrossfadePreparing
        ) {
            return;
        }

        await resumeAudioReactionContext();
        await incoming.play();

        if (
            requestId !== crossfadeRequestId ||
            !isCrossfadePreparing
        ) {
            incoming.pause();
            resetStandbyAudio(incoming);
            return;
        }
    } catch (error) {
        if (requestId !== crossfadeRequestId) {
            return;
        }

        isCrossfadePreparing = false;
        pendingShuffleHistoryIndex = null;
        resetStandbyAudio(incoming);

        if (outgoing.ended) {
            setPlayingState(false);
            settleFullscreenCoverFloat();
            savePlayerState();
        }

        console.error(
            "Не удалось подготовить следующий трек:",
            error
        );

        return;
    }

    isCrossfadePreparing = false;

    audio = incoming;
    standbyAudio = outgoing;

    crossfadeState = {
        incoming,
        outgoing,
        progress: 0,
        elapsed: 0,
        startedAt: performance.now(),
        paused: false
    };

    applyPlaybackVolume();
    resetPlayerProgress();

    playTrack(
        track,
        sourceCard,
        {
            reuseAudio: true,
            startPlayback: false
        }
    );

    setPlayingState(true);
    startFullscreenCoverFloat();
    startAudioReactionLoop();
    updateCrossfade();
}


function pausePlayback() {
    if (isCrossfadePreparing) {
        cancelCrossfadePreparation();
    }

    if (crossfadeState) {
        clearCrossfadeTimer();

        crossfadeState.elapsed = Math.min(
            performance.now() -
                crossfadeState.startedAt,
            TRACK_CROSSFADE_DURATION
        );

        crossfadeState.paused = true;
        crossfadeState.incoming.pause();
        crossfadeState.outgoing.pause();
        return;
    }

    audio.pause();
}


async function resumePlayback() {
    if (!crossfadeState) {
        startAudio();
        return;
    }

    const state = crossfadeState;
    const incomingPlay = state.incoming.play();
    const outgoingPlay =
        state.outgoing.ended
            ? Promise.resolve()
            : state.outgoing.play();

    await Promise.allSettled([
        incomingPlay,
        outgoingPlay,
        resumeAudioReactionContext()
    ]);

    if (
        crossfadeState !== state
    ) {
        return;
    }

    if (state.incoming.paused) {
        state.outgoing.pause();
        state.paused = true;
        setPlayingState(false);
        settleFullscreenCoverFloat();
        return;
    }

    state.paused = false;
    state.startedAt =
        performance.now() - state.elapsed;

    setPlayingState(true);
    startFullscreenCoverFloat();
    updateCrossfade();
}


/* =========================================================
   13. ВОСПРОИЗВЕДЕНИЕ КОНКРЕТНОГО ТРЕКА
   ========================================================= */

function resetPlayerProgress() {
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

    lastSavedSecond = -1;
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
    После этого opacity может безопасно запустить crossfade.
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
    sourceCard = null,
    {
        reuseAudio = false,
        startPlayback = true
    } = {}
) {
    if (!track || !track.audio) return;

    const card =
        findOriginalCard(sourceCard) ||
        findCardForTrack(track);

    const isCurrentTrack =
        currentTrack &&
        currentTrack.audio === track.audio;


    if (isCurrentTrack && !reuseAudio) {
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


    const currentSwitchId = ++trackSwitchId;
    isTrackSwitchPending = true;

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
    recordTrackInShuffleHistory(track);

    /*
    Аудиофайл начинает загружаться сразу, но play()
    вызывается только после актуальной визуальной смены.
    */
    if (!reuseAudio) {
        audio.src = track.audio;
        audio.load();
    }

    const cover = await getPreloadedCover(track);

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

        updatePlayerInformation(
            track,
            card,
            {
                coverSource: cover,
                updateFullscreenCover
            }
        );

        if (!reuseAudio) {
            resetPlayerProgress();
        }

        const duration = formatTime(audio.duration);

        durationTimeElement.textContent = duration;

        if (fullscreenDurationTime) {
            fullscreenDurationTime.textContent =
                duration;
        }

        savePlayerState();

        if (startPlayback) {
            startAudio(track.audio);
        }
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
function playCard(selectedCard) {
    const isSearchResult =
        Boolean(
            selectedCard.closest(
                "#search-results"
            )
        );

    if (isSearchResult) {
        /*
        Клик по результату возвращает очередь из «Моей волны»
        к найденным трекам и начинает новый проход с выбранного.
        */
        restartSearchPlaybackQueue();

        /*
        Новый проход по результатам начинается именно с нажатой
        карточки. Старый текущий трек не должен считаться уже
        проигранным результатом этого прохода.
        */
        resetShuffleHistory(null);
    }

    const card = findOriginalCard(selectedCard);

    if (!card) return;

    const audioPath = card.dataset.audio;

    if (!audioPath) return;

    const track = findTrackByAudio(audioPath);

    if (!track) {
        console.error(
            "Трек не найден в очереди:",
            audioPath
        );

        return;
    }

    pendingShuffleHistoryIndex = null;

    if (
        !currentTrack ||
        currentTrack.audio === track.audio
    ) {
        playTrack(track, card);
        return;
    }

    startTrackCrossfade(track, card);
}


/* =========================================================
   14. СЛЕДУЮЩИЙ ТРЕК
   ========================================================= */

function playNextTrack(
    {
        crossfade = false
    } = {}
) {
    const nextTrack =
        getTrackForNavigation(1);

    if (!nextTrack) {
        if (audio.ended) {
            setPlayingState(false);
            savePlayerState();
        }

        return;
    }

    if (crossfade && currentTrack) {
        startTrackCrossfade(nextTrack);
        return;
    }

    playTrack(nextTrack);
}


/* =========================================================
   15. ПРЕДЫДУЩИЙ ТРЕК
   ========================================================= */

function playPreviousTrack(
    {
        crossfade = false
    } = {}
) {
    const previousTrack =
        getTrackForNavigation(-1);

    if (!previousTrack) return;

    if (crossfade && currentTrack) {
        startTrackCrossfade(previousTrack);
        return;
    }

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
    restorePlaybackModes();

    const savedTrack =
        localStorage.getItem("player-track");

    const savedTime =
        Number(
            localStorage.getItem("player-time")
        ) || 0;

    const savedVolume =
        localStorage.getItem("player-volume");

    /*
    Возвращаем сохранённую громкость.
    */
    if (savedVolume !== null) {
        const parsedVolume =
            Number(savedVolume);

        if (
            Number.isFinite(parsedVolume) &&
            parsedVolume >= 0 &&
            parsedVolume <= 1
        ) {
            userVolume = parsedVolume;
        }
    }

    applyPlaybackVolume();
    updateVolumeVisual();

    if (!savedTrack) return;

    const savedTrackObject =
        findTrackByAudio(savedTrack);

    if (!savedTrackObject) return;

    const savedCard =
        findCardForTrack(savedTrackObject);

    currentTrack = savedTrackObject;
    currentCard = savedCard;
    resetShuffleHistory();

    audio.src = savedTrackObject.audio;

    updatePlayerInformation(
        savedTrackObject,
        savedCard
    );

    /*
    После загрузки метаданных возвращаем
    сохранённую позицию.
    */
    const restoredAudio = audio;
    const restoredTrackPath =
        savedTrackObject.audio;

    restoredAudio.addEventListener(
        "loadedmetadata",
        (event) => {
            if (
                event.currentTarget !== restoredAudio ||
                currentTrack?.audio !==
                    restoredTrackPath ||
                restoredAudio.getAttribute("src") !==
                    restoredTrackPath
            ) {
                return;
            }

            if (savedTime < restoredAudio.duration) {
                restoredAudio.currentTime = savedTime;
            }
        },
        {
            once: true
        }
    );
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

    fullscreenClose =
        document.querySelector(
            ".fullscreen-player-close"
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

    window.addEventListener(
        "playbackcontextchange",
        () => {
            resetShuffleHistory();
        }
    );

    audioReactionMotionQuery.addEventListener(
        "change",
        () => {
            const useStaticGlow =
                applyAudioReactionMode();

            if (
                !useStaticGlow &&
                fullscreenPlayer?.classList.contains(
                    "open"
                )
            ) {
                initializeAudioReaction();
            }
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


    /*
    Стрелка сверху закрывает экран.
    */
    fullscreenClose?.addEventListener(
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
            if (event.key === "Escape") {
                closeFullscreenPlayer();
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

            playNextTrack({
                crossfade: true
            });
        }
    );


    fullscreenNext?.addEventListener(
        "click",
        (event) => {
            event.stopPropagation();

            playNextTrack({
                crossfade: true
            });
        }
    );


    /* =====================================================
       ПРЕДЫДУЩИЙ ТРЕК
       ===================================================== */

    playerPrev?.addEventListener(
        "click",
        (event) => {
            event.stopPropagation();

            playPreviousTrack({
                crossfade: true
            });
        }
    );


    fullscreenPrev?.addEventListener(
        "click",
        (event) => {
            event.stopPropagation();

            playPreviousTrack({
                crossfade: true
            });
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

            finishCrossfadeImmediately();
            cancelCrossfadePreparation();

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

            finishCrossfadeImmediately();
            cancelCrossfadePreparation();

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


    /* =====================================================
       СОБЫТИЯ AUDIO
       ===================================================== */

    audioElements.forEach((mediaElement) => {
        mediaElement.addEventListener(
            "play",
            (event) => {
                if (event.currentTarget !== audio) {
                    return;
                }

                setPlayingState(true);
                startFullscreenCoverFloat();
                resumeAudioReactionContext();
                startAudioReactionLoop();
            }
        );

        mediaElement.addEventListener(
            "pause",
            (event) => {
                if (event.currentTarget !== audio) {
                    return;
                }

                setPlayingState(false);

                savePlayerState();
                settleFullscreenCoverFloat();
                startAudioReactionLoop();
            }
        );
    });


    /*
    После завершения включается следующий трек.
    */
    audioElements.forEach((mediaElement) => {
        mediaElement.addEventListener(
            "ended",
            (event) => {
                if (event.currentTarget !== audio) {
                    return;
                }

                if (isCrossfadePreparing) {
                    return;
                }

                if (crossfadeState) {
                    finishCrossfadeImmediately();
                }

                playNextTrack({
                    crossfade: true
                });

                settleFullscreenCoverFloat();
                startAudioReactionLoop();
            }
        );
    });


    /*
    Показываем длительность после загрузки файла.
    */
    audioElements.forEach((mediaElement) => {
        mediaElement.addEventListener(
            "loadedmetadata",
            (event) => {
                if (event.currentTarget !== audio) {
                    return;
                }

            const duration =
                formatTime(audio.duration);

            durationTimeElement.textContent =
                duration;

            if (fullscreenDurationTime) {
                fullscreenDurationTime.textContent =
                    duration;
            }
            }
        );
    });


    /*
    Обновляем прогресс и текущее время.
    */
    audioElements.forEach((mediaElement) => {
        mediaElement.addEventListener(
            "timeupdate",
            (event) => {
                if (event.currentTarget !== audio) {
                    return;
                }

            if (
                !Number.isFinite(audio.duration)
            ) {
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

            const remainingTime =
                audio.duration - audio.currentTime;

            /*
            Запускаем единственный автоматический переход
            примерно за три секунды до конца.
            */
            if (
                remainingTime > 0 &&
                remainingTime <=
                    TRACK_CROSSFADE_DURATION / 1000 &&
                !audio.paused &&
                !isSeeking &&
                !crossfadeState &&
                !isCrossfadePreparing
            ) {
                playNextTrack({
                    crossfade: true
                });
            }

            const currentSecond =
                Math.floor(audio.currentTime);

            /*
            Сохраняем позицию каждые пять секунд.
            */
            if (
                currentSecond % 5 === 0 &&
                currentSecond !== lastSavedSecond
            ) {
                lastSavedSecond =
                    currentSecond;

                savePlayerState();
            }
            }
        );
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
    const requestedCover =
        track.cover || FALLBACK_COVER;

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
