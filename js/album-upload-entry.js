const cssHref = new URL("../album-upload.css?v=65", import.meta.url).href;

if (!document.querySelector('link[data-album-upload-style]')) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = cssHref;
    link.dataset.albumUploadStyle = "true";
    document.head.append(link);
}

const albumModule = await import("./album-upload.js?v=65");

export const openAlbumUpload = albumModule.openAlbumUpload;
export const closeAlbumUpload = albumModule.closeAlbumUpload;
