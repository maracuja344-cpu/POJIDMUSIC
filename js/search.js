import {
    createTrackCard,
    observeRevealElement,
    unobserveRevealElement
} from "./render.js";
import { getTrackArtists } from "./artist-utils.js";
import { isPlayableRelease } from "./tracks-utils.js";
import { getCatalogTracks } from "./catalog-state.js";
import { isMobileDevice } from "./mobile.js";
import { syncRenderedTrackCardsWithPlayerState } from "./player.js";


/* =========================================================
   1. ПОИСК ТРЕКОВ
   ========================================================= */

/*
Ищет треки по названию или имени исполнителя.

Параметр query содержит подготовленный запрос:
без пробелов по краям и в нижнем регистре.
*/
function findTracks(query) {
    return getCatalogTracks().filter((track) => {
        if (!isPlayableRelease(track)) {
            return false;
        }

        /*
        Переводим название и исполнителя
        в нижний регистр.

        Благодаря этому поиск не зависит
        от больших и маленьких букв.
        */
        const title = track.title.toLowerCase();
        const artists = getTrackArtists(track)
            .map((artist) => artist.displayName.toLowerCase());
        const fallbackArtist = String(track.artist || "").toLowerCase();

        return (
            title.includes(query) ||
            fallbackArtist.includes(query) ||
            artists.some((artist) => artist.includes(query))
        );
    });
}


/* =========================================================
   2. ПОКАЗ И СКРЫТИЕ ОСНОВНЫХ РАЗДЕЛОВ
   ========================================================= */

/*
Показывает основные разделы сайта:

- Новинки
- Все треки
- Рекомендации
*/
function showMainSections(sections) {
    sections.forEach((section) => {
        section.style.display = "";
    });
}


/*
Скрывает основные разделы,
пока пользователь использует поиск.
*/
function hideMainSections(sections) {
    sections.forEach((section) => {
        section.style.display = "none";
    });
}


/* =========================================================
   3. ОЧИСТКА РЕЗУЛЬТАТОВ
   ========================================================= */

/*
Удаляет карточки предыдущего поискового запроса.

Это необходимо, чтобы результаты
не накапливались и не дублировались.
*/
function clearSearchResults(container) {
    container
        .querySelectorAll(".reveal-item")
        .forEach(unobserveRevealElement);

    container.innerHTML = "";
}


/* =========================================================
   4. ОТРИСОВКА НАЙДЕННЫХ ТРЕКОВ
   ========================================================= */

/*
Создаёт карточки найденных треков
и вставляет их в контейнер результатов.
*/
function renderSearchResults(
    foundTracks,
    container
) {
    foundTracks.forEach((track) => {
        /*
        Создаём обычную карточку трека
        через функцию из render.js.
        */
        const card = createTrackCard(track);

        container.append(card);
        observeRevealElement(card);
    });

    syncRenderedTrackCardsWithPlayerState(container);
}


/* =========================================================
   5. СООБЩЕНИЕ «НИЧЕГО НЕ НАЙДЕНО»
   ========================================================= */

/*
Показывает сообщение, если массив
найденных треков оказался пустым.
*/
function updateEmptyMessage(
    foundTracks,
    searchEmpty
) {
    searchEmpty.style.display =
        foundTracks.length === 0
            ? "block"
            : "none";
}


/* =========================================================
   6. СБРОС ПОИСКА
   ========================================================= */

/*
Возвращает страницу в обычное состояние,
когда пользователь очищает строку поиска.
*/
function resetSearch({
    searchResultsSection,
    searchResultsList,
    searchEmpty,
    mainSections
}) {
    /*
    Удаляем карточки прошлого поиска.
    */
    clearSearchResults(searchResultsList);

    /*
    Убираем класс видимости,
    чтобы следующий поиск снова анимировался.
    */
    searchResultsSection.classList.remove(
        "search-visible"
    );

    /*
    Полностью скрываем раздел поиска.
    */
    searchResultsSection.style.display = "none";

    /*
    Возвращаем основные разделы сайта.
    */
    showMainSections(mainSections);

    /*
    Скрываем сообщение об отсутствии результатов.
    */
    searchEmpty.style.display = "none";
}


/* =========================================================
   7. ПОКАЗ РАЗДЕЛА ПОИСКА
   ========================================================= */

/*
Показывает раздел результатов
и запускает его плавное появление.
*/
function showSearchSection(searchResultsSection) {
    /*
    Сначала элемент должен снова участвовать
    в разметке страницы.
    */
    searchResultsSection.style.display = "block";

    /*
    Убираем старый класс перед запуском анимации.

    Это особенно важно, если пользователь
    уже выполнял поиск ранее.
    */
    searchResultsSection.classList.remove(
        "search-visible"
    );

    /*
    Двойной requestAnimationFrame даёт браузеру
    время отрисовать начальное скрытое состояние.

    После этого добавляется класс видимости
    и запускается плавный переход.
    */
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            searchResultsSection.classList.add(
                "search-visible"
            );
        });
    });
}


/* =========================================================
   8. ОБРАБОТКА ПОИСКОВОГО ЗАПРОСА
   ========================================================= */

