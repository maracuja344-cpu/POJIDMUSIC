import {
    buildShuffleOrder,
    getHistoryDecision,
    getQueuePerspectiveIds,
    getSequentialQueueId,
    getShuffleDecision,
    reconcileQueueSnapshot,
    reconcileShuffleOrder,
    shouldRepeatCurrentTrack
} from "../js/queue-decisions.js";

const output = document.querySelector("#test-output");
const results = [];

function assert(name, condition) {
    if (!condition) throw new Error(name);
    results.push(`PASS ${name}`);
}

function sequential(overrides = {}) {
    return getSequentialQueueId({
        queueIds: ["a", "b", "c"],
        currentId: "b",
        direction: 1,
        repeatMode: "off",
        ...overrides
    });
}

function history(overrides = {}) {
    return getHistoryDecision({
        historyIds: ["a", "b", "c"],
        historyIndex: 1,
        direction: -1,
        validIds: ["a", "b", "c"],
        ...overrides
    });
}

function shuffle(overrides = {}) {
    return getShuffleDecision({
        queueIds: ["a", "b", "c"],
        currentId: "a",
        direction: 1,
        repeatMode: "off",
        historyIds: ["a"],
        historyIndex: 0,
        validHistoryIds: ["a", "b", "c"],
        cycleIds: ["a"],
        random: () => 0,
        ...overrides
    });
}

try {
    assert("normal Next selects the following queue ID", sequential() === "c");
    assert("last queue item with Repeat Off has no sequential target",
        sequential({ currentId: "c" }) === null);
    assert("last queue item with Repeat All wraps to first",
        sequential({ currentId: "c", repeatMode: "all" }) === "a");
    assert("normal previous selects the preceding queue ID",
        sequential({ direction: -1 }) === "a");
    assert("first queue item with Repeat Off has no previous target",
        sequential({ currentId: "a", direction: -1 }) === null);
    assert("first queue item with Repeat All wraps to last",
        sequential({ currentId: "a", direction: -1, repeatMode: "all" }) === "c");
    assert("Repeat One does not change manual sequential Next",
        sequential({ repeatMode: "one" }) === "c");
    assert("natural ended under Repeat One repeats current",
        shouldRepeatCurrentTrack({
            reason: "ended", fromError: false, repeatMode: "one", currentId: "b"
        }));
    assert("manual Next under Repeat One does not repeat current",
        !shouldRepeatCurrentTrack({
            reason: "manual", fromError: false, repeatMode: "one", currentId: "b"
        }));
    assert("one-item queue under Repeat Off reaches boundary",
        sequential({ queueIds: ["a"], currentId: "a" }) === null);
    assert("one-item queue under Repeat All returns its only ID",
        sequential({ queueIds: ["a"], currentId: "a", repeatMode: "all" }) === "a");
    assert("empty queue returns no target",
        sequential({ queueIds: [], currentId: null }) === null);
    assert("missing current ID falls back to first queue ID",
        sequential({ currentId: "stale" }) === "a");

    assert("Queue perspective starts with current and keeps only the real future",
        JSON.stringify(getQueuePerspectiveIds({
            queueIds: ["a", "b", "c", "d"],
            currentId: "c",
            repeatMode: "off"
        })) === JSON.stringify(["c", "d"]));
    assert("Repeat All Queue perspective includes the real wrapped future",
        JSON.stringify(getQueuePerspectiveIds({
            queueIds: ["a", "b", "c", "d"],
            currentId: "c",
            repeatMode: "all"
        })) === JSON.stringify(["c", "d", "a", "b"]));

    assert("Previous uses backward history", history().catalogId === "a");
    assert("forward history returns its cursor",
        history({ direction: 1 }).catalogId === "c" &&
        history({ direction: 1 }).historyIndex === 2);
    assert("history boundary returns no decision",
        history({ historyIndex: 0 }).catalogId === null);
    assert("stale history ID is rejected",
        history({ validIds: ["b", "c"] }).catalogId === null);

    assert("shuffle selects a deterministic unvisited candidate",
        shuffle().catalogId === "b");
    assert("shuffle uses forward history before candidates",
        shuffle({ historyIds: ["a", "c"], historyIndex: 0 }).catalogId === "c");
    assert("shuffle skips stale forward history",
        shuffle({
            historyIds: ["a", "stale"], historyIndex: 0,
            validHistoryIds: ["a", "b", "c"]
        }).catalogId === "b");
    assert("exhausted shuffle with Repeat Off reaches boundary",
        shuffle({ cycleIds: ["a", "b", "c"] }).catalogId === null);
    const repeatedShuffle = shuffle({
        repeatMode: "all",
        cycleIds: ["a", "b", "c"]
    });
    assert("exhausted shuffle with Repeat All starts a new cycle",
        repeatedShuffle.catalogId === "b" &&
        JSON.stringify(repeatedShuffle.cycleIds) === JSON.stringify(["a"]));
    assert("one-item shuffle under Repeat Off reaches boundary",
        shuffle({ queueIds: ["a"] }).catalogId === null);
    assert("one-item shuffle under Repeat All returns current",
        shuffle({ queueIds: ["a"], repeatMode: "all" }).catalogId === "a");

    const materialized = buildShuffleOrder({
        queueIds: ["a", "b", "c", "d"],
        currentId: "c",
        random: () => 0
    });
    assert("materialized shuffle keeps current track as the anchor",
        materialized[0] === "c");
    assert("materialized shuffle contains each canonical queue ID once",
        JSON.stringify([...materialized].sort()) === JSON.stringify(["a", "b", "c", "d"]));
    const restoredOrder = reconcileShuffleOrder({
        orderIds: ["c", "stale", "a"],
        queueIds: ["a", "b", "c"],
        currentId: "c"
    });
    assert("shuffle order drops stale IDs and appends new tracks",
        JSON.stringify(restoredOrder) === JSON.stringify(["c", "a", "b"]));
    const migratedOrder = reconcileShuffleOrder({
        orderIds: [],
        queueIds: ["a", "b", "c"],
        currentId: "b",
        random: () => 0
    });
    assert("missing persisted shuffle order is rebuilt around current",
        migratedOrder[0] === "b" && migratedOrder.length === 3);

    const reconciled = reconcileQueueSnapshot({
        queueIds: ["stale", "b", "c"],
        currentIndex: 1,
        sourceType: "artist",
        validIds: ["b", "c"],
        catalogIds: ["c", "b"]
    });
    assert("reconciliation removes invalid IDs",
        JSON.stringify(reconciled.queueIds) === JSON.stringify(["b", "c"]));
    assert("reconciliation preserves current ID index", reconciled.currentIndex === 0);
    const catalogFallback = reconcileQueueSnapshot({
        queueIds: ["stale"],
        currentIndex: 0,
        sourceType: "catalog",
        validIds: ["a", "b"],
        catalogIds: ["b", "a", "stale"]
    });
    assert("empty reconciled catalog uses current catalog order",
        JSON.stringify(catalogFallback.queueIds) === JSON.stringify(["b", "a"]));

    document.body.dataset.testStatus = "passed";
    output.textContent = `${results.join("\n")}\n\n${results.length} passed`;
} catch (error) {
    document.body.dataset.testStatus = "failed";
    output.textContent = `${results.join("\n")}\nFAIL ${error.stack || error}`;
}
