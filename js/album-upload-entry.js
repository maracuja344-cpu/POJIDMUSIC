function ensureStyle(marker, href) {
    if (document.querySelector(`link[${marker}]`)) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.setAttribute(marker, "true");
    document.head.append(link);
}

ensureStyle("data-album-upload-style", new URL("../album-upload.css?v=89", import.meta.url).href);
ensureStyle("data-album-upload-compact-style", new URL("../album-upload-mobile-compact.css?v=89", import.meta.url).href);
ensureStyle("data-album-upload-wizard-style", new URL("../album-upload-wizard.css?v=89", import.meta.url).href);

await import("./album-upload-scroll-lock.js?v=89");
const albumModule = await import("./album-upload.js?v=89");
const { enhanceAlbumUploadWizard } = await import("./album-upload-wizard.js?v=89");

export function openAlbumUpload() {
    albumModule.openAlbumUpload();
    enhanceAlbumUploadWizard(document.querySelector("[data-album-upload-modal]"));
}

export const closeAlbumUpload = albumModule.closeAlbumUpload;