/*
Выполняет весь цикл поиска:

1. Подготавливает запрос.
2. Очищает старые результаты.
3. Проверяет пустую строку.
4. Скрывает основные разделы.
5. Показывает раздел поиска.
6. Находит треки.
7. Создаёт карточки.
8. Обновляет сообщение об отсутствии результатов.
*/
let activeSearchContext = null;

function getNormalizedQuery(value) {
    return String(value ?? "")
        .trim()
        .toLowerCase();
}

function updateClearButton(searchInput, clearButton) {
    if (!clearButton) return;

    const shouldShow =
        getNormalizedQuery(searchInput.value) !== "";

    clearButton.hidden = !shouldShow;
    clearButton.disabled = !shouldShow;
}

function handleSearch({
    searchInput,
    clearButton,
    searchResultsSection,
    searchResultsList,
    searchEmpty,
    mainSections
}) {
    /*
    trim() удаляет пробелы по краям.

    toLowerCase() делает поиск независимым
    от регистра букв.
    */
    const query = getNormalizedQuery(searchInput.value);

    updateClearButton(searchInput, clearButton);

    /*
    Удаляем результаты предыдущего запроса.
    */
    clearSearchResults(searchResultsList);

    /*
    Если строка пустая,
    возвращаем обычный вид страницы.
    */
    if (query === "") {
        resetSearch({
            searchResultsSection,
            searchResultsList,
            searchEmpty,
            mainSections
        });

        return;
    }

    /*
    Скрываем обычные разделы сайта.
    */
    hideMainSections(mainSections);

    /*
    Показываем и плавно проявляем
    раздел результатов поиска.
    */
    showSearchSection(searchResultsSection);

    /*
    Получаем массив найденных треков.
    */
    const foundTracks = findTracks(query);

    /*
    Создаём карточки найденных треков.
    */
    renderSearchResults(
        foundTracks,
        searchResultsList
    );

    /*
    Показываем или скрываем надпись
    «Ничего не найдено».
    */
    updateEmptyMessage(
        foundTracks,
        searchEmpty
    );
}


/* =========================================================
   9. ЗАПУСК ПОИСКА
   ========================================================= */

/*
Находит необходимые HTML-элементы
и подключает обработчик ввода.
*/
export function initializeSearch() {
    /*
    Поле поискового запроса.
    */
    const searchInput = document.querySelector(
        ".search-input"
    );

    const clearButton = document.querySelector(
        ".search-clear-button"
    );

    /*
    Полный раздел результатов поиска.
    */
    const searchResultsSection =
        document.querySelector("#search-results");

    /*
    Контейнер для найденных карточек.
    */
    const searchResultsList =
        document.querySelector(".search-results-list");

    /*
    Сообщение «Ничего не найдено».
    */
    const searchEmpty =
        document.querySelector(".search-empty");

    /*
    Основные разделы сайта,
    скрываемые во время поиска.
    */
    const mainSections = document.querySelectorAll(
        "#new, #all-tracks, #recommendations"
    );

    /*
    Защита от ошибок.

    Если обязательный элемент отсутствует,
    поиск просто не запускается.
    */
    if (
        !searchInput ||
        !clearButton ||
        !searchResultsSection ||
        !searchResultsList ||
        !searchEmpty
    ) {
        return;
    }

    activeSearchContext = {
        searchInput,
        clearButton,
        searchResultsSection,
        searchResultsList,
        searchEmpty,
        mainSections
    };

    if (searchInput.dataset.searchInitialized === "true") {
        handleSearch(activeSearchContext);
        return;
    }

    searchInput.dataset.searchInitialized = "true";

    function clearSearch({ preserveDesktopFocus = true } = {}) {
        if (getNormalizedQuery(searchInput.value) === "") {
            return;
        }

        searchInput.value = "";
        handleSearch(activeSearchContext);

        if (isMobileDevice()) {
            searchInput.blur();
        } else if (preserveDesktopFocus) {
            searchInput.focus({ preventScroll: true });
        }
    }

    /*
    Событие input срабатывает при:

    - вводе символа;
    - удалении символа;
    - вставке текста;
    - очистке строки.
    */
    searchInput.addEventListener("input", () => {
        handleSearch(activeSearchContext);
    });

    clearButton.addEventListener("click", () => {
        clearSearch();
    });

    searchInput.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;

        if (getNormalizedQuery(searchInput.value) !== "") {
            event.preventDefault();
            clearSearch();
            return;
        }

        if (document.activeElement === searchInput) {
            searchInput.blur();
        }
    });

    updateClearButton(searchInput, clearButton);
}

export function refreshActiveSearch() {
    if (!activeSearchContext) return false;

    const query = getNormalizedQuery(
        activeSearchContext.searchInput.value
    );

    updateClearButton(
        activeSearchContext.searchInput,
        activeSearchContext.clearButton
    );

    if (query === "") return false;

    handleSearch(activeSearchContext);
    return true;
}


export function clearActiveSearch({
    preserveDesktopFocus = false
} = {}) {
    if (!activeSearchContext) return false;

    activeSearchContext.searchInput.value = "";
    handleSearch(activeSearchContext);

    if (!preserveDesktopFocus) {
        activeSearchContext.searchInput.blur();
    }

    return true;
}
