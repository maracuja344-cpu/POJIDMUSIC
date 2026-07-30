import { isPlayableRelease } from "./tracks-utils.js";

let revealObserver = null;


/* =========================================================
   1. ПОЛУЧЕНИЕ И СОРТИРОВКА ТРЕКОВ
   ========================================================= */

/*
Возвращает только полноценные релизы.

В tracks.js могут находиться разные типы материалов,
поэтому здесь мы отбираем только записи:

type: "release"
*/
function getReleaseTracks() {
    return tracks.filter(isPlayableRelease);
}


/*
Создаёт копию массива и сортирует треки по дате релиза.

Самые новые треки оказываются в начале массива.

Копия [...trackList] нужна, чтобы не менять
исходный массив tracks.
*/
function sortTracksByDate(trackList) {
    return [...trackList].sort((firstTrack, secondTrack) => {
        const firstDate = new Date(firstTrack.releaseDate);
        const secondDate = new Date(secondTrack.releaseDate);

        return secondDate - firstDate;
    });
}


/*
Перемешивает копию массива случайным образом.

Используется для блока рекомендаций.
Исходный массив при этом не изменяется.
*/
function shuffleTracks(trackList) {
    const shuffledTracks = [...trackList];

    for (
        let currentIndex = shuffledTracks.length - 1;
        currentIndex > 0;
        currentIndex--
    ) {
        const randomIndex = Math.floor(
            Math.random() * (currentIndex + 1)
        );

        [
            shuffledTracks[currentIndex],
            shuffledTracks[randomIndex]
        ] = [
            shuffledTracks[randomIndex],
            shuffledTracks[currentIndex]
        ];
    }

    return shuffledTracks;
}


/* =========================================================
   2. СОЗДАНИЕ ОБЫЧНОЙ КАРТОЧКИ ТРЕКА
   ========================================================= */

/*
Создаёт HTML-элемент обычной карточки.

Эта карточка используется в разделах:

- Новинки
- Все треки
- Результаты поиска
*/
export function createTrackCard(track) {
    const card = document.createElement("div");

    /*
    CSS использует этот класс для оформления карточки.
    */
    card.className = "release-card reveal-item";

    /*
    data-audio хранит путь к аудиофайлу.

    В HTML это будет выглядеть примерно так:

    <div
        class="release-card"
        data-audio="music/song.mp3"
    >
    */
    card.dataset.audio = track.audio;

    /*
    Внутреннее содержимое карточки.
    Данные берутся из объекта track в tracks.js.
    */
    card.innerHTML = `
        <div class="cover-wrap">
            <img
                class="cover"
                src="${track.cover}"
                alt="Обложка трека ${track.title}"
            >

            <div
                class="play-state"
                aria-hidden="true"
            >
                ❚❚
            </div>
        </div>

        <div class="release-info">
            <h2 class="track-title">
                ${track.title}
            </h2>

            <p class="artist-name">
                ${track.artist}
            </p>
        </div>
    `;

    return card;
}


/* =========================================================
   3. СОЗДАНИЕ КАРТОЧКИ РЕКОМЕНДАЦИИ
   ========================================================= */

/*
Рекомендации используют отдельную форму карточки:

- большая квадратная обложка;
- текст под изображением;
- горизонтальная карусель.
*/
export function createRecommendationCard(track) {
    const card = document.createElement("div");

    card.className = "recommendation-card";
    card.dataset.audio = track.audio;

    card.innerHTML = `
        <img
            class="recommendation-cover cover"
            src="${track.cover}"
            alt="Обложка трека ${track.title}"
        >

        <div class="recommendation-info">
            <div class="recommendation-title track-title">
                ${track.title}
            </div>

            <div class="recommendation-artist artist-name">
                ${track.artist}
            </div>
        </div>
    `;

    return card;
}


/* =========================================================
   4. УНИВЕРСАЛЬНЫЙ РЕНДЕР КАРТОЧЕК
   ========================================================= */

/*
Общая функция, которая вставляет карточки в контейнер.

Она нужна, чтобы не повторять одинаковый код
в Новинках, Всех треках и Рекомендациях.

Параметры:

container
    HTML-контейнер, куда добавляются карточки.

trackList
    Массив треков, которые нужно показать.

createCard
    Функция, создающая нужный тип карточки.
*/
function renderCards(
    container,
    trackList,
    createCard
) {
    if (!container) return;

    container
        .querySelectorAll(".reveal-item")
        .forEach((element) => {
            revealObserver?.unobserve(element);
        });

    /*
    Очищаем старое содержимое перед новым рендером.
    Это защищает от появления дублей.
    */
    container.innerHTML = "";

    trackList.forEach((track) => {
        const card = createCard(track);

        container.append(card);
    });
}


/* =========================================================
   5. РЕНДЕР НОВИНОК
   ========================================================= */

/*
Показывает четыре самых новых релиза.
*/
export function renderNewTracks() {
    const container = document.querySelector(
        "#new .tracks-row"
    );

    const newestTracks = sortTracksByDate(
        getReleaseTracks()
    ).slice(0, 4);

    renderCards(
        container,
        newestTracks,
        createTrackCard
    );
}


/* =========================================================
   6. РЕНДЕР ВСЕХ ТРЕКОВ
   ========================================================= */

/*
Показывает все релизы, начиная с самого нового.
*/
export function renderAllTracks() {
    const container = document.querySelector(
        "#all-tracks .tracks-row"
    );

    const allReleaseTracks = sortTracksByDate(
        getReleaseTracks()
    );

    renderCards(
        container,
        allReleaseTracks,
        createTrackCard
    );
}


/* =========================================================
   7. РЕНДЕР РЕКОМЕНДАЦИЙ
   ========================================================= */

/*
Выбирает до шести случайных релизов.

При каждом обновлении страницы порядок рекомендаций
может измениться.
*/
export function renderRecommendations() {
    const container = document.querySelector(
        "#recommendations .recommendations-track"
    );

    const recommendedTracks = shuffleTracks(
        getReleaseTracks()
    ).slice(0, 6);

    renderCards(
        container,
        recommendedTracks,
        createRecommendationCard
    );
}


/* =========================================================
   8. АНИМАЦИЯ ПОЯВЛЕНИЯ КАРТОЧЕК
   ========================================================= */

/*
Один общий observer показывает карточки по мере входа
в viewport и отдельно наблюдает секцию рекомендаций.
*/
export function observeRevealElement(element) {
    if (!element || element.classList.contains("is-visible")) {
        return;
    }

    if (!("IntersectionObserver" in window)) {
        element.classList.add("is-visible");
        return;
    }

    revealObserver?.observe(element);
}

export function unobserveRevealElement(element) {
    revealObserver?.unobserve(element);
}

export function initializeCardAnimations() {
    if (
        "IntersectionObserver" in window &&
        revealObserver === null
    ) {
        revealObserver = new IntersectionObserver(
            (entries, observer) => {
                entries.forEach((entry) => {
                    if (!entry.isIntersecting) return;

                    entry.target.classList.add(
                        "is-visible"
                    );

                    entry.target.dispatchEvent(
                        new CustomEvent(
                            "revealvisible"
                        )
                    );

                    observer.unobserve(entry.target);
                });
            },
            {
                threshold: 0.12,
                rootMargin: "0px 0px -40px 0px"
            }
        );
    }

    document
        .querySelectorAll(
            ".release-card.reveal-item, " +
            ".recommendations-section.reveal-section"
        )
        .forEach(observeRevealElement);
}
