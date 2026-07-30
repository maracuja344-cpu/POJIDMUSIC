/*
Определяет, можно ли показывать трек
и добавлять его в очередь воспроизведения.
*/
export function isPlayableRelease(track) {
    return (
        track.type === "release" &&
        typeof track.audio === "string" &&
        track.audio.trim() !== ""
    );
}
