import {
    LEGACY_PLAYER_KEYS,
    PLAYER_SNAPSHOT_KEY,
    createDefaultPlayerSnapshot,
    deserializePlayerSnapshot,
    loadPlayerSnapshot,
    migrateLegacyPlayerSnapshot,
    reconcilePlayerSnapshot,
    resetPlayerSnapshot,
    savePlayerSnapshot,
    serializePlayerSnapshot
} from "../js/player-persistence.js";

const output = document.querySelector("#test-output");
const results = [];

function assert(name, condition) {
    if (!condition) throw new Error(name);
    results.push(`PASS ${name}`);
}

function memoryStorage(seed = {}) {
    const values = new Map(Object.entries(seed));
    return {
        getItem: (key) => values.has(key) ? values.get(key) : null,
        setItem: (key, value) => values.set(key, String(value)),
        removeItem: (key) => values.delete(key),
        values
    };
}

try {
    const empty = loadPlayerSnapshot({ storage: memoryStorage() });
    assert("empty state uses sane defaults",
        empty.currentTrackId === null && empty.paused && empty.volume === 0.1);

    const source = {
        ...createDefaultPlayerSnapshot(),
        currentTrackId: "a",
        position: 42.5,
        duration: 75.25,
        volume: 0.65,
        repeatMode: "one",
        shuffle: true,
        shuffleOrder: { ids: ["a", "b"] },
        queue: { ids: ["a", "b"], currentIndex: 0 },
        history: { ids: ["a", "b", "a"], index: 1 },
        source: { type: "artist", id: "artist-x", label: "Artist X" },
        paused: false
    };
    const serialized = serializePlayerSnapshot(source, 1234);
    const restored = deserializePlayerSnapshot(serialized);
    assert("serialize and deserialize preserve schema fields",
        restored.currentTrackId === "a" && restored.savedAt === 1234 &&
        restored.source.type === "artist" && restored.queue.ids.length === 2);
    assert("volume restores", restored.volume === 0.65);
    assert("repeat restores", restored.repeatMode === "one");
    assert("shuffle restores", restored.shuffle === true);
    assert("materialized shuffle order restores",
        JSON.stringify(restored.shuffleOrder.ids) === JSON.stringify(["a", "b"]));
    assert("position restores", restored.position === 42.5);
    assert("known duration restores without resolving audio",
        restored.duration === 75.25);
    assert("history and forward cursor restore",
        restored.history.ids[2] === "a" && restored.history.index === 1);
    assert("version mismatch is invalidated",
        deserializePlayerSnapshot('{"version":99,"currentTrackId":"a"}') === null);
    assert("malformed JSON does not break boot",
        deserializePlayerSnapshot("{bad") === null);
    const upgradedV1 = deserializePlayerSnapshot(JSON.stringify({
        ...source,
        version: 1,
        shuffleOrder: undefined
    }));
    assert("version 1 snapshot upgrades without losing playback state",
        upgradedV1.version === 2 && upgradedV1.currentTrackId === "a" &&
        upgradedV1.shuffleOrder.ids.length === 0);

    const legacy = memoryStorage({
        "player-track": "music/a.mp3",
        "player-time": "19.25",
        "player-volume": "0.4",
        "player-shuffle": "true",
        "player-repeat": "all",
        "player-history-v2": JSON.stringify({ ids: ["a", "b"], index: 0 }),
        "player-playback-context-v2": JSON.stringify({
            type: "search", id: "q", label: "Query", queueIds: ["a", "b"], currentIndex: 0
        })
    });
    const migrated = migrateLegacyPlayerSnapshot(legacy, {
        resolveLegacyTrackId: (path) => path === "music/a.mp3" ? "a" : null,
        now: () => 500
    });
    assert("legacy state migrates into one snapshot",
        migrated.currentTrackId === "a" && migrated.position === 19.25 &&
        migrated.source.type === "search");
    assert("legacy keys are removed only after migration",
        LEGACY_PLAYER_KEYS.every((key) => legacy.getItem(key) === null) &&
        Boolean(legacy.getItem(PLAYER_SNAPSHOT_KEY)));

    const writeFailure = memoryStorage({ "player-track-id": "a" });
    writeFailure.setItem = () => { throw new Error("quota"); };
    assert("failed migration retains obsolete keys",
        migrateLegacyPlayerSnapshot(writeFailure) === null &&
        writeFailure.getItem("player-track-id") === "a");

    const reconciled = reconcilePlayerSnapshot(source, ["a", "c"], ["a", "c"]);
    assert("stale queue IDs are removed",
        JSON.stringify(reconciled.queue.ids) === JSON.stringify(["a"]));
    assert("current track keeps its recalculated queue index",
        reconciled.currentTrackId === "a" && reconciled.queue.currentIndex === 0);
    assert("stale history IDs are removed without losing duplicates",
        JSON.stringify(reconciled.history.ids) === JSON.stringify(["a", "a"]));
    assert("stale shuffle order IDs are removed",
        JSON.stringify(reconciled.shuffleOrder.ids) === JSON.stringify(["a"]));

    const removed = reconcilePlayerSnapshot(source, ["b", "c"], ["b", "c"]);
    assert("removed current track produces idle state",
        removed.currentTrackId === null && removed.position === 0 &&
        removed.duration === 0 && removed.queue.currentIndex === -1 &&
        removed.paused);

    const storage = memoryStorage();
    savePlayerSnapshot(source, { storage, now: () => 900 });
    resetPlayerSnapshot(storage);
    assert("snapshot reset invalidates persisted state",
        storage.getItem(PLAYER_SNAPSHOT_KEY) === null);

    document.body.dataset.testStatus = "passed";
    output.textContent = `${results.join("\n")}\n\n${results.length} passed`;
} catch (error) {
    document.body.dataset.testStatus = "failed";
    output.textContent = `${results.join("\n")}\nFAIL ${error.stack || error}`;
}
