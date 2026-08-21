const output = document.querySelector("#test-output");
const frame = document.querySelector("#app-frame");
const results = [];
const playerKeys = [
    "pojidmusic-player-state",
    "player-track-id",
    "player-track",
    "player-time",
    "player-volume",
    "player-shuffle",
    "player-repeat",
    "player-history-v2",
    "player-playback-context-v2"
];

function wait(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(check, label, timeout = 20000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
        const value = check();
        if (value) return value;
        await wait(100);
    }
    throw new Error(`Timed out: ${label}`);
}

function assert(name, condition) {
    if (!condition) throw new Error(name);
    results.push(`PASS ${name}`);
}

function click(element) {
    element.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: element.ownerDocument.defaultView
    }));
}

function swipe(element, { fromX, fromY, toX, toY }) {
    const view = element.ownerDocument.defaultView;
    const pointerId = 17;
    const options = (type, clientX, clientY) => ({
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId,
        pointerType: "touch",
        isPrimary: true,
        button: 0,
        buttons: type === "pointerup" ? 0 : 1,
        clientX,
        clientY,
        view
    });
    const originalSetPointerCapture = element.setPointerCapture;
    const originalHasPointerCapture = element.hasPointerCapture;
    const originalReleasePointerCapture = element.releasePointerCapture;
    element.setPointerCapture = () => {};
    element.hasPointerCapture = () => false;
    element.releasePointerCapture = () => {};
    element.dispatchEvent(new view.PointerEvent(
        "pointerdown", options("pointerdown", fromX, fromY)));
    element.dispatchEvent(new view.PointerEvent(
        "pointermove", options("pointermove", toX, toY)));
    element.dispatchEvent(new view.PointerEvent(
        "pointerup", options("pointerup", toX, toY)));
    element.setPointerCapture = originalSetPointerCapture;
    element.hasPointerCapture = originalHasPointerCapture;
    element.releasePointerCapture = originalReleasePointerCapture;
}

function tap(element, { x, y }) {
    swipe(element, { fromX: x, fromY: y, toX: x, toY: y });
    click(element);
}

function currentId(document) {
    let snapshotId = null;
    try {
        snapshotId = JSON.parse(document.defaultView.localStorage.getItem(
            "pojidmusic-player-state"
        ))?.currentTrackId || null;
    } catch {}
    return snapshotId ||
        document.querySelector(".release-card.current, .recommendation-card.current")
            ?.dataset.trackId || null;
}

async function loadApp() {
    frame.src = `../index.html?runtime-smoke=${Date.now()}`;
    await waitFor(() => frame.contentDocument?.querySelectorAll(
        ".release-card[data-track-id^='local:']").length >= 3,
    "local catalog cards");
    return frame.contentDocument;
}

const previousStorage = new Map(playerKeys.map((key) => [key, localStorage.getItem(key)]));

