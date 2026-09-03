const tracks = [];

(() => {
    const url = new URL(window.location.href);
    const isCatalogRoute = !url.searchParams.get("artist") &&
        !url.searchParams.get("view");

    if (!isCatalogRoute) return;

    const root = document.documentElement;
    root.classList.add("catalog-loading");

    const style = document.createElement("style");
    style.textContent = `
        html.catalog-loading .app-boot-curtain,
        html.catalog-loading .app-boot-curtain[hidden] {
            position: fixed !important;
            inset: 0 !important;
            z-index: 4000 !important;
            display: grid !important;
            place-items: center !important;
            overflow: hidden !important;
            background: #07070a !important;
            color: rgba(255, 255, 255, 0.92) !important;
            pointer-events: auto !important;
        }

        html.catalog-loading .app-boot-curtain.is-ready::before,
        html.catalog-loading .app-boot-curtain.is-ready::after {
            transform: none !important;
        }

        html.catalog-loading .app-boot-curtain.is-ready .app-boot-curtain-wordmark {
            opacity: 1 !important;
        }

        html.catalog-loading .app-boot-curtain-wordmark {
            display: grid;
            gap: 14px;
            place-items: center;
        }

        html.catalog-loading .app-boot-curtain-wordmark::after {
            content: "";
            width: 74px;
            height: 2px;
            border-radius: 999px;
            background: linear-gradient(
                90deg,
                rgba(255,255,255,0.08),
                rgba(255,255,255,0.88),
                rgba(255,255,255,0.08)
            );
            animation: pojidmusic-catalog-loading 1.05s ease-in-out infinite;
        }

        html.catalog-loading .track-skeleton {
            display: none !important;
        }

        @keyframes pojidmusic-catalog-loading {
            0%, 100% { opacity: 0.24; transform: scaleX(0.48); }
            50% { opacity: 1; transform: scaleX(1); }
        }

        @media (prefers-reduced-motion: reduce) {
            html.catalog-loading .app-boot-curtain-wordmark::after {
                animation: none;
                opacity: 0.72;
            }
        }
    `;
    document.head.append(style);

    let released = false;
    let observer = null;

    function releaseCatalogGate() {
        if (released) return;
        released = true;
        observer?.disconnect();
        root.classList.remove("catalog-loading");
        root.classList.remove("cold-home-boot");

        const curtain = document.querySelector(".app-boot-curtain");
        if (!curtain) return;

        curtain.classList.add("is-ready");
        window.setTimeout(() => {
            curtain.setAttribute("hidden", "");
        }, 460);
    }

    function hasSupabaseTracks() {
        return Boolean(document.querySelector(
            '.release-card[data-track-id^="supabase:"]'
        ));
    }

    observer = new MutationObserver(() => {
        if (hasSupabaseTracks()) releaseCatalogGate();
    });

    const startObserving = () => {
        if (hasSupabaseTracks()) {
            releaseCatalogGate();
            return;
        }

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    };

    if (document.body) startObserving();
    else document.addEventListener("DOMContentLoaded", startObserving, { once: true });

    window.setTimeout(releaseCatalogGate, 11000);
})();
