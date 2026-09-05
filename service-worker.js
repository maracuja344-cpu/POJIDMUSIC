const RELEASE_VERSION = "pwa-v97";
const SHELL_CACHE = `pojidmusic-shell-${RELEASE_VERSION}`;
const SDK_CACHE = "pojidmusic-sdk-supabase-2.112.2";
const CACHE_PREFIX = "pojidmusic-";
const SERVED_RELEASE_MARKER = `<meta name="pojidmusic-release" content="${RELEASE_VERSION}">`;
const ENTRY_VERSION = "97";

const CRITICAL_SHELL_ASSETS = [
    "./index.html", "./style.css", "./telegram-profile.css", "./telegram-profile-v45.css", "./mobile-ui-fixes-v84.css", "./mobile-navigation.css", "./artist-mobile-list.css", "./mobile-polish.css", "./player-mobile-polish.css", "./mobile-polish-final.css", "./artist-hero-v92.css", "./album-surface.css", "./queue-sheet-v88.css", "./track-management-surface.css", "./home-discovery.css", "./recommendations-hotfix-v93.css", "./home-discovery.js", "./artist-public-surface.js", "./track-editor-modal-guard.js", "./album-upload.css", "./album-upload-mobile-compact.css", "./album-upload-wizard.css", "./release-upload-chooser.css", "./track-upload-wizard.css", "./admin-panel.css", "./tracks.js", "./manifest.webmanifest", "./img/cover.jpg",
    "./js/app-navigation.js", "./js/artist-media.js", "./js/artist-utils.js", "./js/artwork.js", "./js/audio-url-resolver.js", "./js/audio-url-resolver-core.js", "./js/auth.js", "./js/account-auth-guard.js", "./js/admin-panel.js", "./js/admin-mobile-bridge.js", "./js/album-surface.js", "./js/queue-sheet-motion.js", "./js/carousel.js", "./js/catalog-state.js", "./js/data-cache.js", "./js/data-repository.js", "./js/feedback.js", "./js/image-cropper.js", "./js/mobile.js", "./js/media-session.js", "./js/playback-context.js", "./js/mobile-shell.js", "./js/player.js", "./js/player-persistence.js", "./js/profile-routing.js", "./js/pull-to-refresh.js", "./js/queue-decisions.js", "./js/render.js", "./js/script.js", "./js/search.js", "./js/supabase/client.js", "./js/supabase/config.js", "./js/track-management.js", "./js/tracks-api.js", "./js/tracks-utils.js", "./js/track-upload.js", "./js/track-upload-wizard.js", "./js/track-upload-wizard-entry.js", "./js/album-upload.js", "./js/album-upload-entry.js", "./js/album-upload-wizard.js", "./js/album-upload-scroll-lock.js", "./js/album-upload-bridge.js", "./js/release-upload-chooser.js"
];

const OPTIONAL_SHELL_ASSETS = [
    "./icons/favicon-16.png", "./icons/favicon-32.png", "./icons/favicon-48.png", "./icons/apple-touch-icon.png", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-maskable-512.png"
];

const SDK_ASSETS = [
    "https://esm.sh/@supabase/supabase-js@2.112.2?bundle",
    "https://esm.sh/@supabase/supabase-js@2.112.2/es2022/supabase-js.bundle.mjs",
    "https://esm.sh/node/buffer.mjs",
    "https://esm.sh/node/process.mjs",
    "https://esm.sh/node/events.mjs",
    "https://esm.sh/node/tty.mjs",
    "https://esm.sh/node/async_hooks.mjs"
];

