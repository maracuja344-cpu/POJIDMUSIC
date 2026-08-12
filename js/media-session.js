import { getTrackCardArtwork, ARTWORK_WIDTHS } from "./artwork.js";

function clampPosition(position, duration) {
    if (!Number.isFinite(position) || !Number.isFinite(duration) || duration <= 0) {
        return null;
    }
    return Math.min(Math.max(position, 0), duration);
}

function getRuntimeMediaSessionAudit() {
    const search = globalThis.location?.search || "";
    const params = new URLSearchParams(search);
    const enabled = globalThis.__POJIDMUSIC_DEBUG__ === true ||
        params.has("media-session-debug") ||
        params.has("runtime-smoke") ||
        params.has("top-level-runtime");
    if (!enabled) return null;

    const audit = globalThis.__pojidmusicMediaSessionAudit || {
        controllerInitializations: 0,
        available: false,
        attempts: [],
        successful: [],
        failed: []
    };
    globalThis.__pojidmusicMediaSessionAudit = audit;
    return audit;
}

export function createMediaSessionController({
    mediaSession = "mediaSession" in navigator ? navigator.mediaSession : null,
    MediaMetadataClass = globalThis.MediaMetadata,
    actions,
    now = () => performance.now(),
    audit = getRuntimeMediaSessionAudit()
} = {}) {
    if (audit) {
        audit.controllerInitializations += 1;
        audit.available = Boolean(mediaSession);
    }
    if (!mediaSession) {
        return {
            available: false,
            updateMetadata() {},
            clear() {},
            syncPlaybackState() {},
            syncPosition() {}
        };
    }

    const safeAction = (name, handler) => {
        audit?.attempts.push(name);
        try {
            mediaSession.setActionHandler(name, handler);
            audit?.successful.push(name);
        } catch (error) {
            audit?.failed.push({
                name,
                error: error?.name || "Error"
            });
            // Safari and older Chromium builds expose different action subsets.
        }
    };
    const seekTo = (details) => {
        const audio = actions.getAudio();
        const position = clampPosition(Number(details?.seekTime), audio.duration);
        if (position === null) return;
        if (details?.fastSeek && typeof audio.fastSeek === "function") {
            audio.fastSeek(position);
        } else {
            audio.currentTime = position;
        }
        controller.syncPosition(audio, { force: true });
    };

    safeAction("play", () => actions.play());
    safeAction("pause", () => actions.pause());
    safeAction("nexttrack", () => actions.next());
    safeAction("previoustrack", () => actions.previous());
    safeAction("seekto", seekTo);

    let lastPositionUpdate = -Infinity;
    const controller = {
        available: true,
        updateMetadata(track) {
            if (!track || typeof MediaMetadataClass !== "function") {
                mediaSession.metadata = null;
                return;
            }
            const artwork = getTrackCardArtwork(track.cover || "");
            const entries = [
                [artwork.small, ARTWORK_WIDTHS.trackSmall],
                [artwork.card, ARTWORK_WIDTHS.trackCard],
                [artwork.recommendation, ARTWORK_WIDTHS.recommendation]
            ];
            const seen = new Set();
            const metadata = {
                title: track.title || "Без названия",
                artist: track.artist || "Неизвестный исполнитель",
                artwork: entries
                    .filter(([src]) => src && !seen.has(src) && seen.add(src))
                    .map(([src, size]) => ({ src, sizes: `${size}x${size}` }))
            };
            if (track.album) metadata.album = track.album;
            try {
                mediaSession.metadata = new MediaMetadataClass(metadata);
            } catch {
                try {
                    mediaSession.metadata = new MediaMetadataClass({
                        title: metadata.title,
                        artist: metadata.artist,
                        ...(metadata.album ? { album: metadata.album } : {})
                    });
                } catch {
                    mediaSession.metadata = null;
                }
            }
        },
        clear() {
            mediaSession.metadata = null;
            controller.syncPlaybackState("none");
            try {
                mediaSession.setPositionState?.();
            } catch {}
        },
        syncPlaybackState(state) {
            if (!("playbackState" in mediaSession)) return;
            try {
                mediaSession.playbackState = ["playing", "paused"].includes(state)
                    ? state
                    : "none";
            } catch {}
        },
        syncPosition(audio, { force = false } = {}) {
            if (typeof mediaSession.setPositionState !== "function") return;
            const timestamp = now();
            if (!force && timestamp - lastPositionUpdate < 1000) return;
            const duration = Number(audio?.duration);
            const position = clampPosition(Number(audio?.currentTime), duration);
            const playbackRate = Number(audio?.playbackRate);
            if (position === null || !Number.isFinite(playbackRate) || playbackRate <= 0) {
                return;
            }
            try {
                mediaSession.setPositionState({ duration, playbackRate, position });
                lastPositionUpdate = timestamp;
            } catch {}
        }
    };
    return controller;
}
