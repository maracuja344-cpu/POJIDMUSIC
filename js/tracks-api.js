import { supabase } from "./supabase/client.js";

const AUDIO_BUCKET = "track-audio";
const COVER_BUCKET = "track-covers";
const AUDIO_SIGNED_URL_TTL_SECONDS = 60 * 60;
const FALLBACK_COVER = "img/cover.jpg";
const RELEASE_TYPES = new Set(["demo", "single", "album_track"]);
const TRACK_COLUMNS = [
    "id",
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

function getEffectiveReleaseDate(row) {
    const releaseDate = getNonEmptyString(row.release_date);
    if (releaseDate && Number.isFinite(Date.parse(releaseDate))) {
        return releaseDate;
    }

    const createdAt = getNonEmptyString(row.created_at);
    return createdAt && Number.isFinite(Date.parse(createdAt)) ? createdAt : "";
}

export function mapSupabaseTrackToCatalogTrack(row, urls) {
    return Object.freeze({
        id: row.id,
        catalogId: `supabase:${row.id}`,
        source: "supabase",
        title: row.title.trim(),
        artist: row.artist_name.trim(),
        description: getNonEmptyString(row.description) ?? "",
        type: "release",
        releaseType: row.release_type,
        releaseDate: getEffectiveReleaseDate(row),
        cover: urls.coverUrl,
        audio: urls.audioUrl,
        audioExpiresAt: urls.audioExpiresAt ?? null,
        storageAudioPath: row.audio_path.trim()
    });
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

async function createAudioSignedUrls(rows) {
    const urlsByPath = new Map();
    const results = await Promise.all(
        rows.map(async (row) => {
            const path = row.audio_path.trim();

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

export async function getPublishedTracks() {
    const { data, error } = await supabase
        .from("tracks")
        .select(TRACK_COLUMNS)
        .eq("status", "published");

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

    const audioUrlsByPath = await createAudioSignedUrls(uniqueRows);
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
