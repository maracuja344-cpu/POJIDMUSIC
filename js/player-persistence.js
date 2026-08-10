import { reconcileQueueSnapshot } from "./queue-decisions.js";

export const PLAYER_SNAPSHOT_KEY = "pojidmusic-player-state";
export const PLAYER_SNAPSHOT_VERSION = 1;

export const LEGACY_PLAYER_KEYS = Object.freeze([
    "player-track-id",
    "player-track",
    "player-time",
    "player-volume",
    "player-shuffle",
    "player-repeat",
    "player-history-v2",
    "player-playback-context-v2"
]);

const REPEAT_MODES = new Set(["off", "all", "one"]);
const CONTEXT_TYPES = new Set([
    "catalog",
    "artist",
    "search",
    "recommendations",
    "my-tracks",
    "autoplay"
]);

function finiteNumber(value, fallback, minimum = -Infinity, maximum = Infinity) {
    const parsed = Number(value);
    return Number.isFinite(parsed)
        ? Math.min(Math.max(parsed, minimum), maximum)
        : fallback;
}

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

function historyIds(values) {
    return (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
        .slice(-100);
}

function normalizeQueue(value) {
    const ids = uniqueIds(value?.ids ?? value?.queueIds);
    const requestedIndex = Number(value?.currentIndex);
    return {
        ids,
        currentIndex: Number.isInteger(requestedIndex) &&
            requestedIndex >= 0 && requestedIndex < ids.length
            ? requestedIndex
            : -1
    };
}

function normalizeHistory(value) {
    const ids = historyIds(value?.ids ?? value);
    const requestedIndex = Number(value?.index);
    return {
        ids,
        index: Number.isInteger(requestedIndex) &&
            requestedIndex >= 0 && requestedIndex < ids.length
            ? requestedIndex
            : ids.length - 1
    };
}

function normalizeSource(value) {
    const type = CONTEXT_TYPES.has(value?.type) ? value.type : "catalog";
    return {
        type,
        id: String(value?.id || type),
        label: String(value?.label || type)
    };
}

export function createDefaultPlayerSnapshot() {
    return {
        version: PLAYER_SNAPSHOT_VERSION,
        currentTrackId: null,
        position: 0,
        duration: 0,
        volume: 0.1,
        repeatMode: "off",
        shuffle: false,
        queue: { ids: [], currentIndex: -1 },
        history: { ids: [], index: -1 },
        source: { type: "catalog", id: "catalog", label: "catalog" },
        paused: true,
        savedAt: 0
    };
}

export function normalizePlayerSnapshot(value) {
    const defaults = createDefaultPlayerSnapshot();
    const currentTrackId = String(value?.currentTrackId || "").trim() || null;
    return {
        version: PLAYER_SNAPSHOT_VERSION,
        currentTrackId,
        position: currentTrackId
            ? finiteNumber(value?.position, 0, 0)
            : 0,
        duration: currentTrackId
            ? finiteNumber(value?.duration, 0, 0)
            : 0,
        volume: finiteNumber(value?.volume, defaults.volume, 0, 1),
        repeatMode: REPEAT_MODES.has(value?.repeatMode)
            ? value.repeatMode
            : defaults.repeatMode,
        shuffle: value?.shuffle === true,
        queue: normalizeQueue(value?.queue),
        history: normalizeHistory(value?.history),
        source: normalizeSource(value?.source),
        paused: value?.paused !== false,
        savedAt: finiteNumber(value?.savedAt, 0, 0)
    };
}

export function serializePlayerSnapshot(value, savedAt = Date.now()) {
    return JSON.stringify(normalizePlayerSnapshot({ ...value, savedAt }));
}

export function deserializePlayerSnapshot(serialized) {
    if (!serialized) return null;
    try {
        const parsed = JSON.parse(serialized);
        if (parsed?.version !== PLAYER_SNAPSHOT_VERSION) return null;
        return normalizePlayerSnapshot(parsed);
    } catch {
        return null;
    }
}

function parseLegacyJson(storage, key) {
    try {
        return JSON.parse(storage.getItem(key));
    } catch {
        return null;
    }
}

export function migrateLegacyPlayerSnapshot(
    storage,
    { resolveLegacyTrackId = () => null, now = Date.now } = {}
) {
    const hasLegacyState = LEGACY_PLAYER_KEYS.some(
        (key) => storage.getItem(key) !== null
    );
    if (!hasLegacyState) return null;

    const context = parseLegacyJson(storage, "player-playback-context-v2");
    const history = parseLegacyJson(storage, "player-history-v2");
    const legacyTrackId = storage.getItem("player-track-id");
    const legacyAudioPath = storage.getItem("player-track");
    const currentTrackId = String(
        legacyTrackId || resolveLegacyTrackId(legacyAudioPath) || ""
    ).trim() || null;
    const snapshot = normalizePlayerSnapshot({
        currentTrackId,
        position: storage.getItem("player-time"),
        volume: storage.getItem("player-volume"),
        repeatMode: storage.getItem("player-repeat"),
        shuffle: storage.getItem("player-shuffle") === "true",
        queue: context,
        source: context,
        history,
        paused: true,
        savedAt: now()
    });

    try {
        storage.setItem(
            PLAYER_SNAPSHOT_KEY,
            serializePlayerSnapshot(snapshot, snapshot.savedAt)
        );
    } catch {
        return null;
    }

    LEGACY_PLAYER_KEYS.forEach((key) => storage.removeItem(key));
    return snapshot;
}

export function loadPlayerSnapshot({
    storage = localStorage,
    resolveLegacyTrackId,
    now
} = {}) {
    const current = deserializePlayerSnapshot(
        storage.getItem(PLAYER_SNAPSHOT_KEY)
    );
    if (current) return current;
    return migrateLegacyPlayerSnapshot(storage, {
        resolveLegacyTrackId,
        now
    }) || createDefaultPlayerSnapshot();
}

export function readPlayerSnapshot(storage = localStorage) {
    return deserializePlayerSnapshot(
        storage.getItem(PLAYER_SNAPSHOT_KEY)
    ) || createDefaultPlayerSnapshot();
}

export function savePlayerSnapshot(
    value,
    { storage = localStorage, now = Date.now } = {}
) {
    const snapshot = normalizePlayerSnapshot({
        ...value,
        savedAt: now()
    });
    storage.setItem(
        PLAYER_SNAPSHOT_KEY,
        serializePlayerSnapshot(snapshot, snapshot.savedAt)
    );
    return snapshot;
}

export function updatePlayerSnapshot(
    patch,
    { storage = localStorage, now = Date.now } = {}
) {
    const current = deserializePlayerSnapshot(
        storage.getItem(PLAYER_SNAPSHOT_KEY)
    ) || createDefaultPlayerSnapshot();
    return savePlayerSnapshot(
        { ...current, ...patch },
        { storage, now }
    );
}

export function resetPlayerSnapshot(storage = localStorage) {
    storage.removeItem(PLAYER_SNAPSHOT_KEY);
}

export function reconcilePlayerSnapshot(snapshot, validIds, catalogIds = []) {
    const normalized = normalizePlayerSnapshot(snapshot);
    const valid = new Set(uniqueIds(validIds));
    const currentIsValid = valid.has(normalized.currentTrackId);
    const originalCurrentIndex = normalized.currentTrackId
        ? normalized.queue.ids.indexOf(normalized.currentTrackId)
        : normalized.queue.currentIndex;
    const queue = reconcileQueueSnapshot({
        queueIds: normalized.queue.ids,
        currentIndex: originalCurrentIndex,
        sourceType: normalized.source.type,
        validIds: [...valid],
        catalogIds
    });
    const ids = normalized.history.ids.filter((id) => valid.has(id));
    const currentHistoryId = normalized.history.ids[normalized.history.index];
    let historyIndex = currentHistoryId ? ids.lastIndexOf(currentHistoryId) : -1;
    if (historyIndex < 0 && currentIsValid) {
        historyIndex = ids.lastIndexOf(normalized.currentTrackId);
    }

    return normalizePlayerSnapshot({
        ...normalized,
        currentTrackId: currentIsValid ? normalized.currentTrackId : null,
        position: currentIsValid ? normalized.position : 0,
        duration: currentIsValid ? normalized.duration : 0,
        paused: true,
        queue: {
            ids: queue.queueIds,
            currentIndex: currentIsValid
                ? queue.queueIds.indexOf(normalized.currentTrackId)
                : -1
        },
        history: { ids, index: historyIndex }
    });
}
