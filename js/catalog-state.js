let catalogTracks = Object.freeze([]);

function getRuntimeTracks(nextTracks) {
    return nextTracks.filter((track) => track?.source !== "local");
}

export function setCatalogTracks(nextTracks) {
    if (!Array.isArray(nextTracks)) {
        throw new TypeError("Каталог треков должен быть массивом.");
    }

    catalogTracks = Object.freeze(getRuntimeTracks(nextTracks));
}

export function getCatalogTracks() {
    return catalogTracks;
}

export function getCatalogTrackById(catalogId) {
    return catalogTracks.find((track) => {
        return track.catalogId === catalogId;
    }) ?? null;
}

export function replaceCatalogTrack(nextTrack) {
    if (nextTrack?.source === "local") return false;

    const trackIndex = catalogTracks.findIndex((track) => {
        return track.catalogId === nextTrack?.catalogId;
    });

    if (trackIndex === -1) return false;

    const nextTracks = [...catalogTracks];
    nextTracks[trackIndex] = nextTrack;
    catalogTracks = Object.freeze(nextTracks);
    return true;
}

export function getTrackReleaseTimestamp(track) {
    const timestamp = Date.parse(track?.releaseDate ?? "");
    return Number.isFinite(timestamp) ? timestamp : 0;
}

export function sortTracksByReleaseDate(items) {
    return items
        .map((track, index) => ({ track, index }))
        .sort((left, right) => {
            const dateDifference =
                getTrackReleaseTimestamp(right.track) -
                getTrackReleaseTimestamp(left.track);

            return dateDifference || left.index - right.index;
        })
        .map(({ track }) => track);
}
