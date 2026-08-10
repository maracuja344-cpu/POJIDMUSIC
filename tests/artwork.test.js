import {
    ARTWORK_WIDTHS,
    configureTrackArtworkImage,
    getTrackCardArtwork,
    getTransformedArtworkUrl
} from "../js/artwork.js";

const output = document.querySelector("#test-output");
const results = [];

function assert(name, condition) {
    if (!condition) throw new Error(name);
    results.push(`PASS ${name}`);
}

try {
    const original = "https://project.supabase.co/storage/v1/object/public/track-covers/a.webp?v=7";
    const transformed = getTransformedArtworkUrl(original, {
        width: 320,
        quality: 82
    });
    const parsed = new URL(transformed);

    assert("public object URL becomes a render URL",
        parsed.pathname.includes("/storage/v1/render/image/public/track-covers/a.webp"));
    assert("transform dimensions and quality are stable",
        parsed.searchParams.get("width") === "320" &&
        parsed.searchParams.get("quality") === "82" &&
        parsed.searchParams.get("resize") === "cover");
    assert("existing cache version is preserved", parsed.searchParams.get("v") === "7");
    assert("local artwork remains unchanged",
        getTransformedArtworkUrl("img/cover.jpg", { width: 320 }) === "img/cover.jpg");

    const sources = getTrackCardArtwork(original);
    assert("track tiers include measured 320, 512 and 768 widths",
        sources.small.includes("width=320") && sources.small.includes("height=320") &&
        sources.card.includes("width=512") && sources.card.includes("height=512") &&
        sources.recommendation.includes("width=768") &&
        sources.card.includes("resize=contain"));

    const image = document.createElement("img");
    configureTrackArtworkImage(image, original, { loading: "eager", sizes: "150px" });
    assert("responsive image metadata is applied",
        image.loading === "eager" && image.decoding === "async" &&
        image.width === ARTWORK_WIDTHS.recommendation &&
        image.height === ARTWORK_WIDTHS.recommendation &&
        image.srcset.includes("320w") && image.srcset.includes("512w") &&
        image.sizes === "150px");
    image.dispatchEvent(new Event("error"));
    assert("failed responsive source falls back to the original",
        !image.hasAttribute("srcset") && image.src === original);

    const localImage = document.createElement("img");
    configureTrackArtworkImage(localImage, "../img/cover.jpg");
    assert("legacy local images keep a single original source",
        !localImage.hasAttribute("srcset") && localImage.getAttribute("src") === "../img/cover.jpg");

    document.body.dataset.testStatus = "passed";
    output.textContent = `${results.length} PASS\n${results.join("\n")}`;
} catch (error) {
    document.body.dataset.testStatus = "failed";
    output.textContent = `${results.length} PASS\nFAIL ${error.message}\n${error.stack || ""}`;
    throw error;
}
