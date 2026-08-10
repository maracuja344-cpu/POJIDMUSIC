function defaultValuesEqual(left, right) {
    return Object.is(left, right);
}

export function createMemoryDataCache({
    now = () => Date.now(),
    valuesEqual = defaultValuesEqual,
    onBackgroundError = () => {}
} = {}) {
    const entries = new Map();
    const stats = {
        hits: 0,
        misses: 0,
        staleHits: 0,
        loads: 0,
        deduplicated: 0,
        invalidations: 0
    };

    function getEntry(key) {
        let entry = entries.get(key);
        if (!entry) {
            entry = {
                hasValue: false,
                value: undefined,
                timestamp: 0,
                inFlight: null
            };
            entries.set(key, entry);
        }
        return entry;
    }

    function startLoad(key, loader, entry, onUpdate) {
        if (entry.inFlight) {
            stats.deduplicated += 1;
            return entry.inFlight;
        }

        stats.loads += 1;
        const hadValue = entry.hasValue;
        const previousValue = entry.value;
        const request = Promise.resolve()
            .then(loader)
            .then((value) => {
                entry.hasValue = true;
                entry.value = value;
                entry.timestamp = now();

                if (
                    hadValue &&
                    !valuesEqual(previousValue, value)
                ) {
                    onUpdate?.(value, previousValue, key);
                }

                return value;
            })
            .finally(() => {
                if (entry.inFlight === request) {
                    entry.inFlight = null;
                }
            });

        entry.inFlight = request;
        return request;
    }

    async function get(key, loader, {
        ttlMs = 0,
        staleWhileRevalidateMs = 0,
        force = false,
        onUpdate
    } = {}) {
        if (typeof loader !== "function") {
            throw new TypeError("Data cache loader must be a function.");
        }

        const entry = getEntry(key);

        const age = entry.hasValue
            ? Math.max(0, now() - entry.timestamp)
            : Number.POSITIVE_INFINITY;

        if (!force && entry.hasValue && age <= ttlMs) {
            stats.hits += 1;
            return entry.value;
        }

        if (
            !force &&
            entry.hasValue &&
            age <= ttlMs + staleWhileRevalidateMs
        ) {
            stats.staleHits += 1;
            if (entry.inFlight) {
                stats.deduplicated += 1;
            } else {
                void startLoad(key, loader, entry, onUpdate)
                    .catch(onBackgroundError);
            }
            return entry.value;
        }

        if (entry.inFlight) {
            stats.deduplicated += 1;
            return entry.inFlight;
        }

        stats.misses += 1;
        return startLoad(key, loader, entry, onUpdate);
    }

    function set(key, value) {
        const entry = getEntry(key);
        entry.hasValue = true;
        entry.value = value;
        entry.timestamp = now();
        return value;
    }

    function peek(key) {
        const entry = entries.get(key);
        return entry?.hasValue ? entry.value : undefined;
    }

    function invalidate(keyOrPredicate) {
        const predicate = typeof keyOrPredicate === "function"
            ? keyOrPredicate
            : (key) => key === keyOrPredicate;
        let removed = 0;

        for (const key of entries.keys()) {
            if (!predicate(key)) continue;
            entries.delete(key);
            removed += 1;
        }

        stats.invalidations += removed;
        return removed;
    }

    function clear() {
        const removed = entries.size;
        entries.clear();
        stats.invalidations += removed;
    }

    function getStats() {
        return { ...stats, entries: entries.size };
    }

    return Object.freeze({
        get,
        set,
        peek,
        invalidate,
        clear,
        getStats
    });
}