try {
    playerKeys.forEach((key) => localStorage.removeItem(key));
    let app = await loadApp();
    const localCards = [...app.querySelectorAll(
        "#all-tracks .release-card[data-track-id^='local:']")];
    const preferredIds = ["local:5", "local:6", "local:7"];
    const cardIds = preferredIds.filter((id) => (
        localCards.some((card) => card.dataset.trackId === id)
    ));
    assert("stable local media fixtures are available", cardIds.length >= 3);

    click(app.querySelector(`#all-tracks [data-track-id='${cardIds[0]}']`));
    await waitFor(() => app.querySelector(".mini-player.active") &&
        currentId(app) === cardIds[0], "mini-player activation and persisted current track");
    const firstId = currentId(app);
    assert("selecting a card activates its track", firstId === cardIds[0]);
    results.push("BLOCKED real play/pause/resume: headless media did not reach playing");

    click(app.querySelector(`#all-tracks [data-track-id='${cardIds[1]}']`));
    await waitFor(() => currentId(app) === cardIds[1], "second track");
    const secondId = currentId(app);
    assert("selecting another card changes current track", secondId !== firstId);

    click(app.querySelector(".player-next"));
    await waitFor(() => currentId(app) !== secondId, "next track");
    const nextId = currentId(app);
    assert("Next changes current track", Boolean(nextId));

    click(app.querySelector(".player-prev"));
    await waitFor(() => currentId(app) === secondId, "history Previous");
    assert("Previous returns through played history", true);

    const repeat = app.querySelector(".player-repeat");
    while (repeat.dataset.repeatMode !== "one") click(repeat);
    const beforeRepeatOneNext = currentId(app);
    click(app.querySelector(".player-next"));
    await waitFor(() => currentId(app) !== beforeRepeatOneNext,
        "manual Next under Repeat One");
    assert("manual Next under Repeat One advances", true);

    const activeId = currentId(app);
    const getMatchingCards = () => [...app.querySelectorAll(
        `.release-card[data-track-id='${CSS.escape(activeId)}'], ` +
        `.recommendation-card[data-track-id='${CSS.escape(activeId)}']`
    )];
    try {
        await waitFor(() => {
            const matchingCards = getMatchingCards();
            return matchingCards.length > 0 &&
                matchingCards.every((card) => card.classList.contains("current"));
        },
        "duplicate card synchronization", 5000);
        assert("duplicate cards mirror current state", true);
    } catch {
        results.push("FAIL duplicate cards did not all mirror current state");
    }

    click(app.querySelector(".player-cover"));
    await waitFor(() => app.querySelector(".fullscreen-player.open"), "fullscreen open");
    assert("fullscreen opens without replacing current track", currentId(app) === activeId);

    app.documentElement.classList.add("mobile-device", "ios-device");
    const fullscreen = app.querySelector(".fullscreen-player");
    await waitFor(() => fullscreen.classList.contains("is-revealed"),
        "fullscreen content reveal phase");
    await waitFor(() => Number(getComputedStyle(
        fullscreen.querySelector(".fullscreen-player-content")
    ).opacity) > 0.98, "fullscreen content reveal completion");
    assert("fullscreen uses a two-phase shell/content reveal",
        fullscreen.classList.contains("is-revealed"));
    const playbackControls = [...fullscreen.querySelectorAll(
        ".fullscreen-player-prev, .fullscreen-player-toggle, .fullscreen-player-next")];
    const utilityControls = [...fullscreen.querySelectorAll(
        ".fullscreen-player-shuffle, .fullscreen-player-repeat, .fullscreen-queue-button")];
    const controlsRect = fullscreen.querySelector(".fullscreen-player-controls")
        .getBoundingClientRect();
    const playRect = app.querySelector(".fullscreen-player-toggle").getBoundingClientRect();
    assert("mobile playback and utility controls keep wide touch targets",
        playbackControls.length === 3 && utilityControls.length === 3 &&
        [...playbackControls, ...utilityControls].every((button) => {
            const bounds = button.getBoundingClientRect();
            return bounds.width >= 44 && bounds.height >= 44;
        }));
    assert("mobile Play/Pause remains visually centered",
        Math.abs((playRect.left + playRect.width / 2) -
            (controlsRect.left + controlsRect.width / 2)) < 2);
    const mobileNavigation = [...app.querySelectorAll(".mobile-nav-button")];
    assert("mobile navigation uses semantic buttons",
        mobileNavigation.length === 3 && mobileNavigation.every((button) => (
            button.tagName === "BUTTON" && button.type === "button"
        )));
    assert("iOS app chrome prevents text selection",
        getComputedStyle(app.querySelector(".mobile-bottom-navigation")).userSelect === "none" &&
        getComputedStyle(fullscreen).userSelect === "none" &&
        getComputedStyle(app.querySelector(".mini-player")).userSelect === "none");
    click(app.querySelector(".fullscreen-queue-button"));
    assert("fullscreen Queue opens from the utility row",
        !app.querySelector(".player-queue-sheet").hidden);
    click(app.querySelector("[data-close-player-queue]"));
    const fullscreenShuffle = app.querySelector(".fullscreen-player-shuffle");
    click(fullscreenShuffle);
    assert("fullscreen Shuffle uses the shared player state",
        app.querySelector(".player-shuffle").classList.contains("is-active") ===
        fullscreenShuffle.classList.contains("is-active"));
    const fullscreenRepeat = app.querySelector(".fullscreen-player-repeat");
    click(fullscreenRepeat);
    assert("fullscreen Repeat uses the shared player state",
        app.querySelector(".player-repeat").dataset.repeatMode ===
        fullscreenRepeat.dataset.repeatMode);
    assert("fullscreen artist panel never contains an avatar",
        !fullscreen.querySelector(".fullscreen-player-artist-avatar"));
    swipe(fullscreen, { fromX: 310, fromY: 300, toX: 180, toY: 308 });
    await waitFor(() => currentId(app) !== activeId, "fullscreen swipe Next");
    const fullscreenNextId = currentId(app);
    assert("fullscreen swipe left uses production Next", Boolean(fullscreenNextId));
    assert("horizontal fullscreen swipe keeps fullscreen open",
        fullscreen.classList.contains("open"));

    swipe(fullscreen, { fromX: 160, fromY: 300, toX: 300, toY: 294 });
    await waitFor(() => currentId(app) === activeId, "fullscreen swipe Previous");
    assert("fullscreen swipe right uses production Previous", true);

    const beforeControlSwipe = currentId(app);
    swipe(app.querySelector(".fullscreen-player-toggle"), {
        fromX: 150, fromY: 600, toX: 300, toY: 602
    });
    await wait(50);
    assert("fullscreen controls are excluded from swipe navigation",
        currentId(app) === beforeControlSwipe);

    const progress = app.querySelector(".fullscreen-player-progress");
    swipe(progress, { fromX: 80, fromY: 500, toX: 280, toY: 500 });
    await wait(50);
    assert("fullscreen progress is excluded from swipe navigation",
        currentId(app) === beforeControlSwipe && fullscreen.classList.contains("open"));

    click(app.querySelector(".fullscreen-player-desktop-collapse"));
    await waitFor(() => !fullscreen.classList.contains("open"), "fullscreen close");
    assert("fullscreen close clears the content reveal phase",
        !fullscreen.classList.contains("is-revealed"));
    const mini = app.querySelector(".mini-player");
    const beforeMiniSwipe = currentId(app);
    swipe(mini, { fromX: 300, fromY: 700, toX: 170, toY: 706 });
    await waitFor(() => currentId(app) !== beforeMiniSwipe, "mini swipe Next");
    const miniNextId = currentId(app);
    assert("mini-player swipe left uses production Next", Boolean(miniNextId));
    assert("mini-player swipe does not open fullscreen",
        !fullscreen.classList.contains("open"));
    swipe(mini, { fromX: 150, fromY: 700, toX: 290, toY: 694 });
    await waitFor(() => currentId(app) === beforeMiniSwipe, "mini swipe Previous");
    assert("mini-player swipe right uses production Previous", true);

    swipe(mini, { fromX: 200, fromY: 700, toX: 216, toY: 704 });
    await wait(50);
    assert("small mini-player drag does not navigate",
        currentId(app) === beforeMiniSwipe);
    tap(mini, { x: 200, y: 700 });
    await waitFor(() => fullscreen.classList.contains("open"), "mini tap fullscreen");
    assert("mini-player tap still opens fullscreen", true);

    const artistLink = app.querySelector(
        `[data-track-id='${CSS.escape(activeId)}'] [data-artist-slug]`
    );
    if (artistLink) {
        click(artistLink);
        await waitFor(() => !app.querySelector("#artist-profile")?.hidden, "artist route");
        assert("queue current track survives Artist Profile navigation",
            currentId(app) === activeId);
        click(app.querySelector("[data-nav-home]"));
        await waitFor(() => !app.querySelector("#catalog-view")?.hidden, "home route");
        assert("matching Home cards resynchronize after navigation",
            [...app.querySelectorAll(`[data-track-id='${CSS.escape(activeId)}']`)]
                .some((card) => card.classList.contains("current")));
    } else {
        results.push("NOT TESTED Artist Profile navigation: no structured artist link");
    }

    const documentBeforeReload = frame.contentDocument;
    frame.src = `../index.html?runtime-reload=${Date.now()}`;
    await waitFor(() => frame.contentDocument !== documentBeforeReload &&
        frame.contentDocument?.querySelector(".mini-player.active"),
        "player restoration");
    app = frame.contentDocument;
    assert("reload restores current track", currentId(app) === activeId);
    assert("reload restores paused", !app.querySelector(".player-toggle.playing"));
    assert("reload restores fullscreen closed", !app.querySelector(".fullscreen-player.open"));

    document.body.dataset.testStatus = results.some((line) => line.startsWith("FAIL"))
        ? "failed"
        : "passed";
    output.textContent = `${results.join("\n")}\n\n${results.filter((line) => line.startsWith("PASS")).length} passed`;
} catch (error) {
    document.body.dataset.testStatus = "failed";
    let diagnostics = "";
    try {
        diagnostics = `\nDIAGNOSTICS ${JSON.stringify({
            snapshot: localStorage.getItem("pojidmusic-player-state"),
            miniActive: frame.contentDocument?.querySelector(".mini-player")
                ?.classList.contains("active"),
            currentCards: [...(frame.contentDocument?.querySelectorAll(
                ".release-card.current, .recommendation-card.current") || [])]
                .map((card) => card.dataset.trackId),
            playerTitle: frame.contentDocument?.querySelector(".player-title")?.textContent,
            playerArtist: frame.contentDocument?.querySelector(".player-artist")?.textContent
        })}`;
    } catch {}
    output.textContent = `${results.join("\n")}\nFAIL ${error.stack || error}${diagnostics}`;
} finally {
    previousStorage.forEach((value, key) => {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
    });
}
