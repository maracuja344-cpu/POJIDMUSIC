import {
    createTrackAudioResolver,
    shouldRetrySignedAudioError
} from "../js/audio-url-resolver-core.js";
import { isPlayableRelease } from "../js/tracks-utils.js";

const output = document.querySelector("#test-output");
const results = [];

function assert(name, condition) {
    if (!condition) throw new Error(name);
    results.push(`PASS ${name}`);
}

function remote(id, overrides = {}) {
    return Object.freeze({
        catalogId: `supabase:${id}`,
        source: "supabase",
        type: "release",
        storageAudioPath: `${id}.mp3`,
        audio: "",
        audioExpiresAt: null,
        ...overrides
    });
}

async function expectReject(promise) {
    try {
        await promise;
        return false;
    } catch {
        return true;
    }
}

try {
    let now = 1_000_000;
    let signCount = 0;
    const resolver = createTrackAudioResolver({
        now: () => now,
        signAudioPath: async (path) => ({
            signedUrl: `https://audio.test/${path}?sign=${++signCount}`,
            expiresAt: now + 3_600_000
        })
    });

    const local = Object.freeze({ source: "local", audio: "music/local.mp3" });
    assert("static/local URL is returned unchanged", await resolver.resolve(local) === local);
    assert("remote metadata is playable before signing", isPlayableRelease(remote("metadata")));
    assert("local metadata still requires a static URL", !isPlayableRelease({
        source: "local", type: "release", audio: ""
    }));

    const firstRemote = remote("first");
    const firstResolved = await resolver.resolve(firstRemote);
    assert("remote URL is resolved lazily", !firstRemote.audio &&
        firstResolved.audio.includes("first.mp3") && signCount === 1);

    const cached = await resolver.resolve(firstRemote);
    assert("cache hit avoids a second signing request", cached.audio === firstResolved.audio &&
        signCount === 1 && resolver.getStats().hits === 1);

    let releaseShared;
    let sharedSigns = 0;
    const sharedResolver = createTrackAudioResolver({
        now: () => now,
        signAudioPath: () => {
            sharedSigns += 1;
            return new Promise((resolve) => { releaseShared = resolve; });
        }
    });
    const sharedTrack = remote("shared");
    const firstShared = sharedResolver.resolve(sharedTrack);
    const secondShared = sharedResolver.resolve(sharedTrack);
    await Promise.resolve();
    releaseShared({ signedUrl: "https://audio.test/shared", expiresAt: now + 3_600_000 });
    const sharedResults = await Promise.all([firstShared, secondShared]);
    assert("in-flight signing is deduplicated", sharedSigns === 1 &&
        sharedResults[0].audio === sharedResults[1].audio);

    const expired = remote("expired", {
        audio: "https://audio.test/old",
        audioExpiresAt: now + 30_000
    });
    const refreshedExpired = await resolver.resolve(expired);
    assert("expired URL is replaced", refreshedExpired.audio !== expired.audio && signCount === 2);

    resolver.invalidate(firstRemote);
    await resolver.resolve(firstRemote);
    assert("path invalidation forces a new signature", signCount === 3);

    let failingSigns = 0;
    const retryResolver = createTrackAudioResolver({
        now: () => now,
        signAudioPath: async () => {
            failingSigns += 1;
            if (failingSigns === 1) throw new Error("expected signing failure");
            return { signedUrl: "https://audio.test/recovered", expiresAt: now + 3_600_000 };
        }
    });
    assert("failed signing rejects", await expectReject(retryResolver.resolve(remote("retry"))));
    const retried = await retryResolver.refresh(remote("retry"));
    assert("one explicit retry can recover", retried.audio.endsWith("recovered") && failingSigns === 2);
    assert("audio retry is limited to signed URL network/source errors",
        shouldRetrySignedAudioError({ track: remote("media"), errorCode: 2 }) &&
        shouldRetrySignedAudioError({ track: remote("media"), errorCode: 4 }) &&
        !shouldRetrySignedAudioError({ track: remote("media"), errorCode: 3 }) &&
        !shouldRetrySignedAudioError({ track: local, errorCode: 2 }) &&
        !shouldRetrySignedAudioError({
            track: remote("media"), errorCode: 2, retryAlreadyUsed: true
        }));

    const releases = new Map();
    let raceSigns = 0;
    const raceResolver = createTrackAudioResolver({
        now: () => now,
        signAudioPath: (path) => {
            raceSigns += 1;
            return new Promise((resolve) => releases.set(path, resolve));
        }
    });
    let requestVersion = 0;
    let committedId = null;
    const requestPlay = async (track) => {
        const version = ++requestVersion;
        const resolved = await raceResolver.resolve(track);
        if (version === requestVersion) committedId = resolved.catalogId;
    };
    const playA = requestPlay(remote("a"));
    const playB = requestPlay(remote("b"));
    await Promise.resolve();
    releases.get("b.mp3")({ signedUrl: "https://audio.test/b", expiresAt: now + 3_600_000 });
    await playB;
    releases.get("a.mp3")({ signedUrl: "https://audio.test/a", expiresAt: now + 3_600_000 });
    await playA;
    assert("stale Play A cannot replace newer Play B", committedId === "supabase:b");

    const sameTrack = remote("same");
    const sameFirst = requestPlay(sameTrack);
    const sameSecond = requestPlay(sameTrack);
    await Promise.resolve();
    releases.get("same.mp3")({ signedUrl: "https://audio.test/same", expiresAt: now + 3_600_000 });
    await Promise.all([sameFirst, sameSecond]);
    assert("repeated Play shares signing and commits only the latest request",
        raceSigns === 3 && committedId === "supabase:same");

    document.body.dataset.testStatus = "passed";
    output.textContent = `${results.length} PASS\n${results.join("\n")}`;
} catch (error) {
    document.body.dataset.testStatus = "failed";
    output.textContent = `${results.length} PASS\nFAIL ${error.message}\n${error.stack || ""}`;
    throw error;
}
