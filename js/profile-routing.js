export function hasStableArtistIdentity(artist) {
    return Boolean(
        artist?.id &&
        artist?.slug &&
        !artist?.isFallback
    );
}


export function isArtistOwner(artist, userId) {
    return Boolean(
        hasStableArtistIdentity(artist) &&
        userId &&
        artist.linkedProfileId === userId
    );
}


export function getProfileDestination({ user, profile, artist }) {
    if (!user?.id) return { name: "auth" };

    if (
        profile?.role === "artist" &&
        hasStableArtistIdentity(artist) &&
        artist.linkedProfileId === user.id
    ) {
        return {
            name: "artist",
            artistSlug: artist.slug
        };
    }

    return { name: "settings" };
}
