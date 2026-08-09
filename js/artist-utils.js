const EXPLICIT_FEATURE_PATTERN = /\s+(?:feat\.?|ft\.?)\s+/i;
const AMBIGUOUS_CREDIT_PATTERN = /(?:&|\/|,|\s+x\s+|\s+with\s+)/i;


export function normalizeArtistName(value) {
    return String(value ?? "")
        .trim()
        .replace(/\s+/g, " ")
        .toLocaleLowerCase();
}


function stableHash(value) {
    let hash = 2166136261;

    for (const character of value) {
        hash ^= character.codePointAt(0);
        hash = Math.imul(hash, 16777619);
    }

    return (hash >>> 0).toString(36);
}


export function createFallbackArtist(
    displayName,
    role = "primary",
    position = 0
) {
    const cleanName = String(displayName ?? "")
        .trim()
        .replace(/\s+/g, " ");
    const normalizedName = normalizeArtistName(cleanName);

    return Object.freeze({
        id: null,
        displayName: cleanName || "Неизвестный исполнитель",
        normalizedName,
        slug: `credit-${stableHash(normalizedName || "unknown")}`,
        avatarUrl: "",
        bannerUrl: "",
        bio: "",
        linkedProfileId: null,
        role,
        position,
        isFallback: true
    });
}


export function parseLegacyArtistCredit(value) {
    const cleanCredit = String(value ?? "")
        .trim()
        .replace(/\s+/g, " ");

    if (!cleanCredit) {
        return [createFallbackArtist("")];
    }

    if (
        AMBIGUOUS_CREDIT_PATTERN.test(cleanCredit) ||
        !EXPLICIT_FEATURE_PATTERN.test(cleanCredit)
    ) {
        return [createFallbackArtist(cleanCredit)];
    }

    const names = cleanCredit
        .split(EXPLICIT_FEATURE_PATTERN)
        .map((name) => name.trim())
        .filter(Boolean);

    if (names.length < 2) {
        return [createFallbackArtist(cleanCredit)];
    }

    return names.map((name, index) => {
        return createFallbackArtist(
            name,
            index === 0 ? "primary" : "featured",
            index === 0 ? 0 : index - 1
        );
    });
}


export function getTrackArtists(track) {
    if (Array.isArray(track?.artists) && track.artists.length) {
        return track.artists;
    }

    return parseLegacyArtistCredit(track?.artist);
}


export function getArtistDisplayCredit(track) {
    const artists = getTrackArtists(track);
    const primary = artists.filter((artist) => {
        return artist.role !== "featured";
    });
    const featured = artists.filter((artist) => {
        return artist.role === "featured";
    });
    const primaryText = primary
        .map((artist) => artist.displayName)
        .join(" & ");

    return primaryText + (
        featured.length
            ? ` feat. ${featured.map((artist) => artist.displayName).join(", ")}`
            : ""
    );
}


export function createArtistLink(artist) {
    const link = document.createElement("a");
    const targetUrl = new URL(window.location.href);

    targetUrl.searchParams.delete("view");
    targetUrl.searchParams.set("artist", artist.slug);
    targetUrl.hash = "";

    link.className = "artist-link";
    link.href = `${targetUrl.pathname}${targetUrl.search}`;
    link.dataset.artistSlug = artist.slug;
    link.textContent = artist.displayName;
    link.setAttribute(
        "aria-label",
        `Открыть страницу артиста ${artist.displayName}`
    );

    return link;
}


export function renderArtistLinks(container, track) {
    if (!container) return;

    const artists = getTrackArtists(track);
    container.replaceChildren();

    artists.forEach((artist, index) => {
        if (index > 0) {
            const previous = artists[index - 1];
            const separator = document.createElement("span");

            separator.className = "artist-credit-separator";
            separator.textContent =
                artist.role === "featured" &&
                previous.role !== "featured"
                    ? " feat. "
                    : artist.role === "featured"
                        ? ", "
                        : " & ";
            container.append(separator);
        }

        container.append(createArtistLink(artist));
    });
}


export function trackIncludesArtist(track, artist) {
    return getTrackArtists(track).some((candidate) => {
        if (artist?.id && candidate.id) {
            return candidate.id === artist.id;
        }

        return (
            candidate.slug === artist?.slug ||
            candidate.normalizedName === artist?.normalizedName
        );
    });
}
