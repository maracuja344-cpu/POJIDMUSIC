const PUBLIC_OBJECT_PATH = "/storage/v1/object/public/";
const PUBLIC_RENDER_PATH = "/storage/v1/render/image/public/";
const backgroundRequests = new WeakMap();

export const ARTWORK_WIDTHS = Object.freeze({
    accent: 64,
    trackSmall: 320,
    trackCard: 512,
    recommendation: 768,
    avatar: 320,
    banner: 1200
});

export function getTransformedArtworkUrl(
    source,
    {
        width,
        height,
        quality = 80,
        resize = "cover"
    } = {}
) {
    if (!source || !width) return source || "";

    try {
        const url = new URL(source, window.location.href);

        if (!url.pathname.includes(PUBLIC_OBJECT_PATH)) {
            return source;
        }

        url.pathname = url.pathname.replace(
            PUBLIC_OBJECT_PATH,
            PUBLIC_RENDER_PATH
        );
        url.searchParams.set("width", String(width));
        if (height) url.searchParams.set("height", String(height));
        url.searchParams.set("quality", String(quality));
        url.searchParams.set("resize", resize);

        return url.href;
    } catch {
        return source;
    }
}

export function getTrackCardArtwork(source) {
    return Object.freeze({
        original: source || "",
        accent: getTransformedArtworkUrl(source, {
            width: ARTWORK_WIDTHS.accent,
            height: ARTWORK_WIDTHS.accent,
            quality: 72,
            resize: "contain"
        }),
        small: getTransformedArtworkUrl(source, {
            width: ARTWORK_WIDTHS.trackSmall,
            height: ARTWORK_WIDTHS.trackSmall,
            resize: "contain"
        }),
        card: getTransformedArtworkUrl(source, {
            width: ARTWORK_WIDTHS.trackCard,
            height: ARTWORK_WIDTHS.trackCard,
            resize: "contain"
        }),
        recommendation: getTransformedArtworkUrl(source, {
            width: ARTWORK_WIDTHS.recommendation,
            height: ARTWORK_WIDTHS.recommendation,
            resize: "contain"
        })
    });
}

export function configureTrackArtworkImage(
    image,
    source,
    {
        loading = "lazy",
        sizes = "(max-width: 600px) calc(50vw - 35px), " +
            "(max-width: 1000px) calc(50vw - 30px), 150px",
        recommendation = false
    } = {}
) {
    const artwork = getTrackCardArtwork(source);

    image.width = ARTWORK_WIDTHS.recommendation;
    image.height = ARTWORK_WIDTHS.recommendation;
    image.decoding = "async";
    image.loading = loading;
    image.src = artwork.small;

    if (artwork.small !== artwork.original) {
        image.srcset = `${artwork.small} ${ARTWORK_WIDTHS.trackSmall}w, ` +
            `${artwork.card} ${ARTWORK_WIDTHS.trackCard}w` + (
                recommendation
                    ? `, ${artwork.recommendation} ${ARTWORK_WIDTHS.recommendation}w`
                    : ""
            );
        image.sizes = sizes;
        image.addEventListener("error", () => {
            if (image.src === artwork.original) return;
            image.removeAttribute("srcset");
            image.removeAttribute("sizes");
            image.src = artwork.original;
        });
    }

    return artwork;
}

export function applyArtworkBackground(
    element,
    source,
    options,
    apply
) {
    const requestId = (backgroundRequests.get(element) || 0) + 1;
    backgroundRequests.set(element, requestId);
    const transformed = getTransformedArtworkUrl(source, options);
    apply(transformed);

    if (!source || transformed === source) return transformed;

    const probe = new Image();
    probe.onerror = () => {
        if (backgroundRequests.get(element) === requestId) apply(source);
    };
    probe.src = transformed;
    return transformed;
}
