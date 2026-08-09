import { supabase } from "./supabase/client.js";
import { parseLegacyArtistCredit } from "./artist-utils.js";

const AUDIO_BUCKET = "track-audio";
const COVER_BUCKET = "track-covers";
const ARTIST_MEDIA_BUCKET = "artist-media";
const AUDIO_SIGNED_URL_TTL_SECONDS = 60 * 60;
const AUDIO_SIGNED_URL_REUSE_LEEWAY_MS = 60 * 1000;
const FALLBACK_COVER = "img/cover.jpg";
const RELEASE_TYPES = new Set(["demo", "single", "album_track"]);
const TRACK_COLUMNS = [
    "id",
    "owner_id",
    "title",
    "artist_name",
    "description",
    "cover_path",
    "audio_path",
    "release_type",
    "release_date",
    "created_at",
    "status"
].join(",");
const TRACK_COLUMNS_WITH_ARTIST_MEDIA = [
    TRACK_COLUMNS,
    "track_artists(role,position,artist:artists(id,display_name,normalized_name,slug,avatar_url,banner_url,avatar_path,banner_path,bio,linked_profile_id,updated_at,avatar_focal_x,avatar_focal_y,avatar_zoom,banner_focal_x,banner_focal_y,banner_zoom))"
].join(",");
const TRACK_COLUMNS_WITH_ARTIST_MEDIA_LEGACY = [
    TRACK_COLUMNS,
    "track_artists(role,position,artist:artists(id,display_name,normalized_name,slug,avatar_url,banner_url,avatar_path,banner_path,bio,linked_profile_id,updated_at))"
].join(",");
const TRACK_COLUMNS_WITH_ARTISTS = [
    TRACK_COLUMNS,
    "track_artists(role,position,artist:artists(id,display_name,normalized_name,slug,avatar_url,banner_url,bio,linked_profile_id,updated_at))"
].join(",");

