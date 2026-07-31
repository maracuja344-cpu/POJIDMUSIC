const playbackContext = {
    searchActive: false,
    searchTracks: [],
    waveActive: false
};


function notifyPlaybackContextChange() {
    window.dispatchEvent(
        new CustomEvent(
            "playbackcontextchange"
        )
    );
}


function getUniqueTracks(trackList) {
    return trackList.filter(
        (track, index, tracks) => {
            return (
                tracks.findIndex((otherTrack) => {
                    return (
                        otherTrack.catalogId === track.catalogId
                    );
                }) === index
            );
        }
    );
}


export function setSearchPlaybackQueue(
    foundTracks
) {
    playbackContext.searchActive = true;
    playbackContext.searchTracks =
        getUniqueTracks(foundTracks);
    playbackContext.waveActive = false;

    notifyPlaybackContextChange();
}


export function clearSearchPlaybackQueue() {
    playbackContext.searchActive = false;
    playbackContext.searchTracks = [];
    playbackContext.waveActive = false;

    notifyPlaybackContextChange();
}


export function restartSearchPlaybackQueue() {
    if (!playbackContext.searchActive) {
        return;
    }

    playbackContext.waveActive = false;
    notifyPlaybackContextChange();
}


export function activateSearchWave() {
    if (
        !playbackContext.searchActive ||
        playbackContext.searchTracks.length === 0
    ) {
        return false;
    }

    playbackContext.waveActive = true;
    notifyPlaybackContextChange();
    return true;
}


export function getPlaybackContext() {
    return {
        searchActive:
            playbackContext.searchActive,
        searchTracks: [
            ...playbackContext.searchTracks
        ],
        waveActive:
            playbackContext.waveActive
    };
}
