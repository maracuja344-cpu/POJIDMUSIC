import { createMemoryDataCache } from "./data-cache.js";
import { supabase } from "./supabase/client.js";

export const DATA_CACHE_POLICY = Object.freeze({
    profile: Object.freeze({
        ttlMs: 60 * 1000,
        staleWhileRevalidateMs: 4 * 60 * 1000
    }),
    artist: Object.freeze({
        ttlMs: 5 * 60 * 1000,
        staleWhileRevalidateMs: 25 * 60 * 1000
    }),
    catalog: Object.freeze({
        ttlMs: 60 * 1000,
        staleWhileRevalidateMs: 0
    })
});

const ARTIST_COLUMNS = [
    "id,display_name,normalized_name,slug,avatar_url,banner_url,avatar_path,banner_path,bio,linked_profile_id,updated_at,avatar_focal_x,avatar_focal_y,avatar_zoom,banner_focal_x,banner_focal_y,banner_zoom",
    "id,display_name,normalized_name,slug,avatar_url,banner_url,avatar_path,banner_path,bio,linked_profile_id,updated_at",
    "id,display_name,normalized_name,slug,avatar_url,banner_url,bio,linked_profile_id,updated_at"
];

const cache = createMemoryDataCache({
    valuesEqual: (left, right) => (
        JSON.stringify(left) === JSON.stringify(right)
    ),
    onBackgroundError: (error) => {
        console.warn(
            "Не удалось обновить данные в memory cache.",
            error instanceof Error ? error.message : error
        );
    }
});

function profileKey(profileId) {
    return `profile:${profileId}`;
}

function artistKey(column, value) {
    return `artist:${column}:${value}`;
}

export async function getProfileById(profileId, {
    force = false,
    onUpdate
} = {}) {
    if (!profileId) return null;

    return cache.get(
        profileKey(profileId),
        async () => {
            const { data, error } = await supabase
                .from("profiles")
                .select("id, username, display_name, avatar_url, role")
                .eq("id", profileId)
                .maybeSingle();

            if (error) throw error;
            return data ?? null;
        },
        {
            ...DATA_CACHE_POLICY.profile,
            force,
            onUpdate
        }
    );
}

export async function getArtistRow(column, value, {
    force = false,
    onUpdate
} = {}) {
    if (!value || !["slug", "linked_profile_id"].includes(column)) {
        return null;
    }

    return cache.get(
        artistKey(column, value),
        async () => {
            let lastError = null;

            for (const columns of ARTIST_COLUMNS) {
                const result = await supabase
                    .from("artists")
                    .select(columns)
                    .eq(column, value)
                    .maybeSingle();

                if (!result.error) return result.data ?? null;
                lastError = result.error;
            }

            throw lastError || new Error("Не удалось загрузить артиста.");
        },
        {
            ...DATA_CACHE_POLICY.artist,
            force,
            onUpdate
        }
    );
}

export function invalidateProfileData(profileId) {
    if (!profileId) return 0;
    return cache.invalidate(profileKey(profileId));
}

export function invalidateArtistData() {
    return cache.invalidate((key) => key.startsWith("artist:"));
}

export function clearUserScopedData() {
    return cache.invalidate((key) => (
        key.startsWith("profile:") ||
        key.startsWith("artist:linked_profile_id:")
    ));
}

export function getDataRepositoryStats() {
    return cache.getStats();
}
