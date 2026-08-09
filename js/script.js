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
    initializeSearch,
    refreshActiveSearch
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
    initializePlayer,
    reconcilePlayerWithCatalog
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
import {
    getCatalogTracks,
    setCatalogTracks
} from "./catalog-state.js";
import {
    initializePullToRefresh
} from "./pull-to-refresh.js";
import {
    normalizeArtistName,
    parseLegacyArtistCredit
} from "./artist-utils.js";
import {
    initializeAppNavigation,
    refreshActiveRoute
} from "./app-navigation.js";

const CATALOG_REQUEST_TIMEOUT_MS = 10000;
export const CATALOG_STALE_MS = 60 * 1000;
let websiteInitializationPromise = null;
let activeRefreshPromise = null;
let isRefreshing = false;
let refreshGeneration = 0;
let lastSuccessfulCatalogRefreshAt = 0;
let refreshFeaturesInitialized = false;

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
        source: "local",
        artists: Object.freeze(
            Array.isArray(track.artists) && track.artists.length
                ? track.artists
                : parseLegacyArtistCredit(track.artist)
        )
    }));
}

function mergeCatalogTracks(localTracks, remoteTracks) {
    const tracksByCatalogId = new Map();
    const storedArtistsByName = new Map();

    remoteTracks.forEach((track) => {
        track.artists?.forEach((artist) => {
            if (!artist.isFallback) {
                storedArtistsByName.set(
                    normalizeArtistName(artist.displayName),
                    artist
                );
            }
        });
    });

    [...localTracks, ...remoteTracks].forEach((track) => {
        if (!track?.catalogId) return;

        const artists = track.artists?.map((artist) => {
            const storedArtist = storedArtistsByName.get(
                normalizeArtistName(artist.displayName)
            );

            if (!storedArtist) return artist;

            return Object.freeze({
                ...storedArtist,
                role: artist.role,
                position: artist.position
            });
        });

        tracksByCatalogId.set(
            track.catalogId,
            artists
                ? Object.freeze({
                    ...track,
                    artists: Object.freeze(artists)
                })
                : track
        );
    });

    return [...tracksByCatalogId.values()];
}

function getStableTrackSnapshot(track) {
    return Object.keys(track)
        .filter((key) => {
            return !["audio", "audioExpiresAt"].includes(key);
        })
        .sort()
        .reduce((snapshot, key) => {
            snapshot[key] = track[key];
            return snapshot;
        }, {});
}

function getCatalogFingerprint(trackList) {
    return JSON.stringify(
        trackList
            .map(getStableTrackSnapshot)
            .sort((left, right) => {
                return String(left.catalogId).localeCompare(
                    String(right.catalogId)
                );
            })
    );
}

async function loadPublishedTracks(existingTracks = []) {
    return withTimeout(
        import("./tracks-api.js").then(({ getPublishedTracks }) => {
            return getPublishedTracks({ existingTracks });
        }),
        CATALOG_REQUEST_TIMEOUT_MS
    );
}

async function prepareCatalog() {
    const localTracks = getLocalCatalogTracks();
    let remoteTracks = [];

    try {
        remoteTracks = await loadPublishedTracks();
        lastSuccessfulCatalogRefreshAt = Date.now();
    } catch (error) {
        console.warn(
            error instanceof Error
                ? error.message
                : "Каталог Supabase недоступен. Используется локальный каталог."
        );
    }

    setCatalogTracks(
        mergeCatalogTracks(localTracks, remoteTracks)
    );
}

function renderUpdatedCatalog() {
    renderNewTracks();
    renderAllTracks();
    renderRecommendations();
    initializeCardAnimations();
    refreshActiveSearch();
    initializeRecommendationsCarousel();
    reconcilePlayerWithCatalog();
    refreshActiveRoute();
}

export function getIsCatalogRefreshing() {
    return isRefreshing;
}

export function refreshCatalog({
    force = false,
    source = "manual"
} = {}) {
    if (activeRefreshPromise) {
        return activeRefreshPromise;
    }

    if (
        !force &&
        Date.now() - lastSuccessfulCatalogRefreshAt <
            CATALOG_STALE_MS
    ) {
        return Promise.resolve({ status: "unchanged" });
    }

    isRefreshing = true;
    const generation = ++refreshGeneration;
    const previousTracks = getCatalogTracks();
    const existingRemoteTracks = previousTracks.filter(
        (track) => track.source === "supabase"
    );

    activeRefreshPromise = (async () => {
        try {
            const remoteTracks = await loadPublishedTracks(
                existingRemoteTracks
            );
            const nextTracks = mergeCatalogTracks(
                getLocalCatalogTracks(),
                remoteTracks
            );

            if (generation !== refreshGeneration) {
                return { status: "unchanged" };
            }

            lastSuccessfulCatalogRefreshAt = Date.now();

            if (
                getCatalogFingerprint(previousTracks) ===
                getCatalogFingerprint(nextTracks)
            ) {
                return { status: "unchanged" };
            }

            setCatalogTracks(nextTracks);
            renderUpdatedCatalog();

            return { status: "updated" };
        } catch (error) {
            console.warn(
                `Не удалось обновить каталог (${source}).`,
                error instanceof Error
                    ? error.message
                    : "Неизвестная ошибка"
            );

            return { status: "error" };
        } finally {
            if (generation === refreshGeneration) {
                isRefreshing = false;
                activeRefreshPromise = null;
            }
        }
    })();

    return activeRefreshPromise;
}

function initializeCatalogRefreshFeatures() {
    if (refreshFeaturesInitialized) return;
    refreshFeaturesInitialized = true;

    initializePullToRefresh({
        refreshCatalog,
        getIsRefreshing: getIsCatalogRefreshing
    });

    const refreshIfStale = () => {
        if (document.hidden) return;
        void refreshCatalog({ source: "lifecycle" });
    };

    document.addEventListener("visibilitychange", refreshIfStale);
    window.addEventListener("pageshow", refreshIfStale);
    window.addEventListener("focus", refreshIfStale);
}

function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;

    window.addEventListener(
        "load",
        () => {
            void navigator.serviceWorker
                .register("./service-worker.js")
                .catch((error) => {
                    console.warn(
                        "Service worker не зарегистрирован.",
                        error
                    );
                });
        },
        { once: true }
    );
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

    /* Лёгкая SPA-навигация не пересоздаёт Audio и плеер. */
    initializeAppNavigation();

    /* Запускаем карусель рекомендаций */
    initializeRecommendationsCarousel();

    initializeCatalogRefreshFeatures();

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
registerServiceWorker();
