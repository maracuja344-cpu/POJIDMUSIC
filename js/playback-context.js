const STORAGE_KEY = "player-playback-context-v2";
const CONTEXT_TYPES = new Set([
    "catalog",
    "artist",
    "search",
    "recommendations",
    "my-tracks",
    "autoplay"
]);

function uniqueIds(values) {
    const seen = new Set();
    return (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter((value) => {
            if (!value || seen.has(value)) return false;
            seen.add(value);
            return true;
        });
}

function normalizeContext(value) {
    const type = CONTEXT_TYPES.has(value?.type) ? value.type : "catalog";
    const queueIds = uniqueIds(value?.queueIds);
    const requestedIndex = Number(value?.currentIndex);
    return {
        type,
        id: String(value?.id || type),
        label: String(value?.label || type),
        queueIds,
        currentIndex: Number.isInteger(requestedIndex) &&
            requestedIndex >= 0 && requestedIndex < queueIds.length
            ? requestedIndex
            : -1
    };
}

function restoreContext() {
    try {
        return normalizeContext(JSON.parse(localStorage.getItem(STORAGE_KEY)));
    } catch {
        return normalizeContext(null);
    }
}

let playbackContext = restoreContext();

function persistContext() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(playbackContext));
}

function notifyPlaybackContextChange() {
    window.dispatchEvent(new CustomEvent("playbackcontextchange", {
        detail: getPlaybackContext()
    }));
}

export function setPlaybackContext(nextContext) {
    playbackContext = normalizeContext(nextContext);
    persistContext();
    notifyPlaybackContextChange();
    return getPlaybackContext();
}

export function setPlaybackContextCurrent(catalogId) {
    const currentIndex = playbackContext.queueIds.indexOf(catalogId);
    if (currentIndex === playbackContext.currentIndex) return getPlaybackContext();
    playbackContext = { ...playbackContext, currentIndex };
    persistContext();
    return getPlaybackContext();
}

export function getPlaybackContext() {
    return {
        ...playbackContext,
        queueIds: [...playbackContext.queueIds]
    };
}

export function reconcilePlaybackContext(validIds, catalogIds = []) {
    const valid = new Set(uniqueIds(validIds));
    const nextIds = playbackContext.queueIds.filter((id) => valid.has(id));

    if (playbackContext.type === "catalog" && nextIds.length === 0) {
        nextIds.push(...uniqueIds(catalogIds).filter((id) => valid.has(id)));
    }

    const currentId = playbackContext.queueIds[playbackContext.currentIndex];
    const currentIndex = currentId ? nextIds.indexOf(currentId) : -1;

    if (nextIds.length === playbackContext.queueIds.length &&
        currentIndex === playbackContext.currentIndex &&
        nextIds.every((id, index) => id === playbackContext.queueIds[index])) {
        return getPlaybackContext();
    }

    playbackContext = {
        ...playbackContext,
        queueIds: nextIds,
        currentIndex
    };
    persistContext();
    notifyPlaybackContextChange();
    return getPlaybackContext();
}
