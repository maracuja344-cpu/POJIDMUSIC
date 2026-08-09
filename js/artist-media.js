import { supabase } from "./supabase/client.js";

const PROFILE_BUCKET = "profile-avatars";
const ARTIST_BUCKET = "artist-media";
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const PROFILE_MAX_BYTES = 5 * 1024 * 1024;
const ARTIST_AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const ARTIST_BANNER_MAX_BYTES = 10 * 1024 * 1024;

function assertImageFile(file, maximumBytes, label) {
    if (!(file instanceof File) || !IMAGE_TYPES.has(file.type)) {
        throw new Error("Выберите изображение JPG, PNG или WebP.");
    }

    if (file.size > maximumBytes) {
        throw new Error(`${label} должен быть не больше ${Math.round(maximumBytes / 1048576)} МиБ.`);
    }
}

async function decodeImage(file) {
    if ("createImageBitmap" in window) {
        return await createImageBitmap(file);
    }

    const objectUrl = URL.createObjectURL(file);
    try {
        const image = new Image();
        image.src = objectUrl;
        await image.decode();
        return image;
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
}

function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
        canvas.toBlob(
            (blob) => blob
                ? resolve(blob)
                : reject(new Error("Браузер не смог подготовить изображение.")),
            "image/webp",
            0.88
        );
    });
}

async function prepareImage(file, kind) {
    const image = await decodeImage(file);
    const isAvatar = kind === "avatar" || kind === "profile";
    let sourceX = 0;
    let sourceY = 0;
    let sourceWidth = image.width;
    let sourceHeight = image.height;
    let width;
    let height;

    if (isAvatar) {
        const side = Math.min(image.width, image.height);
        sourceX = Math.floor((image.width - side) / 2);
        sourceY = Math.floor((image.height - side) / 2);
        sourceWidth = side;
        sourceHeight = side;
        width = Math.min(side, 512);
        height = width;
    } else {
        const scale = Math.min(1, 1920 / image.width, 1080 / image.height);
        width = Math.max(1, Math.round(image.width * scale));
        height = Math.max(1, Math.round(image.height * scale));
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(
        image,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        0,
        0,
        width,
        height
    );
    image.close?.();
    return await canvasToBlob(canvas);
}

function getPublicUrl(bucket, path) {
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return data?.publicUrl || "";
}

function getOwnedProfilePath(url, userId) {
    if (!url) return "";

    try {
        const marker = `/storage/v1/object/public/${PROFILE_BUCKET}/`;
        const parsed = new URL(url);
        const markerIndex = parsed.pathname.indexOf(marker);
        if (markerIndex === -1) return "";
        const path = decodeURIComponent(parsed.pathname.slice(markerIndex + marker.length));
        return path.startsWith(`${userId}/`) ? path : "";
    } catch {
        return "";
    }
}

export async function uploadAccountAvatar(file, { user, profile } = {}) {
    if (!user?.id || !profile?.id || profile.id !== user.id) {
        throw new Error("Сначала войдите в аккаунт.");
    }

    assertImageFile(file, PROFILE_MAX_BYTES, "Аватар");
    const blob = await prepareImage(file, "profile");
    const path = `${user.id}/avatar-${crypto.randomUUID()}.webp`;
    const oldPath = getOwnedProfilePath(profile.avatar_url, user.id);
    const { error: uploadError } = await supabase.storage
        .from(PROFILE_BUCKET)
        .upload(path, blob, {
            cacheControl: "31536000",
            contentType: "image/webp",
            upsert: false
        });

    if (uploadError) throw uploadError;

    const publicUrl = getPublicUrl(PROFILE_BUCKET, path);
    const { error: updateError } = await supabase
        .from("profiles")
        .update({ avatar_url: publicUrl })
        .eq("id", user.id);

    if (updateError) {
        await supabase.storage.from(PROFILE_BUCKET).remove([path]);
        throw updateError;
    }

    if (oldPath && oldPath !== path) {
        await supabase.storage.from(PROFILE_BUCKET).remove([oldPath]);
    }

    window.dispatchEvent(new CustomEvent("profilemediachange"));
    return publicUrl;
}

export async function uploadArtistMedia(file, artist, kind, crop = { x: 0.5, y: 0.5, zoom: 1 }, preparedBlob = null) {
    if (!artist?.id || !["avatar", "banner"].includes(kind)) {
        throw new Error("Не удалось определить профиль артиста.");
    }

    assertImageFile(
        file,
        kind === "avatar" ? ARTIST_AVATAR_MAX_BYTES : ARTIST_BANNER_MAX_BYTES,
        kind === "avatar" ? "Аватар" : "Баннер"
    );

    const blob = preparedBlob || await prepareImage(file, kind);
    const path = `${artist.id}/${kind}-${crypto.randomUUID()}.webp`;
    const { error: uploadError } = await supabase.storage
        .from(ARTIST_BUCKET)
        .upload(path, blob, {
            cacheControl: "31536000",
            contentType: "image/webp",
            upsert: false
        });

    if (uploadError) throw uploadError;

    const { data: previousPath, error: rpcError } = await supabase.rpc(
        "set_artist_media_with_crop",
        {
            target_artist_id: artist.id,
            media_kind: kind,
            object_path: path,
            focal_x: crop.x,
            focal_y: crop.y,
            zoom_value: crop.zoom
        }
    );

    if (rpcError) {
        await supabase.storage.from(ARTIST_BUCKET).remove([path]);
        throw rpcError;
    }

    if (previousPath && previousPath !== path) {
        await supabase.storage.from(ARTIST_BUCKET).remove([previousPath]);
    }

    window.dispatchEvent(new CustomEvent("artistmediachange", {
        detail: { artistId: artist.id, kind }
    }));
    return getPublicUrl(ARTIST_BUCKET, path);
}

export async function saveArtistCrop(artist, kind, crop) {
    if (!artist?.id || !["avatar", "banner"].includes(kind)) {
        throw new Error("Не удалось определить профиль артиста.");
    }
    const { error } = await supabase.rpc("set_artist_crop", {
        target_artist_id: artist.id,
        media_kind: kind,
        focal_x: crop.x,
        focal_y: crop.y,
        zoom_value: crop.zoom
    });
    if (error) throw error;
    window.dispatchEvent(new CustomEvent("artistmediachange", {
        detail: { artistId: artist.id, kind }
    }));
}
