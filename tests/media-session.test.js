import { createMediaSessionController } from "../js/media-session.js";

const output = document.querySelector("#test-output");
const results = [];
function assert(name, condition) {
    if (!condition) throw new Error(name);
    results.push(`PASS ${name}`);
}

try {
    const handlers = new Map();
    const positions = [];
    const mediaSession = {
        metadata: null,
        playbackState: "none",
        setActionHandler: (name, handler) => handlers.set(name, handler),
        setPositionState: (state) => positions.push(state)
    };
    class Metadata {
        constructor(value) { Object.assign(this, value); }
    }
    const calls = [];
    const audio = { currentTime: 30, duration: 120, playbackRate: 1 };
    let clock = 1000;
    const controller = createMediaSessionController({
        mediaSession,
        MediaMetadataClass: Metadata,
        now: () => clock,
        actions: {
            getAudio: () => audio,
            play: () => calls.push("play"),
            pause: () => calls.push("pause"),
            next: () => calls.push("next"),
            previous: () => calls.push("previous")
        }
    });

    controller.updateMetadata({
        title: "Track", artist: "Artist", cover: "/img/cover.jpg"
    });
    assert("metadata is set", mediaSession.metadata.title === "Track" &&
        mediaSession.metadata.artist === "Artist");
    assert("metadata artwork uses the current artwork system",
        mediaSession.metadata.artwork.length === 1 &&
        mediaSession.metadata.artwork[0].src === "/img/cover.jpg");
    controller.updateMetadata({ title: "Next", artist: "Artist 2", cover: "/img/2.jpg" });
    assert("metadata updates on track change", mediaSession.metadata.title === "Next");

    handlers.get("play")();
    handlers.get("pause")();
    handlers.get("nexttrack")();
    handlers.get("previoustrack")();
    assert("core action handlers use supplied player actions",
        calls.join(",") === "play,pause,next,previous");

    handlers.get("seekto")({ seekTime: 55 });
    assert("seekto updates the shared audio", audio.currentTime === 55);
    handlers.get("seekbackward")({ seekOffset: 5 });
    handlers.get("seekforward")({ seekOffset: 15 });
    assert("relative seek handlers clamp shared audio", audio.currentTime === 65);

    controller.syncPosition(audio, { force: true });
    assert("valid position state is synchronized",
        positions.at(-1).duration === 120 && positions.at(-1).position === 65);
    const positionCount = positions.length;
    audio.duration = NaN;
    controller.syncPosition(audio, { force: true });
    assert("invalid duration is rejected", positions.length === positionCount);
    audio.duration = 120;
    clock += 500;
    controller.syncPosition(audio);
    assert("position updates are throttled", positions.length === positionCount);

    controller.syncPlaybackState("playing");
    assert("playback state synchronizes", mediaSession.playbackState === "playing");
    controller.clear();
    assert("clearing track resets metadata and playback state",
        mediaSession.metadata === null && mediaSession.playbackState === "none");

    const fallback = createMediaSessionController({ mediaSession: null });
    fallback.updateMetadata({ title: "Ignored" });
    fallback.syncPosition(audio);
    assert("no API fallback is inert", fallback.available === false);

    document.body.dataset.testStatus = "passed";
    output.textContent = `${results.join("\n")}\n\n${results.length} passed`;
} catch (error) {
    document.body.dataset.testStatus = "failed";
    output.textContent = `${results.join("\n")}\nFAIL ${error.stack || error}`;
}
