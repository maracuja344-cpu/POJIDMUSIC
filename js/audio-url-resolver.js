import {
    AUDIO_SIGNED_URL_TTL_SECONDS,
    createTrackAudioResolver,
    shouldRetrySignedAudioError
} from "./audio-url-resolver-core.js";

export { shouldRetrySignedAudioError };

const AUDIO_BUCKET = "track-audio";
let supabasePromise = null;

async function getSupabase() {
    supabasePromise ||= import("./supabase/client.js")
        .then(({ supabase }) => supabase);
    return supabasePromise;
}

const resolver = createTrackAudioResolver({
    ttlSeconds: AUDIO_SIGNED_URL_TTL_SECONDS,
    async signAudioPath(path, ttlSeconds) {
        const supabase = await getSupabase();
        const { data, error } = await supabase.storage
            .from(AUDIO_BUCKET)
            .createSignedUrl(path, ttlSeconds);

        if (error || !data?.signedUrl) {
            throw error || new Error("Failed to create a signed audio URL.");
        }

        return {
            signedUrl: data.signedUrl,
            expiresAt: Date.now() + ttlSeconds * 1000
        };
    }
});

export const resolveTrackAudio = resolver.resolve;
export const refreshTrackAudio = resolver.refresh;
export const prefetchTrackAudio = resolver.prefetch;
export const invalidateSignedAudioPath = resolver.invalidate;
export const getSignedAudioCacheStats = resolver.getStats;
