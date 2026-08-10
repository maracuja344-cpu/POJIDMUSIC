import { reconcileQueueSnapshot } from "./queue-decisions.js";
import {
    readPlayerSnapshot,
    updatePlayerSnapshot
} from "./player-persistence.js";
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
    const snapshot = readPlayerSnapshot();
    return normalizeContext({
        ...snapshot.source,
        queueIds: snapshot.queue.ids,
        currentIndex: snapshot.queue.currentIndex
    });
}

let playbackContext = restoreContext();

function persistContext() {
    updatePlayerSnapshot({
        queue: {
            ids: playbackContext.queueIds,
            currentIndex: playbackContext.currentIndex
        },
        source: {
            type: playbackContext.type,
            id: playbackContext.id,
            label: playbackContext.label
        }
    });
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

export function restorePlaybackContext(snapshot) {
    playbackContext = normalizeContext({
        ...snapshot?.source,
        queueIds: snapshot?.queue?.ids,
        currentIndex: snapshot?.queue?.currentIndex
    });
    notifyPlaybackContextChange();
    return getPlaybackContext();
}

export function reconcilePlaybackContext(validIds, catalogIds = []) {
    const {
        queueIds: nextIds,
        currentIndex
    } = reconcileQueueSnapshot({
        queueIds: playbackContext.queueIds,
        currentIndex: playbackContext.currentIndex,
        sourceType: playbackContext.type,
        validIds,
        catalogIds
    });

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
