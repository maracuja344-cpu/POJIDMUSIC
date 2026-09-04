function ensureStyle(marker, href) {
    if (document.querySelector(`link[${marker}]`)) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.setAttribute(marker, "true");
    document.head.append(link);
}

ensureStyle("data-album-upload-style", new URL("../album-upload.css?v=66", import.meta.url).href);
ensureStyle("data-album-upload-compact-style", new URL("../album-upload-mobile-compact.css?v=66", import.meta.url).href);

await import("./album-upload-scroll-lock.js?v=66");
const albumModule = await import("./album-upload.js?v=66");

export const openAlbumUpload = albumModule.openAlbumUpload;
export const closeAlbumUpload = albumModule.closeAlbumUpload;
