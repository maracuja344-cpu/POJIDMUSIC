import { isPlayableRelease } from "./tracks-utils.js";
import { isMobileDevice } from "./mobile.js";
import {
    getCatalogTracks,
    sortTracksByReleaseDate
} from "./catalog-state.js";
import {
    renderArtistActionMenu,
    renderArtistLinks
} from "./artist-utils.js";
import { syncRenderedTrackCardsWithPlayerState } from "./player.js";
import { configureTrackArtworkImage } from "./artwork.js";

let revealObserver = null;
const REVEAL_FALLBACK_DELAY = 1400;

function revealElement(element) {
    if (
        !element ||
        element.classList.contains("is-visible")
    ) {
        return;
    }

    element.classList.add("is-visible");
    element.dispatchEvent(
        new CustomEvent("revealvisible")
    );
}


/* =========================================================
   1. ПОЛУЧЕНИЕ И СОРТИРОВКА ТРЕКОВ
   ========================================================= */

/*
Возвращает только полноценные релизы.

В runtime-каталоге могут находиться разные типы материалов,
поэтому здесь мы отбираем только записи:

type: "release"
*/
function getReleaseTracks() {
    return getCatalogTracks().filter(isPlayableRelease);
}


/*
Создаёт копию массива и сортирует треки по дате релиза.

Самые новые треки оказываются в начале массива.

Копия [...trackList] нужна, чтобы не менять
исходный runtime-каталог.
*/
function sortTracksByDate(trackList) {
    return sortTracksByReleaseDate(trackList);
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
export function createTrackCard(
    track,
    {
        loading = "lazy",
        showArtistAction = false
    } = {}
) {
    const card = document.createElement("div");

    /*
    CSS использует этот класс для оформления карточки.
    */
    card.className = "release-card reveal-item";

    card.dataset.trackId = track.catalogId;

    const coverWrap = document.createElement("div");
    coverWrap.className = "cover-wrap";

    const cover = document.createElement("img");
    cover.className = "cover";
    configureTrackArtworkImage(cover, track.cover, { loading });
    cover.alt = `Обложка трека ${track.title}`;

    const playState = document.createElement("div");
    playState.className = "play-state";
    playState.setAttribute("aria-hidden", "true");
    playState.textContent = "❚❚";

    const info = document.createElement("div");
    info.className = "release-info";

    const title = document.createElement("h2");
    title.className = "track-title";
    title.textContent = track.title;

    const artist = document.createElement("p");
    artist.className = "artist-name";
    renderArtistLinks(artist, track);

    coverWrap.append(cover, playState);
    info.append(title, artist);
    card.append(coverWrap, info);

    if (showArtistAction) {
        const artistActions = document.createElement("div");
        renderArtistActionMenu(artistActions, track);
        card.append(artistActions);
    }

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
export function createRecommendationCard(track, { loading = "lazy" } = {}) {
    const card = document.createElement("div");

    card.className = "recommendation-card";
    card.dataset.trackId = track.catalogId;

    const cover = document.createElement("img");
    cover.className = "recommendation-cover cover";
    configureTrackArtworkImage(cover, track.cover, {
        loading,
        sizes: "228px",
        recommendation: true
    });
    cover.alt = `Обложка трека ${track.title}`;

    const info = document.createElement("div");
    info.className = "recommendation-info";

    const title = document.createElement("div");
    title.className = "recommendation-title track-title";
    title.textContent = track.title;

    const artist = document.createElement("div");
    artist.className = "recommendation-artist artist-name";
    renderArtistLinks(artist, track);

    info.append(title, artist);
    card.append(cover, info);

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

    trackList.forEach((track, index) => {
        const card = createCard(track, index);

        container.append(card);
    });

    syncRenderedTrackCardsWithPlayerState(container);
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
        (track) => createTrackCard(track, { loading: "eager" })
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

    if (
        isMobileDevice() ||
        !("IntersectionObserver" in window) ||
        !revealObserver
    ) {
        revealElement(element);
        return;
    }

    try {
        revealObserver.observe(element);

        /*
        Некоторые встроенные браузеры создают observer, но не
        вызывают callback. Карточка всё равно станет видимой.
        */
        window.setTimeout(() => {
            if (
                !element.classList.contains(
                    "is-visible"
                )
            ) {
                revealElement(element);
                revealObserver?.unobserve(element);
            }
        }, REVEAL_FALLBACK_DELAY);
    } catch (error) {
        revealElement(element);
    }
}

export function unobserveRevealElement(element) {
    revealObserver?.unobserve(element);
}

export function initializeCardAnimations() {
    if (
        "IntersectionObserver" in window &&
        revealObserver === null
    ) {
        try {
            revealObserver = new IntersectionObserver(
                (entries, observer) => {
                    entries.forEach((entry) => {
                        if (!entry.isIntersecting) return;

                        revealElement(entry.target);

                        observer.unobserve(entry.target);
                    });
                },
                {
                    threshold: 0.12,
                    rootMargin: "0px 0px -40px 0px"
                }
            );
        } catch (error) {
            revealObserver = null;
        }
    }

    document
        .querySelectorAll(
            ".release-card.reveal-item, " +
            ".recommendations-section.reveal-section"
        )
        .forEach(observeRevealElement);
}
