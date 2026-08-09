const STATIC_CACHE = "pojidmusic-static-v5";
const STATIC_ASSETS = [
    "./",
    "./index.html",
    "./style.css",
    "./tracks.js",
    "./manifest.webmanifest",
    "./icons/favicon-16.png",
    "./icons/favicon-32.png",
    "./icons/favicon-48.png",
    "./icons/apple-touch-icon.png",
    "./icons/icon-192.png",
    "./icons/icon-512.png",
    "./icons/icon-maskable-512.png",
    "./js/script.js",
    "./js/mobile.js",
    "./js/catalog-state.js",
    "./js/tracks-utils.js",
    "./js/artist-utils.js",
    "./js/app-navigation.js",
    "./js/artist-media.js",
    "./js/playback-context.js",
    "./js/render.js",
    "./js/search.js",
    "./js/player.js",
    "./js/carousel.js",
    "./js/pull-to-refresh.js",
    "./js/tracks-api.js",
    "./js/auth.js",
    "./js/track-upload.js",
    "./js/navigation.js",
    "./js/supabase/client.js",
    "./js/supabase/config.js",
    "./img/cover.jpg"
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches
            .open(STATIC_CACHE)
            .then((cache) => cache.addAll(STATIC_ASSETS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((cacheNames) => {
                return Promise.all(
                    cacheNames
                        .filter((name) => {
                            return (
                                name.startsWith("pojidmusic-") &&
                                name !== STATIC_CACHE
                            );
                        })
                        .map((name) => caches.delete(name))
                );
            })
            .then(() => self.clients.claim())
    );
});

async function networkFirst(request) {
    const cache = await caches.open(STATIC_CACHE);

    try {
        const response = await fetch(request);

        if (response.ok) {
            await cache.put(request, response.clone());
        }

        return response;
    } catch (error) {
        return (
            await cache.match(request, { ignoreSearch: true }) ||
            await cache.match("./index.html") ||
            Promise.reject(error)
        );
    }
}

async function staleWhileRevalidate(request) {
    const cache = await caches.open(STATIC_CACHE);
    const cachedResponse = await cache.match(request);
    const networkResponse = fetch(request)
        .then((response) => {
            if (response.ok) {
                void cache.put(request, response.clone());
            }

            return response;
        })
        .catch(() => null);

    if (cachedResponse) return cachedResponse;

    return await networkResponse || Response.error();
}

self.addEventListener("fetch", (event) => {
    const { request } = event;
    const url = new URL(request.url);

    if (
        request.method !== "GET" ||
        url.origin !== self.location.origin ||
        request.destination === "audio"
    ) {
        return;
    }

    if (request.mode === "navigate") {
        event.respondWith(networkFirst(request));
        return;
    }

    if (
        ["style", "script", "image", "font"].includes(
            request.destination
        ) ||
        url.pathname.endsWith(".webmanifest")
    ) {
        event.respondWith(staleWhileRevalidate(request));
    }
});
