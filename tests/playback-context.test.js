const STORAGE_KEY = "pojidmusic-player-state";
const previousStorage = localStorage.getItem(STORAGE_KEY);
const output = document.querySelector("#test-output");
const results = [];

function assert(name, condition, detail = "") {
    if (!condition) {
        throw new Error(`${name}${detail ? `: ${detail}` : ""}`);
    }
    results.push(`PASS ${name}`);
}

function sameValues(actual, expected) {
    return JSON.stringify(actual) === JSON.stringify(expected);
}

try {
    localStorage.removeItem(STORAGE_KEY);
    const moduleUrl = new URL("../js/playback-context.js", import.meta.url);
    moduleUrl.searchParams.set("test", String(Date.now()));
    const context = await import(moduleUrl.href);

    let changeEvents = 0;
    window.addEventListener("playbackcontextchange", () => {
        changeEvents += 1;
    });

    const normalized = context.setPlaybackContext({
        type: "search",
        id: "search:test",
        label: "Test",
        queueIds: ["track:a", "track:a", "", "track:b"],
        currentIndex: 3
    });
    assert("deduplicates and removes empty queue IDs",
        sameValues(normalized.queueIds, ["track:a", "track:b"]));
    assert("invalid post-normalization index becomes -1",
        normalized.currentIndex === -1);
    assert("set context dispatches a change event", changeEvents === 1);

    const selected = context.setPlaybackContextCurrent("track:b");
    assert("selects current index by catalog ID", selected.currentIndex === 1);
    assert("current selection persists", JSON.parse(
        localStorage.getItem(STORAGE_KEY)).queue.currentIndex === 1);

    const reconciled = context.reconcilePlaybackContext(["track:b"]);
    assert("reconcile removes catalog-missing IDs",
        sameValues(reconciled.queueIds, ["track:b"]));
    assert("reconcile preserves current ID and moves its index",
        reconciled.currentIndex === 0);

    context.setPlaybackContext({
        type: "catalog",
        queueIds: [],
        currentIndex: -1
    });
    const fallback = context.reconcilePlaybackContext(
        ["track:a", "track:b"],
        ["track:b", "track:a"]
    );
    assert("empty catalog context repopulates from catalog order",
        sameValues(fallback.queueIds, ["track:b", "track:a"]));

    context.setPlaybackContext({
        type: "artist",
        queueIds: [],
        currentIndex: -1
    });
    const finiteSource = context.reconcilePlaybackContext(
        ["track:a", "track:b"],
        ["track:b", "track:a"]
    );
    assert("empty non-catalog source remains empty",
        finiteSource.queueIds.length === 0);

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    assert("source type persists", stored.source.type === "artist");
    assert("queue persists", Array.isArray(stored.queue.ids));

    document.body.dataset.testStatus = "passed";
    output.textContent = `${results.join("\n")}\n\n${results.length} passed`;
} catch (error) {
    document.body.dataset.testStatus = "failed";
    output.textContent = `${results.join("\n")}\nFAIL ${error.stack || error}`;
} finally {
    if (previousStorage === null) {
        localStorage.removeItem(STORAGE_KEY);
    } else {
        localStorage.setItem(STORAGE_KEY, previousStorage);
    }
}
