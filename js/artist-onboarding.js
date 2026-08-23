export const ARTIST_ACCOUNT_TYPE = "artist";


export function getRequestedAccountType(user) {
    return user?.user_metadata?.account_type === ARTIST_ACCOUNT_TYPE
        ? ARTIST_ACCOUNT_TYPE
        : "listener";
}


export function userRequestedArtistAccount(user) {
    return getRequestedAccountType(user) === ARTIST_ACCOUNT_TYPE;
}


export async function activateRequestedArtistAccount(supabase, user) {
    if (!userRequestedArtistAccount(user)) {
        return {
            requested: false,
            artist: null
        };
    }

    const { data, error } = await supabase.rpc(
        "activate_current_user_as_artist"
    );

    if (error) throw error;

    const artist = Array.isArray(data) ? data[0] ?? null : data ?? null;
    if (!artist?.artist_id || !artist?.artist_slug) {
        throw new Error("Artist onboarding did not return a linked artist.");
    }

    return {
        requested: true,
        artist
    };
}
