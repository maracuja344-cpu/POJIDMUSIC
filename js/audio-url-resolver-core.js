import { createMemoryDataCache } from "./data-cache.js";

export const AUDIO_SIGNED_URL_TTL_SECONDS = 60 * 60;
export const AUDIO_SIGNED_URL_REUSE_LEEWAY_MS = 60 * 1000;

function getNonEmptyString(value) {
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getAudioPath(track) {
    return getNonEmptyString(track?.storageAudioPath);
}

export function shouldRetrySignedAudioError({
    track,
    errorCode,
    recoveryPending = false,
    retryAlreadyUsed = false
}) {
    return (
        track?.source === "supabase" &&
        Boolean(getAudioPath(track)) &&
        (errorCode === 2 || errorCode === 4) &&
        !recoveryPending &&
        !retryAlreadyUsed
    );
}

export function createTrackAudioResolver({
    signAudioPath,
    now = () => Date.now(),
    ttlSeconds = AUDIO_SIGNED_URL_TTL_SECONDS,
    reuseLeewayMs = AUDIO_SIGNED_URL_REUSE_LEEWAY_MS
} = {}) {
    if (typeof signAudioPath !== "function") {
        throw new TypeError("Audio URL resolver requires signAudioPath.");
    }

    const cache = createMemoryDataCache({ now });
    const cacheTtlMs = Math.max(0, ttlSeconds * 1000 - reuseLeewayMs);
    const isReusable = (value) => (
        Boolean(getNonEmptyString(value?.signedUrl)) &&
        Number(value?.expiresAt) > now() + reuseLeewayMs
    );

    async function loadSignedAudio(path) {
        const result = await signAudioPath(path, ttlSeconds);
        const signedUrl = getNonEmptyString(result?.signedUrl ?? result?.url);
        const expiresAt = Number(result?.expiresAt) || now() + ttlSeconds * 1000;

        if (!signedUrl || expiresAt <= now() + reuseLeewayMs) {
            throw new Error("Signed audio URL is missing or already expired.");
        }

        return Object.freeze({ signedUrl, expiresAt });
    }

    async function getSignedAudio(path, { force = false } = {}) {
        const key = `audio:${path}`;
        const cached = cache.peek(key);
        if (cached && !isReusable(cached)) cache.invalidate(key);

        let signedAudio = await cache.get(
            key,
            () => loadSignedAudio(path),
            { ttlMs: cacheTtlMs, force }
        );

        if (!isReusable(signedAudio)) {
            cache.invalidate(key);
            signedAudio = await cache.get(
                key,
                () => loadSignedAudio(path),
                { ttlMs: cacheTtlMs, force: true }
            );
        }

        return signedAudio;
    }

    async function resolve(track, { force = false } = {}) {
        if (!track || typeof track !== "object") {
            throw new TypeError("A track is required to resolve audio.");
        }

        if (track.source !== "supabase") {
            if (!getNonEmptyString(track.audio)) {
                throw new Error("Static track has no playable audio URL.");
            }
            return track;
        }

        const path = getAudioPath(track);
        if (!path) throw new Error("Supabase track has no audio storage path.");

        const existing = {
            signedUrl: getNonEmptyString(track.audio),
            expiresAt: Number(track.audioExpiresAt) || 0
        };
        const key = `audio:${path}`;

        if (!force && isReusable(existing)) {
            const cached = cache.peek(key);
            if (!isReusable(cached) || cached.signedUrl !== existing.signedUrl) {
                cache.set(key, Object.freeze(existing));
            }
        }

        const signedAudio = await getSignedAudio(path, { force });
        if (
            track.audio === signedAudio.signedUrl &&
            track.audioExpiresAt === signedAudio.expiresAt
        ) {
            return track;
        }

        return Object.freeze({
            ...track,
            audio: signedAudio.signedUrl,
            audioExpiresAt: signedAudio.expiresAt
        });
    }

    function invalidate(pathOrTrack) {
        const path = typeof pathOrTrack === "string"
            ? getNonEmptyString(pathOrTrack)
            : getAudioPath(pathOrTrack);
        return path ? cache.invalidate(`audio:${path}`) : 0;
    }

    async function refresh(track) {
        invalidate(track);
        return resolve(track, { force: true });
    }

    async function prefetch(track) {
        await resolve(track);
    }

    return Object.freeze({
        resolve,
        refresh,
        prefetch,
        invalidate,
        getStats: cache.getStats
    });
}