function getNonEmptyString(value) {
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getRowValidationError(row) {
    if (!row || typeof row !== "object") return "получена некорректная запись";
    if (!getNonEmptyString(row.id)) return "отсутствует id";
    if (row.status !== "published") return "трек не опубликован";
    if (!getNonEmptyString(row.title)) return "отсутствует title";
    if (!getNonEmptyString(row.artist_name)) return "отсутствует artist_name";
    if (!getNonEmptyString(row.cover_path)) return "отсутствует cover_path";
    if (!getNonEmptyString(row.audio_path)) return "отсутствует audio_path";
    if (!RELEASE_TYPES.has(row.release_type)) return "неизвестный release_type";
    return null;
}

function warnSkippedTrack(row, reason) {
    const id = getNonEmptyString(row?.id) ?? "unknown";
    console.warn(`Supabase-трек ${id} пропущен: ${reason}.`);
}

function getCoverUrl(coverPath) {
    const { data } = supabase.storage.from(COVER_BUCKET).getPublicUrl(coverPath);
    const publicUrl = getNonEmptyString(data?.publicUrl);

    if (!publicUrl) return null;

    try {
        const parsedUrl = new URL(publicUrl);
        return ["http:", "https:"].includes(parsedUrl.protocol)
            ? publicUrl
            : null;
    } catch {
        return null;
    }
}

function getArtistMediaUrl(path, fallbackUrl, updatedAt) {
    const storagePath = getNonEmptyString(path);
    if (!storagePath) return getNonEmptyString(fallbackUrl) ?? "";

    const { data } = supabase.storage
        .from(ARTIST_MEDIA_BUCKET)
        .getPublicUrl(storagePath);
    const publicUrl = getNonEmptyString(data?.publicUrl);
    if (!publicUrl) return getNonEmptyString(fallbackUrl) ?? "";

    const version = getNonEmptyString(updatedAt);
    return version
        ? `${publicUrl}?v=${encodeURIComponent(version)}`
        : publicUrl;
}

function getEffectiveReleaseDate(row) {
    const releaseDate = getNonEmptyString(row.release_date);
    if (releaseDate && Number.isFinite(Date.parse(releaseDate))) {
        return releaseDate;
    }

    const createdAt = getNonEmptyString(row.created_at);
    return createdAt && Number.isFinite(Date.parse(createdAt)) ? createdAt : "";
}

export function mapSupabaseTrackToCatalogTrack(row, urls) {
    const structuredArtists = Array.isArray(row.track_artists)
        ? row.track_artists
            .filter((credit) => credit?.artist?.slug)
            .sort((left, right) => {
                const roleDifference =
                    (left.role === "featured" ? 1 : 0) -
                    (right.role === "featured" ? 1 : 0);

                return roleDifference ||
                    Number(left.position || 0) - Number(right.position || 0);
            })
            .map((credit) => Object.freeze({
                id: credit.artist.id,
                displayName: credit.artist.display_name,
                normalizedName: credit.artist.normalized_name,
                slug: credit.artist.slug,
                avatarUrl: getArtistMediaUrl(
                    credit.artist.avatar_path,
                    credit.artist.avatar_url,
                    credit.artist.updated_at
                ),
                bannerUrl: getArtistMediaUrl(
                    credit.artist.banner_path,
                    credit.artist.banner_url,
                    credit.artist.updated_at
                ),
                bio: getNonEmptyString(credit.artist.bio) ?? "",
                linkedProfileId: credit.artist.linked_profile_id ?? null,
                avatarCrop: Object.freeze({
                    x: Number(credit.artist.avatar_focal_x ?? 0.5),
                    y: Number(credit.artist.avatar_focal_y ?? 0.5),
                    zoom: Number(credit.artist.avatar_zoom ?? 1)
                }),
                bannerCrop: Object.freeze({
                    x: Number(credit.artist.banner_focal_x ?? 0.5),
                    y: Number(credit.artist.banner_focal_y ?? 0.5),
                    zoom: Number(credit.artist.banner_zoom ?? 1)
                }),
                role: credit.role,
                position: Number(credit.position || 0),
                isFallback: false
            }))
        : [];

    return Object.freeze({
        id: row.id,
        catalogId: `supabase:${row.id}`,
        source: "supabase",
        title: row.title.trim(),
        artist: row.artist_name.trim(),
        artists: Object.freeze(
            structuredArtists.length
                ? structuredArtists
                : parseLegacyArtistCredit(row.artist_name)
        ),
        description: getNonEmptyString(row.description) ?? "",
        type: "release",
        releaseType: row.release_type,
        releaseDate: getEffectiveReleaseDate(row),
        cover: urls.coverUrl,
        audio: urls.audioUrl,
        audioExpiresAt: urls.audioExpiresAt ?? null,
        storageAudioPath: row.audio_path.trim()
        ,storageCoverPath: row.cover_path.trim()
        ,ownerId: row.owner_id ?? null
        ,status: row.status
    });
}

function getManagedRowValidationError(row) {
    if (!row || typeof row !== "object") return "получена некорректная запись";
    if (!getNonEmptyString(row.id)) return "отсутствует id";
    if (!getNonEmptyString(row.title)) return "отсутствует title";
    if (!getNonEmptyString(row.artist_name)) return "отсутствует artist_name";
    if (!getNonEmptyString(row.cover_path)) return "отсутствует cover_path";
    if (!getNonEmptyString(row.audio_path)) return "отсутствует audio_path";
    if (!RELEASE_TYPES.has(row.release_type)) return "неизвестный release_type";
    return null;
}

async function createAudioSignedUrl(path) {
    const { data, error } = await supabase.storage
        .from(AUDIO_BUCKET)
        .createSignedUrl(path, AUDIO_SIGNED_URL_TTL_SECONDS);

    const signedUrl = error
        ? null
        : getNonEmptyString(data?.signedUrl);

    if (!signedUrl) return null;

    return {
        signedUrl,
        expiresAt:
            Date.now() + AUDIO_SIGNED_URL_TTL_SECONDS * 1000
    };
}

function getReusableSignedAudio(existingTracks, path) {
    const existingTrack = existingTracks.find((track) => {
        return (
            track?.source === "supabase" &&
            track.storageAudioPath === path
        );
    });

    if (
        !getNonEmptyString(existingTrack?.audio) ||
        Number(existingTrack?.audioExpiresAt) <=
            Date.now() + AUDIO_SIGNED_URL_REUSE_LEEWAY_MS
    ) {
        return null;
    }

    return {
        signedUrl: existingTrack.audio,
        expiresAt: existingTrack.audioExpiresAt
    };
}

async function createAudioSignedUrls(
    rows,
    existingTracks = []
) {
    const urlsByPath = new Map();
    const results = await Promise.all(
        rows.map(async (row) => {
            const path = row.audio_path.trim();
            const reusableSignedAudio =
                getReusableSignedAudio(existingTracks, path);

            if (reusableSignedAudio) {
                return {
                    path,
                    signedAudio: reusableSignedAudio
                };
            }

            try {
                return {
                    path,
                    signedAudio:
                        await createAudioSignedUrl(path)
                };
            } catch {
                return { path, signedAudio: null };
            }
        })
    );

    results.forEach(({ path, signedAudio }) => {
        if (signedAudio) {
            urlsByPath.set(path, signedAudio);
        }
    });

    return urlsByPath;
}

export async function getPublishedTracks({
    existingTracks = []
} = {}) {
    let { data, error } = await supabase
        .from("tracks")
        .select(TRACK_COLUMNS_WITH_ARTIST_MEDIA)
        .eq("status", "published");

    if (error) {
        const relationResult = await supabase
            .from("tracks")
            .select(TRACK_COLUMNS_WITH_ARTIST_MEDIA_LEGACY)
            .eq("status", "published");

        if (!relationResult.error) {
            console.info(
                "Поля artist-media ещё не доступны; используются URL артиста."
            );
            data = relationResult.data;
            error = null;
        }
    }

    if (error) {
        const relationResult = await supabase
            .from("tracks")
            .select(TRACK_COLUMNS_WITH_ARTISTS)
            .eq("status", "published");
        if (!relationResult.error) {
            data = relationResult.data;
            error = null;
        }
    }

    if (error) {
        const legacyResult = await supabase
            .from("tracks")
            .select(TRACK_COLUMNS)
            .eq("status", "published");

        if (!legacyResult.error) {
            console.info(
                "Artist-связи ещё не доступны; используется artist_name."
            );
            data = legacyResult.data;
            error = null;
        }
    }

    if (error) {
        throw new Error("Не удалось загрузить опубликованные треки.");
    }

    const uniqueRows = [];
    const seenIds = new Set();

    for (const row of data ?? []) {
        const validationError = getRowValidationError(row);

        if (validationError) {
            warnSkippedTrack(row, validationError);
            continue;
        }

        if (seenIds.has(row.id)) {
            warnSkippedTrack(row, "дубликат id");
            continue;
        }

        seenIds.add(row.id);
        uniqueRows.push(row);
    }

    if (!uniqueRows.length) return [];

    const audioUrlsByPath = await createAudioSignedUrls(
        uniqueRows,
        existingTracks
    );
    const result = [];

    for (const row of uniqueRows) {
        const publicCoverUrl = getCoverUrl(row.cover_path.trim());
        const coverUrl = publicCoverUrl ?? FALLBACK_COVER;
        const signedAudio =
            audioUrlsByPath.get(row.audio_path.trim());

        if (!publicCoverUrl) {
            console.warn(
                `Supabase-трек ${row.id}: используется fallback-обложка.`
            );
        }

        if (!signedAudio) {
            warnSkippedTrack(row, "не удалось сформировать временный URL аудио");
            continue;
        }

        result.push(mapSupabaseTrackToCatalogTrack(row, {
            coverUrl,
            audioUrl: signedAudio.signedUrl,
            audioExpiresAt: signedAudio.expiresAt
        }));
    }

    return result;
}

export async function refreshSupabaseTrackAudio(track) {
    const audioPath =
        getNonEmptyString(track?.storageAudioPath);

    if (track?.source !== "supabase" || !audioPath) {
        throw new Error("Невозможно обновить ссылку аудио.");
    }

    const signedAudio =
        await createAudioSignedUrl(audioPath);

    if (!signedAudio) {
        throw new Error("Не удалось обновить временную ссылку аудио.");
    }

    return Object.freeze({
        ...track,
        audio: signedAudio.signedUrl,
        audioExpiresAt: signedAudio.expiresAt
    });
}

export async function getOwnedArtistTracks(artistId, { existingTracks = [] } = {}) {
    if (!artistId) return [];
    const { data, error } = await supabase
        .from("tracks")
        .select(TRACK_COLUMNS_WITH_ARTIST_MEDIA)
        .order("release_date", { ascending: false });
    if (error) throw error;

    const rows = (data ?? []).filter((row) => (
        !getManagedRowValidationError(row) &&
        row.track_artists?.some((credit) => credit?.artist?.id === artistId)
    ));
    const audioUrls = await createAudioSignedUrls(rows, existingTracks);
    return rows.map((row) => {
        const signed = audioUrls.get(row.audio_path.trim());
        return mapSupabaseTrackToCatalogTrack(row, {
            coverUrl: getCoverUrl(row.cover_path.trim()) ?? FALLBACK_COVER,
            audioUrl: signed?.signedUrl || "",
            audioExpiresAt: signed?.expiresAt ?? null
        });
    });
}