const ARTIST_CINEMATIC_STYLE = `
<style id="artist-cinematic-v97">
@media (max-width: 932px) {
    #artist-profile.artist-profile-view {
        width: 100% !important;
        max-width: none !important;
        margin: 0 0 150px !important;
        padding: 0 !important;
        overflow-x: hidden !important;
        background: #09090a !important;
    }

    #artist-profile .artist-hero {
        position: relative !important;
        width: 100% !important;
        max-width: none !important;
        min-height: 600px !important;
        margin: 0 !important;
        padding: 0 !important;
        border: 0 !important;
        border-radius: 0 !important;
        background: #09090a !important;
        box-shadow: none !important;
        overflow: hidden !important;
        isolation: isolate !important;
    }

    #artist-profile .artist-banner {
        position: absolute !important;
        inset: 0 0 auto 0 !important;
        width: 100% !important;
        height: 520px !important;
        min-height: 520px !important;
        margin: 0 !important;
        padding: 0 !important;
        border: 0 !important;
        border-radius: 0 !important;
        background-size: cover !important;
        background-position: center 34% !important;
        box-shadow: none !important;
        transform: none !important;
    }

    #artist-profile .artist-banner::after {
        content: "" !important;
        position: absolute !important;
        inset: 0 !important;
        pointer-events: none !important;
        background:
            linear-gradient(180deg, rgba(9,9,10,.02) 0%, rgba(9,9,10,.03) 42%, rgba(9,9,10,.36) 66%, rgba(9,9,10,.82) 82%, #09090a 98%) !important;
    }

    #artist-profile .artist-hero-content {
        position: relative !important;
        z-index: 3 !important;
        width: 100% !important;
        min-height: 600px !important;
        margin: 0 !important;
        padding: 0 24px 24px !important;
        display: flex !important;
        flex-direction: column !important;
        justify-content: flex-end !important;
        align-items: stretch !important;
        gap: 0 !important;
        background: transparent !important;
        box-sizing: border-box !important;
    }

    #artist-profile .artist-profile-summary {
        width: 100% !important;
        min-width: 0 !important;
        margin: 0 0 18px !important;
        padding: 0 !important;
        display: block !important;
        text-align: left !important;
        background: transparent !important;
        border: 0 !important;
        box-shadow: none !important;
    }

    #artist-profile .artist-avatar { display: none !important; }

    #artist-profile .artist-identity {
        width: 100% !important;
        min-width: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        display: block !important;
        text-align: left !important;
    }

    #artist-profile [data-artist-name] {
        margin: 0 !important;
        padding: 0 !important;
        color: #fff !important;
        font-size: clamp(42px, 12vw, 56px) !important;
        font-weight: 780 !important;
        line-height: .94 !important;
        letter-spacing: -.052em !important;
        text-align: left !important;
        text-shadow: 0 3px 18px rgba(0,0,0,.48) !important;
    }

    #artist-profile [data-artist-release-count] {
        margin: 8px 0 0 !important;
        padding: 0 !important;
        min-height: 0 !important;
        display: block !important;
        color: rgba(255,255,255,.76) !important;
        font-size: 14px !important;
        font-weight: 600 !important;
        line-height: 1.2 !important;
        text-align: left !important;
        text-shadow: 0 2px 12px rgba(0,0,0,.46) !important;
    }

    #artist-profile .artist-owner-actions {
        display: none !important;
    }

    #artist-profile .artist-public-actions {
        width: min(100%, 430px) !important;
        margin: 0 !important;
        display: grid !important;
        grid-template-columns: minmax(0, 1fr) 54px 54px !important;
        gap: 10px !important;
    }

    #artist-profile .artist-public-actions button {
        min-width: 0 !important;
        height: 52px !important;
        min-height: 52px !important;
        margin: 0 !important;
        padding: 0 16px !important;
        border: 1px solid rgba(255,255,255,.10) !important;
        border-radius: 17px !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        gap: 9px !important;
        background: rgba(27,27,30,.76) !important;
        color: #fff !important;
        box-shadow: inset 0 1px 0 rgba(255,255,255,.04) !important;
        -webkit-backdrop-filter: blur(16px) saturate(115%) !important;
        backdrop-filter: blur(16px) saturate(115%) !important;
        font: inherit !important;
        font-size: 14px !important;
        font-weight: 720 !important;
    }

    #artist-profile .artist-public-actions svg {
        width: 20px !important;
        height: 20px !important;
        flex: 0 0 20px !important;
        fill: none !important;
        stroke: currentColor !important;
        stroke-width: 1.8 !important;
        stroke-linecap: round !important;
        stroke-linejoin: round !important;
    }

    #artist-profile .artist-public-play svg {
        fill: currentColor !important;
        stroke: none !important;
    }

    #artist-profile .artist-public-shuffle,
    #artist-profile .artist-public-more {
        padding: 0 !important;
    }

    #artist-profile .artist-releases {
        position: relative !important;
        z-index: 4 !important;
        width: 100% !important;
        margin: 0 !important;
        padding: 4px 20px calc(160px + env(safe-area-inset-bottom)) !important;
        background: #09090a !important;
        box-sizing: border-box !important;
    }

    #artist-profile .artist-releases .section-title {
        margin: 0 0 16px !important;
        padding: 0 !important;
        color: #fff !important;
        font-size: 29px !important;
        font-weight: 790 !important;
        line-height: 1 !important;
        letter-spacing: -.04em !important;
        text-align: left !important;
    }

    #artist-profile [data-artist-tracks] {
        width: 100% !important;
        margin: 0 !important;
        padding: 0 !important;
        gap: 14px 10px !important;
    }

    #artist-profile [data-artist-tracks] .release-card {
        padding: 0 0 8px !important;
        border: 0 !important;
        border-radius: 14px !important;
        background: transparent !important;
        box-shadow: none !important;
    }

    #artist-profile [data-artist-tracks] .cover-wrap,
    #artist-profile [data-artist-tracks] .cover {
        border-radius: 14px !important;
    }

    #artist-profile [data-artist-tracks] .release-info {
        padding-right: 0 !important;
    }
}
</style>`;

