/* =========================================================
   1. СОЗДАНИЕ АУДИОПЛЕЕРА
   ========================================================= */

/*
Создаём один общий объект Audio.

Все карточки сайта управляют именно им,
поэтому одновременно может играть только один трек.
*/
const audio = new Audio();


/* Начальная громкость: 10% */
audio.volume = 0.1;



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
let volumeSlider;


/* =========================================================
   ЭЛЕМЕНТЫ ПОЛНОЭКРАННОГО ПЛЕЕРА
   ========================================================= */

let fullscreenPlayer;
let fullscreenBackground;
let fullscreenCoverWrap;
let fullscreenCover;
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
function getPlaybackQueue() {
    /*
    Оставляем только полноценные релизы.
    */
    const releaseTracks = tracks.filter((track) => {
        return track.type === "release";
    });

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
function getCurrentTrackIndex() {
    if (!currentTrack) return -1;

    const playbackQueue = getPlaybackQueue();

    return playbackQueue.findIndex((track) => {
        return track.audio === currentTrack.audio;
    });
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

    fullscreenPlayer.classList.remove("closing");
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
function closeFullscreenPlayer() {
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

    fullscreenPlayer.classList.add("closing");

    /*
    Длительность должна совпадать
    с transition в CSS.
    */
    window.setTimeout(() => {
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
    }, 550);
}


/* =========================================================
   9. ОБНОВЛЕНИЕ ИНФОРМАЦИИ ПЛЕЕРА
   ========================================================= */

/*
Обновляет обложку, название и исполнителя.

Основные данные берутся из объекта track.
Если какого-то поля нет, используем данные карточки.
*/
function updatePlayerInformation(
    track,
    card = null
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
        track.cover || fallbackCover;

    const title =
        track.title || fallbackTitle;

    const artist =
        track.artist || fallbackArtist;

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
    if (fullscreenCover) {
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
   11. ЗАПУСК АУДИО
   ========================================================= */

/*
Пытается запустить текущий аудиофайл.
*/
async function startAudio() {
    try {
        await audio.play();

        setPlayingState(true);
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
        audio.volume
    );
}


/*
Обновляет визуальное заполнение громкости.
*/
function updateVolumeVisual() {
    if (!volumeSlider) return;

    volumeSlider.style.setProperty(
        "--volume",
        `${audio.volume * 100}%`
    );
}


/* =========================================================
   13. ВОСПРОИЗВЕДЕНИЕ КОНКРЕТНОГО ТРЕКА
   ========================================================= */

function playTrack(
    track,
    sourceCard = null
) {
    if (!track || !track.audio) return;

    const card =
        findOriginalCard(sourceCard) ||
        findCardForTrack(track);

    const isCurrentTrack =
        currentTrack &&
        currentTrack.audio === track.audio;


    /*
    Если пользователь нажал на уже выбранный трек,
    просто переключаем Play / Pause.

    Анимацию смены здесь не запускаем,
    потому что сам трек не меняется.
    */
    if (isCurrentTrack) {
        currentCard = card;

        updatePlayerInformation(
            track,
            card
        );

        if (audio.paused) {
            startAudio();
        } else {
            audio.pause();
        }

        return;
    }


    /*
    Функция, которая непосредственно
    устанавливает новый трек.
    */
    function applyNewTrack() {
        currentTrack = track;
        currentCard = card;

        audio.src = track.audio;

        /*
        Меняем обложку, название,
        исполнителя и размытый фон.
        */
        updatePlayerInformation(
            track,
            card
        );


        /*
        Сбрасываем прогресс мини-плеера.
        */
        playerProgressFill.style.width =
            "0%";

        currentTimeElement.textContent =
            "0:00";

        durationTimeElement.textContent =
            "0:00";


        /*
        Сбрасываем прогресс
        полноэкранного плеера.
        */
        if (fullscreenProgressFill) {
            fullscreenProgressFill.style.width =
                "0%";
        }

        if (fullscreenCurrentTime) {
            fullscreenCurrentTime.textContent =
                "0:00";
        }

        if (fullscreenDurationTime) {
            fullscreenDurationTime.textContent =
                "0:00";
        }

        lastSavedSecond = -1;

        startAudio();
    }


    /*
    Если большой плеер сейчас закрыт,
    незачем запускать его визуальную анимацию.
    */
    if (
        !fullscreenPlayer ||
        !fullscreenPlayer.classList.contains(
            "open"
        )
    ) {
        applyNewTrack();

        return;
    }


    /*
    Отменяем предыдущую незавершённую смену,
    если пользователь быстро нажал Next несколько раз.
    */
    if (trackSwitchTimer !== null) {
        clearTimeout(trackSwitchTimer);
    }


    /*
    Сначала старые данные растворяются.
    */
    fullscreenPlayer.classList.add(
        "track-changing"
    );


    /*
    В момент, когда элементы почти исчезли,
    подставляем новый трек.
    */
    trackSwitchTimer = window.setTimeout(
        () => {
            applyNewTrack();


            /*
            Два кадра нужны браузеру,
            чтобы он сначала увидел новые данные,
            а затем запустил их появление.
            */
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    fullscreenPlayer.classList.remove(
                        "track-changing"
                    );

                    trackSwitchTimer = null;
                });
            });
        },
        140
    );
}


