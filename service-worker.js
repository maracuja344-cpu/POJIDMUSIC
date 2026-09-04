const RELEASE_VERSION = "pwa-v53";
const SHELL_CACHE = `pojidmusic-shell-${RELEASE_VERSION}`;
const SDK_CACHE = "pojidmusic-sdk-supabase-2.112.2";
const CACHE_PREFIX = "pojidmusic-";
const RELEASE_MARKER = `<meta name="pojidmusic-release" content="pwa-v28">`;
const SERVED_RELEASE_MARKER = `<meta name="pojidmusic-release" content="${RELEASE_VERSION}">`;
const ENTRY_VERSION = "53";

const CRITICAL_SHELL_ASSETS = [
    "./index.html", "./style.css", "./telegram-profile.css", "./telegram-profile-v45.css", "./mobile-navigation.css", "./artist-mobile-list.css", "./track-management-surface.css", "./home-discovery.css", "./home-discovery.js", "./artist-public-surface.js", "./track-upload-wizard.css", "./tracks.js", "./manifest.webmanifest", "./img/cover.jpg",
    "./js/app-navigation.js", "./js/artist-onboarding.js", "./js/artist-media.js", "./js/artist-utils.js", "./js/artwork.js", "./js/audio-url-resolver.js", "./js/audio-url-resolver-core.js", "./js/auth.js", "./js/carousel.js", "./js/catalog-state.js", "./js/data-cache.js", "./js/data-repository.js", "./js/feedback.js", "./js/image-cropper.js", "./js/mobile.js", "./js/media-session.js", "./js/playback-context.js", "./js/mobile-shell.js", "./js/player.js", "./js/player-persistence.js", "./js/profile-routing.js", "./js/pull-to-refresh.js", "./js/queue-decisions.js", "./js/render.js", "./js/script.js", "./js/search.js", "./js/supabase/client.js", "./js/supabase/config.js", "./js/track-management.js", "./js/tracks-api.js", "./js/tracks-utils.js", "./js/track-upload.js", "./js/track-upload-wizard.js", "./js/track-upload-wizard-entry.js"
];
const OPTIONAL_SHELL_ASSETS = ["./icons/favicon-16.png", "./icons/favicon-32.png", "./icons/favicon-48.png", "./icons/apple-touch-icon.png", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-maskable-512.png"];
const SDK_ASSETS = ["https://esm.sh/@supabase/supabase-js@2.112.2?bundle", "https://esm.sh/@supabase/supabase-js@2.112.2/es2022/supabase-js.bundle.mjs", "https://esm.sh/node/buffer.mjs", "https://esm.sh/node/process.mjs", "https://esm.sh/node/events.mjs", "https://esm.sh/node/tty.mjs", "https://esm.sh/node/async_hooks.mjs"];
const shellUrlByPath = new Map(CRITICAL_SHELL_ASSETS.concat(OPTIONAL_SHELL_ASSETS).map((asset) => { const url = new URL(asset, self.registration.scope); return [url.pathname, url.href]; }));
const sdkUrls = new Set(SDK_ASSETS);
const indexUrl = new URL("./index.html", self.registration.scope).href;
const indexPath = new URL(indexUrl).pathname;
const scopePath = new URL(self.registration.scope).pathname;
async function cacheOptionalAssets(cache) { await Promise.allSettled(OPTIONAL_SHELL_ASSETS.map(async (asset) => { const request = new Request(asset, { cache: "reload" }); const response = await fetch(request); if (response.ok) await cache.put(request, response); })); }
self.addEventListener("install", (event) => { event.waitUntil((async () => { const shellCache = await caches.open(SHELL_CACHE); const sdkCache = await caches.open(SDK_CACHE); await Promise.all([shellCache.addAll(CRITICAL_SHELL_ASSETS.map((asset) => new Request(asset, { cache: "reload" }))), sdkCache.addAll(SDK_ASSETS.map((asset) => new Request(asset, { cache: "reload" })))]); await cacheOptionalAssets(shellCache); await self.skipWaiting(); })()); });
self.addEventListener("activate", (event) => { event.waitUntil((async () => { const cacheNames = await caches.keys(); await Promise.all(cacheNames.filter((name) => name.startsWith(CACHE_PREFIX) && ![SHELL_CACHE, SDK_CACHE].includes(name)).map((name) => caches.delete(name))); await self.clients.claim(); const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true }); await Promise.allSettled(windows.map((client) => client.navigate(client.url))); })()); });
self.addEventListener("message", (event) => { if (event.data?.type === "GET_RELEASE_VERSION") event.ports[0]?.postMessage({ releaseVersion: RELEASE_VERSION }); });
async function getCachedShellResponse(canonicalUrl) { const cache = await caches.open(SHELL_CACHE); return await cache.match(canonicalUrl); }
function versionNavigationHtml(html) {
    let next = html.replace(RELEASE_MARKER, SERVED_RELEASE_MARKER).replace('href="style.css"', `href="style.css?v=${ENTRY_VERSION}"`).replace('src="js/script.js"', `src="js/script.js?v=${ENTRY_VERSION}"`);
    if (!next.includes("telegram-profile-v45.css")) next = next.replace("</head>", `    <link rel="stylesheet" href="telegram-profile-v45.css?v=${ENTRY_VERSION}">\n</head>`);
    if (!next.includes("track-management-surface.css")) next = next.replace("</head>", `    <link rel="stylesheet" href="track-management-surface.css?v=${ENTRY_VERSION}">\n</head>`);
    if (!next.includes("home-discovery.css")) next = next.replace("</head>", `    <link rel="stylesheet" href="home-discovery.css?v=${ENTRY_VERSION}">\n</head>`);
    if (!next.includes("home-discovery.js")) next = next.replace("</body>", `    <script type="module" src="home-discovery.js?v=${ENTRY_VERSION}"></script>\n</body>`);
    if (!next.includes("artist-public-surface.js")) next = next.replace("</body>", `    <script type="module" src="artist-public-surface.js?v=${ENTRY_VERSION}"></script>\n</body>`);
    return next;
}
function htmlResponse(html, sourceResponse) { const headers = new Headers(sourceResponse?.headers || {}); headers.set("Content-Type", "text/html; charset=utf-8"); headers.set("Cache-Control", "no-store"); return new Response(html, { status: sourceResponse?.status || 200, statusText: sourceResponse?.statusText || "OK", headers }); }
async function handleNavigation(request) { const cache = await caches.open(SHELL_CACHE); try { const response = await fetch(request, { cache: "no-store" }); if (response.ok) { const html = await response.clone().text(); if (html.includes(RELEASE_MARKER) || html.includes(SERVED_RELEASE_MARKER)) { const versioned = htmlResponse(versionNavigationHtml(html), response); await cache.put(indexUrl, versioned.clone()); return versioned; } } } catch {} const cached = await cache.match(indexUrl); if (!cached) return Response.error(); const html = await cached.text(); return htmlResponse(versionNavigationHtml(html), cached); }
async function handleShellAsset(canonicalUrl, request) { const url = new URL(request.url); if (url.searchParams.has("v")) { try { const fresh = await fetch(request, { cache: "no-store" }); if (fresh.ok) return fresh; } catch {} } return await getCachedShellResponse(canonicalUrl) || new Response("POJIDMUSIC app shell cache is incomplete.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }); }
async function handleSdkAsset(request) { const cache = await caches.open(SDK_CACHE); const cached = await cache.match(request); if (cached) return cached; try { return await fetch(request); } catch { return Response.error(); } }
self.addEventListener("fetch", (event) => { const { request } = event; if (request.method !== "GET") return; const url = new URL(request.url); if (sdkUrls.has(url.href)) { event.respondWith(handleSdkAsset(request)); return; } if (url.origin !== self.location.origin) return; if (request.mode === "navigate" && [scopePath, indexPath].includes(url.pathname)) { event.respondWith(handleNavigation(request)); return; } const canonicalUrl = shellUrlByPath.get(url.pathname); if (canonicalUrl) event.respondWith(handleShellAsset(canonicalUrl, request)); });