const ARTIST_BOOTSTRAP = `
<script id="artist-cinematic-bootstrap-v97">
(() => {
    const apply = () => {
        const view = document.querySelector('#artist-profile');
        if (!view || view.hidden) return;
        const heroContent = view.querySelector('.artist-hero-content');
        if (!heroContent) return;
        view.classList.add('artist-cinematic-v97');
        if (!heroContent.querySelector('.artist-public-actions')) {
            const actions = document.createElement('div');
            actions.className = 'artist-public-actions';
            actions.setAttribute('aria-label', 'Действия артиста');
            actions.innerHTML = '<button class="artist-public-play" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"></path></svg><span>Слушать</span></button><button class="artist-public-shuffle" type="button" aria-label="Перемешать релизы"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h3.5c4.8 0 5.7 10 10.5 10H21"></path><path d="m18 14 3 3-3 3"></path><path d="M3 17h3.5c1.8 0 3-1.4 4.2-3.1"></path><path d="M13.1 9.6C14.2 8.1 15.3 7 17 7h4"></path><path d="m18 4 3 3-3 3"></path></svg></button><button class="artist-public-more" type="button" aria-label="Ещё"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.7"></circle><circle cx="12" cy="12" r="1.7"></circle><circle cx="19" cy="12" r="1.7"></circle></svg></button>';
            actions.querySelector('.artist-public-play')?.addEventListener('click', () => view.querySelector('[data-artist-tracks] .release-card')?.click());
            actions.querySelector('.artist-public-shuffle')?.addEventListener('click', () => {
                const cards = Array.from(view.querySelectorAll('[data-artist-tracks] .release-card'));
                if (cards.length) cards[Math.floor(Math.random() * cards.length)]?.click();
            });
            heroContent.append(actions);
        }
    };
    const schedule = () => requestAnimationFrame(apply);
    const view = document.querySelector('#artist-profile');
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-app-view'] });
    if (view) observer.observe(view, { attributes: true, attributeFilter: ['hidden'] });
    window.addEventListener('popstate', schedule);
    window.addEventListener('pageshow', schedule);
    apply();
})();
</script>`;

const shellUrlByPath = new Map(
    CRITICAL_SHELL_ASSETS.concat(OPTIONAL_SHELL_ASSETS).map((asset) => {
        const url = new URL(asset, self.registration.scope);
        return [url.pathname, url.href];
    })
);
const sdkUrls = new Set(SDK_ASSETS);
const indexUrl = new URL("./index.html", self.registration.scope).href;
const indexPath = new URL(indexUrl).pathname;
const scopePath = new URL(self.registration.scope).pathname;

async function cacheOptionalAssets(cache) {
    await Promise.allSettled(OPTIONAL_SHELL_ASSETS.map(async (asset) => {
        const request = new Request(asset, { cache: "reload" });
        const response = await fetch(request);
        if (response.ok) await cache.put(request, response);
    }));
}

self.addEventListener("install", (event) => {
    event.waitUntil((async () => {
        const shellCache = await caches.open(SHELL_CACHE);
        const sdkCache = await caches.open(SDK_CACHE);
        await Promise.all([
            shellCache.addAll(CRITICAL_SHELL_ASSETS.map((asset) => new Request(asset, { cache: "reload" }))),
            sdkCache.addAll(SDK_ASSETS.map((asset) => new Request(asset, { cache: "reload" })))
        ]);
        await cacheOptionalAssets(shellCache);
        await self.skipWaiting();
    })());
});

self.addEventListener("activate", (event) => {
    event.waitUntil((async () => {
        const cacheNames = await caches.keys();
        await Promise.all(
            cacheNames
                .filter((name) => name.startsWith(CACHE_PREFIX) && ![SHELL_CACHE, SDK_CACHE].includes(name))
                .map((name) => caches.delete(name))
        );
        await self.clients.claim();
        const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        await Promise.allSettled(windows.map((client) => client.navigate(client.url)));
    })());
});