/*
Запускает трек по нажатой карточке.
*/
function playCard(selectedCard) {
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

    playTrack(track, card);
}


/* =========================================================
   14. СЛЕДУЮЩИЙ ТРЕК
   ========================================================= */

function playNextTrack() {
    const playbackQueue = getPlaybackQueue();

    if (playbackQueue.length === 0) return;

    const currentIndex =
        getCurrentTrackIndex();

    const nextIndex =
        currentIndex === -1
            ? 0
            : (
                currentIndex + 1
            ) % playbackQueue.length;

    playTrack(playbackQueue[nextIndex]);
}


/* =========================================================
   15. ПРЕДЫДУЩИЙ ТРЕК
   ========================================================= */

function playPreviousTrack() {
    const playbackQueue = getPlaybackQueue();

    if (playbackQueue.length === 0) return;

    const currentIndex =
        getCurrentTrackIndex();

    const previousIndex =
        currentIndex <= 0
            ? playbackQueue.length - 1
            : currentIndex - 1;

    playTrack(
        playbackQueue[previousIndex]
    );
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
            audio.volume = parsedVolume;
        }
    }

    volumeSlider.value = audio.volume;

    updateVolumeVisual();

    if (!savedTrack) return;

    const savedTrackObject =
        findTrackByAudio(savedTrack);

    if (!savedTrackObject) return;

    const savedCard =
        findCardForTrack(savedTrackObject);

    currentTrack = savedTrackObject;
    currentCard = savedCard;

    audio.src = savedTrackObject.audio;

    updatePlayerInformation(
        savedTrackObject,
        savedCard
    );

    /*
    После загрузки метаданных возвращаем
    сохранённую позицию.
    */
    audio.addEventListener(
        "loadedmetadata",
        () => {
            if (savedTime < audio.duration) {
                audio.currentTime = savedTime;
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

    volumeSlider =
        document.querySelector(".volume-slider");


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

fullscreenCoverWrap =
    document.querySelector(
        ".fullscreen-player-cover-wrap"
    );

fullscreenCover =
    document.querySelector(
        ".fullscreen-player-cover"
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
        !volumeSlider
    ) {
        console.error(
            "Не найдены элементы мини-плеера"
        );

        return;
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
       PLAY / PAUSE
       ===================================================== */

    playerToggle.addEventListener(
        "click",
        (event) => {
            event.stopPropagation();

            if (!currentTrack) return;

            if (audio.paused) {
                startAudio();
            } else {
                audio.pause();
            }
        }
    );


    fullscreenToggle?.addEventListener(
        "click",
        (event) => {
            event.stopPropagation();

            if (!currentTrack) return;

            if (audio.paused) {
                startAudio();
            } else {
                audio.pause();
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

            /*
            Если прошло больше трёх секунд,
            возвращаем текущий трек в начало.
            */
            if (audio.currentTime > 3) {
                audio.currentTime = 0;

                return;
            }

            playPreviousTrack();
        }
    );


    fullscreenPrev?.addEventListener(
        "click",
        (event) => {
            event.stopPropagation();

            if (audio.currentTime > 3) {
                audio.currentTime = 0;

                return;
            }

            playPreviousTrack();
        }
    );


    /* =====================================================
       ГРОМКОСТЬ
       ===================================================== */

    volumeSlider.addEventListener(
        "input",
        () => {
            audio.volume =
                Number(volumeSlider.value);

            updateVolumeVisual();
            savePlayerState();
        }
    );


    /* =====================================================
       ПОЛОСА ПРОГРЕССА МИНИ-ПЛЕЕРА
       ===================================================== */

    playerProgress.addEventListener(
        "pointerdown",
        (event) => {
            isSeeking = true;

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
        () => {
            isSeeking = false;
        }
    );


    playerProgress.addEventListener(
        "pointercancel",
        () => {
            isSeeking = false;
        }
    );


    /* =====================================================
       ПОЛОСА ПРОГРЕССА БОЛЬШОГО ПЛЕЕРА
       ===================================================== */

    fullscreenProgress?.addEventListener(
        "pointerdown",
        (event) => {
            isSeeking = true;

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
        () => {
            isSeeking = false;
        }
    );


    fullscreenProgress?.addEventListener(
        "pointercancel",
        () => {
            isSeeking = false;
        }
    );


    /* =====================================================
       СОБЫТИЯ AUDIO
       ===================================================== */

    audio.addEventListener(
        "play",
        () => {
            setPlayingState(true);

            fullscreenPlayer?.classList.add(
                "is-playing"
            );
        }
    );


    audio.addEventListener(
        "pause",
        () => {
            setPlayingState(false);

            savePlayerState();

            fullscreenPlayer?.classList.remove(
                "is-playing"
            );
        }
    );


    /*
    После завершения включается следующий трек.
    */
    audio.addEventListener(
        "ended",
        () => {
            playNextTrack();

            fullscreenPlayer?.classList.remove(
                "is-playing"
            );
        }
    );


    /*
    Показываем длительность после загрузки файла.
    */
    audio.addEventListener(
        "loadedmetadata",
        () => {
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


    /*
    Обновляем прогресс и текущее время.
    */
    audio.addEventListener(
        "timeupdate",
        () => {
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

            currentTimeElement.textContent =
                formatTime(audio.currentTime);

            /*
            Обновляем большой плеер.
            */
            if (fullscreenProgressFill) {
                fullscreenProgressFill.style.width =
                    `${progress}%`;
            }

            if (fullscreenCurrentTime) {
                fullscreenCurrentTime.textContent =
                    formatTime(audio.currentTime);
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


    /* =====================================================
       ВОССТАНОВЛЕНИЕ ПОСЛЕДНЕГО ТРЕКА
       ===================================================== */

    restorePlayerState();


    /* =====================================================
   ЖИВАЯ ОБЛОЖКА ПО ВСЕМУ ЭКРАНУ
   ===================================================== */

/*
Теперь наклоняется внешняя обёртка,
а картинка внутри отдельно "дышит".
*/
if (
    fullscreenPlayer &&
    fullscreenCoverWrap
) {
    let coverAnimationFrame = null;


    /*
    Возвращает обложку
    в обычное положение.
    */
    function resetFullscreenCover() {
        if (
            coverAnimationFrame !== null
        ) {
            cancelAnimationFrame(
                coverAnimationFrame
            );

            coverAnimationFrame = null;
        }

        fullscreenCoverWrap.style.transform = `
            perspective(1200px)
            rotateX(0deg)
            rotateY(0deg)
            scale(1)
        `;

        fullscreenCoverWrap.style.setProperty(
            "--cover-light-x",
            "50%"
        );

        fullscreenCoverWrap.style.setProperty(
            "--cover-light-y",
            "35%"
        );
    }


    /*
    Движение мыши по всему
    полноэкранному плееру.
    */
    fullscreenPlayer.addEventListener(
        "mousemove",
        (event) => {
            /*
            Пока плеер закрыт,
            ничего не двигаем.
            */
            if (
                !fullscreenPlayer.classList.contains(
                    "open"
                ) ||
                fullscreenPlayer.classList.contains(
                    "closing"
                )
            ) {
                return;
            }

            /*
            Положение мыши относительно окна.

            Значения будут примерно
            от -1 до 1.
            */
            const mouseX =
                (
                    event.clientX /
                    window.innerWidth -
                    0.5
                ) * 2;

            const mouseY =
                (
                    event.clientY /
                    window.innerHeight -
                    0.5
                ) * 2;


            /*
            Ограничиваем значения.
            */
            const normalizedX =
                Math.max(
                    -1,
                    Math.min(1, mouseX)
                );

            const normalizedY =
                Math.max(
                    -1,
                    Math.min(1, mouseY)
                );


            /*
            Не создаём несколько кадров
            одновременно.
            */
            if (
                coverAnimationFrame !== null
            ) {
                cancelAnimationFrame(
                    coverAnimationFrame
                );
            }


            coverAnimationFrame =
                requestAnimationFrame(() => {
                    /*
                    Сила наклона.
                    */
                    const rotateY =
                        normalizedX * 5;

                    const rotateX =
                        normalizedY * -5;


                    /*
                    Наклоняем обёртку.
                    */
                    fullscreenCoverWrap.style.transform = `
                        perspective(1200px)
                        rotateX(${rotateX}deg)
                        rotateY(${rotateY}deg)
                        scale(1.015)
                    `;


                    /*
                    Двигаем блик вслед за мышью.
                    */
                    fullscreenCoverWrap.style.setProperty(
                        "--cover-light-x",
                        `${50 + normalizedX * 38}%`
                    );

                    fullscreenCoverWrap.style.setProperty(
                        "--cover-light-y",
                        `${50 + normalizedY * 38}%`
                    );


                    coverAnimationFrame = null;
                });
        }
    );


    /*
    При выходе мыши
    возвращаем обложку в центр.
    */
    fullscreenPlayer.addEventListener(
        "mouseleave",
        resetFullscreenCover
    );


    /*
    При закрытии кнопкой
    тоже сбрасываем наклон.
    */
    fullscreenClose?.addEventListener(
        "click",
        resetFullscreenCover
    );


    /*
    При закрытии через Escape
    тоже сбрасываем наклон.
    */
    document.addEventListener(
        "keydown",
        (event) => {
            if (event.key === "Escape") {
                resetFullscreenCover();
            }
        }
    );
}
}