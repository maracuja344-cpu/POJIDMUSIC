/* =========================================================
   1. ИМПОРТ ФУНКЦИЙ РЕНДЕРА
   ========================================================= */

/*
Эти функции создают карточки треков
и добавляют их в нужные разделы страницы.
*/
import {
    renderNewTracks,
    renderAllTracks,
    renderRecommendations,
    initializeCardAnimations
} from "./render.js";


/* =========================================================
   2. ИМПОРТ ПОИСКА
   ========================================================= */

/*
Подключает работу строки поиска:

- фильтрацию треков;
- отображение результатов;
- скрытие основных разделов;
- сообщение, если ничего не найдено.
*/
import {
    initializeSearch
} from "./search.js";


/* =========================================================
   3. ИМПОРТ ПЛЕЕРА
   ========================================================= */

/*
Подключает мини-плеер:

- запуск трека;
- паузу;
- переключение;
- прогресс;
- громкость;
- сохранение состояния.
*/
import {
    initializePlayer
} from "./player.js";


/* =========================================================
   4. ИМПОРТ КАРУСЕЛИ
   ========================================================= */

/*
Запускает автоматическую прокрутку
рекомендаций.
*/
import {
    initializeRecommendationsCarousel
} from "./carousel.js";


import {
    initializeMobileEnvironment
} from "./mobile.js";
import { setCatalogTracks } from "./catalog-state.js";

const CATALOG_LOAD_TIMEOUT_MS = 5000;
let websiteInitializationPromise = null;

function withTimeout(promise, timeoutMs) {
    let timeoutId;
    const timeout = new Promise((_, reject) => {
        timeoutId = window.setTimeout(() => {
            reject(new Error("Превышено время загрузки каталога."));
        }, timeoutMs);
    });

    return Promise.race([promise, timeout]).finally(() => {
        window.clearTimeout(timeoutId);
    });
}

function getLocalCatalogTracks() {
    if (typeof tracks === "undefined" || !Array.isArray(tracks)) {
        throw new Error("Локальный каталог tracks.js недоступен.");
    }

    return tracks.map((track, index) => Object.freeze({
        ...track,
        catalogId: `local:${String(track.id ?? index)}`,
        source: "local"
    }));
}

async function prepareCatalog() {
    const localTracks = getLocalCatalogTracks();
    let remoteTracks = [];

    try {
        remoteTracks = await withTimeout(
            import("./tracks-api.js").then(({ getPublishedTracks }) => {
                return getPublishedTracks();
            }),
            CATALOG_LOAD_TIMEOUT_MS
        );
    } catch (error) {
        console.warn(
            error instanceof Error
                ? error.message
                : "Каталог Supabase недоступен. Используется локальный каталог."
        );
    }

    setCatalogTracks([...localTracks, ...remoteTracks]);
}


/* =========================================================
   6. ОСНОВНАЯ ИНИЦИАЛИЗАЦИЯ САЙТА
   ========================================================= */

/*
Главная функция запуска сайта.

Порядок здесь важен:

1. Сначала создаются карточки.
2. Затем включаются анимации.
3. После этого подключается поиск.
4. Затем плеер.
5. В конце запускается карусель.

Плеер и карусель должны запускаться только после того,
как карточки уже появились в HTML.
*/
async function initializeWebsiteOnce() {
    await prepareCatalog();

    /*
    Мобильный режим определяется до создания карточек:
    WebView сразу получает облегчённые эффекты и надёжный рендер.
    */
    initializeMobileEnvironment();

    /* Создаём раздел «Новинки» */
    renderNewTracks();

    /* Создаём раздел «Все треки» */
    renderAllTracks();

    /* Создаём карточки рекомендаций */
    renderRecommendations();

    /* Запускаем анимации появления карточек */
    initializeCardAnimations();

    /* Подключаем поиск */
    initializeSearch();

    /* Подключаем мини-плеер */
    initializePlayer();

    /* Запускаем карусель рекомендаций */
    initializeRecommendationsCarousel();

}

function initializeWebsite() {
    if (!websiteInitializationPromise) {
        websiteInitializationPromise = initializeWebsiteOnce().catch((error) => {
            console.error(
                "Не удалось инициализировать сайт:",
                error instanceof Error ? error.message : "неизвестная ошибка"
            );
        });
    }

    return websiteInitializationPromise;
}


/*
Auth подключается после основной логики сайта.
Если внешний Supabase SDK временно недоступен,
каталог, поиск и плеер продолжают работать.
*/
async function initializeAuthFeature() {
    let authReady = false;

    try {
        const {
            initializeAuth
        } = await import("./auth.js");

        initializeAuth();
        authReady = true;
    } catch {
        const authButton =
            document.querySelector(".auth-open-button");
        const authControls =
            document.querySelector(".auth-controls");

        if (authControls) {
            authControls.dataset.authReady = "true";
        }

        if (authButton) {
            authButton.disabled = true;
            authButton.title =
                "Авторизация временно недоступна";
        }
    }

    if (!authReady) return;

    try {
        const {
            initializeTrackUpload
        } = await import("./track-upload.js");

        initializeTrackUpload();
    } catch (error) {
        const uploadButton =
            document.querySelector(
                ".track-upload-open-button"
            );

        if (uploadButton) {
            uploadButton.hidden = true;
        }

        console.error(
            "Интерфейс загрузки трека временно недоступен.",
            error
        );
    }
}


/* =========================================================
   7. ЗАПУСК САЙТА
   ========================================================= */

/*
Так как script.js подключён через type="module",
браузер запускает его после загрузки HTML.

Поэтому отдельный DOMContentLoaded здесь не нужен.
*/
void initializeWebsite();
void initializeAuthFeature();