self.addEventListener("message", (event) => {
    if (event.data?.type === "GET_RELEASE_VERSION") {
        event.ports[0]?.postMessage({ releaseVersion: RELEASE_VERSION });
    }
});

async function getCachedShellResponse(canonicalUrl) {
    const cache = await caches.open(SHELL_CACHE);
    return await cache.match(canonicalUrl);
}

function versionNavigationHtml(html) {
    let next = html
        .replace(/<meta name="pojidmusic-release" content="pwa-v\d+">/, SERVED_RELEASE_MARKER)
        .replace('href="style.css"', `href="style.css?v=${ENTRY_VERSION}"`)
        .replace('src="js/script.js"', `src="js/script.js?v=${ENTRY_VERSION}"`);

    const styles = [
        "telegram-profile.css",
        "telegram-profile-v45.css",
        "mobile-ui-fixes-v84.css",
        "track-management-surface.css",
        "home-discovery.css",
        "recommendations-hotfix-v93.css",
        "album-surface.css",
        "queue-sheet-v88.css",
        "album-upload.css",
        "album-upload-mobile-compact.css",
        "release-upload-chooser.css",
        "admin-panel.css"
    ];

    for (const file of styles) {
        if (!next.includes(file)) {
            next = next.replace("</head>", `    <link rel="stylesheet" href="${file}?v=${ENTRY_VERSION}">\n</head>`);
        }
    }

    if (!next.includes('id="artist-cinematic-v97"')) {
        next = next.replace("</head>", `${ARTIST_CINEMATIC_STYLE}\n</head>`);
    }

    const modules = [
        "home-discovery.js",
        "artist-public-surface.js",
        "track-editor-modal-guard.js",
        "js/album-surface.js",
        "js/queue-sheet-motion.js",
        "js/album-upload.js",
        "js/album-upload-bridge.js",
        "js/release-upload-chooser.js",
        "js/admin-panel.js",
        "js/admin-mobile-bridge.js"
    ];

    for (const file of modules) {
        if (!next.includes(file)) {
            next = next.replace("</body>", `    <script type="module" src="${file}?v=${ENTRY_VERSION}"></script>\n</body>`);
        }
    }

    if (!next.includes('id="artist-cinematic-bootstrap-v97"')) {
        next = next.replace("</body>", `${ARTIST_BOOTSTRAP}\n</body>`);
    }

    return next;
}

function htmlResponse(html, sourceResponse) {
    const headers = new Headers(sourceResponse?.headers || {});
    headers.set("Content-Type", "text/html; charset=utf-8");
    headers.set("Cache-Control", "no-store");
    return new Response(html, {
        status: sourceResponse?.status || 200,
        statusText: sourceResponse?.statusText || "OK",
        headers
    });
}

async function handleNavigation(request) {
    const cache = await caches.open(SHELL_CACHE);
    try {
        const response = await fetch(request, { cache: "no-store" });
        if (response.ok) {
            const html = await response.clone().text();
            const versioned = htmlResponse(versionNavigationHtml(html), response);
            await cache.put(indexUrl, versioned.clone());
            return versioned;
        }
    } catch {}

    const cached = await cache.match(indexUrl);
    if (!cached) return Response.error();
    const html = await cached.text();
    return htmlResponse(versionNavigationHtml(html), cached);
}

async function handleShellAsset(canonicalUrl, request) {
    const url = new URL(request.url);
    if (url.searchParams.has("v")) {
        try {
            const fresh = await fetch(request, { cache: "no-store" });
            if (fresh.ok) return fresh;
        } catch {}
    }
    return await getCachedShellResponse(canonicalUrl) || new Response(
        "POJIDMUSIC app shell cache is incomplete.",
        { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }
    );
}

async function handleSdkAsset(request) {
    const cache = await caches.open(SDK_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    try {
        return await fetch(request);
    } catch {
        return Response.error();
    }
}

self.addEventListener("fetch", (event) => {
    const { request } = event;
    if (request.method !== "GET") return;

    const url = new URL(request.url);
    if (sdkUrls.has(url.href)) {
        event.respondWith(handleSdkAsset(request));
        return;
    }
    if (url.origin !== self.location.origin) return;

    if (request.mode === "navigate" && [scopePath, indexPath].includes(url.pathname)) {
        event.respondWith(handleNavigation(request));
        return;
    }

    const canonicalUrl = shellUrlByPath.get(url.pathname);
    if (canonicalUrl) {
        event.respondWith(handleShellAsset(canonicalUrl, request));
    }
});
