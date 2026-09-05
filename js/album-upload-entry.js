await import("./album-upload-scroll-lock.js");
const albumModule = await import("./album-upload.js");

export const openAlbumUpload = albumModule.openAlbumUpload;
export const closeAlbumUpload = albumModule.closeAlbumUpload;
