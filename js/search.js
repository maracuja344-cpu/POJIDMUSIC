import { createTrackCard } from "./render.js";


/* =========================================================
   1. ПОИСК ТРЕКОВ
   ========================================================= */

/*
Ищет треки по названию или имени исполнителя.

Параметр query содержит подготовленный запрос:
без пробелов по краям и в нижнем регистре.
*/
function findTracks(query) {
    return tracks.filter((track) => {
        /*
        Переводим название и исполнителя
        в нижний регистр.

        Благодаря этому поиск не зависит
        от больших и маленьких букв.
        */
        const title = track.title.toLowerCase();
        const artist = track.artist.toLowerCase();

        return (
            title.includes(query) ||
            artist.includes(query)
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
    foundTracks.forEach((track, index) => {
        /*
        Создаём обычную карточку трека
        через функцию из render.js.
        */
        const card = createTrackCard(track);

        /*
        Добавляем небольшую последовательную задержку.

        Если найдено несколько треков,
        они будут появляться друг за другом.
        */
        card.style.setProperty(
            "--delay",
            `${index * 60}ms`
        );

        /*
        Сначала добавляем карточку в HTML
        в её начальном скрытом состоянии.
        */
        container.append(card);

        /*
        На следующем кадре добавляем класс show.

        Браузер успевает увидеть:

        1. скрытую карточку;
        2. видимую карточку.

        Между этими состояниями запускается
        CSS-анимация.
        */
        requestAnimationFrame(() => {
            card.classList.add("show");
        });
    });
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
function handleSearch({
    searchInput,
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
    const query = searchInput.value
        .trim()
        .toLowerCase();

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
        !searchResultsSection ||
        !searchResultsList ||
        !searchEmpty
    ) {
        return;
    }

    /*
    Событие input срабатывает при:

    - вводе символа;
    - удалении символа;
    - вставке текста;
    - очистке строки.
    */
    searchInput.addEventListener("input", () => {
        handleSearch({
            searchInput,
            searchResultsSection,
            searchResultsList,
            searchEmpty,
            mainSections
        });
    });
}