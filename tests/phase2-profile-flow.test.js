import {
    activateRequestedArtistAccount,
    getRequestedAccountType
} from "../js/artist-onboarding.js";
import {
    getProfileDestination,
    hasStableArtistIdentity,
    isArtistOwner
} from "../js/profile-routing.js";
import {
    createArtistLink,
    createFallbackArtist,
    renderArtistActionMenu
} from "../js/artist-utils.js";

const output = document.querySelector("#test-output");
const results = [];

function assert(name, condition) {
    if (!condition) throw new Error(name);
    results.push(`PASS ${name}`);
}

try {
    const indexMarkup = await fetch("../index.html").then((response) => response.text());
    const indexDocument = new DOMParser().parseFromString(indexMarkup, "text/html");
    const accountType = indexDocument.querySelector("[name='account_type']");
    const artistOption = accountType?.querySelector("option[value='artist']");

    assert("artist can be selected during registration",
        accountType?.value === "listener" && artistOption?.textContent.trim() === "Артист");
    assert("artist signup intent is metadata, not a database role claim",
        getRequestedAccountType({ user_metadata: { account_type: "artist", role: "admin" } }) === "artist");

    let rpcCalls = 0;
    const fakeSupabase = {
        rpc: async (name, args) => {
            rpcCalls += 1;
            assert("onboarding uses the parameterless server RPC",
                name === "activate_current_user_as_artist" && args === undefined);
            return {
                data: [{
                    artist_id: "artist-1",
                    artist_slug: "new-artist-stable",
                    artist_display_name: "New Artist"
                }],
                error: null
            };
        }
    };
    const artistUser = {
        id: "user-1",
        user_metadata: { account_type: "artist" }
    };
    const firstActivation = await activateRequestedArtistAccount(fakeSupabase, artistUser);
    const repeatedLoginActivation = await activateRequestedArtistAccount(fakeSupabase, artistUser);
    assert("artist signup invokes server-side activation", firstActivation.artist.artist_id === "artist-1");
    assert("repeated login can safely repeat the idempotent RPC",
        rpcCalls === 2 && repeatedLoginActivation.artist.artist_slug === "new-artist-stable");

    const listenerResult = await activateRequestedArtistAccount(fakeSupabase, {
        id: "listener-1",
        user_metadata: { account_type: "listener" }
    });
    assert("listener login does not invoke artist activation",
        listenerResult.requested === false && rpcCalls === 2);

    const artist = {
        id: "artist-1",
        slug: "new-artist-stable",
        displayName: "New Artist",
        linkedProfileId: "user-1",
        isFallback: false
    };
    const ownerDestination = getProfileDestination({
        user: artistUser,
        profile: { id: "user-1", role: "artist" },
        artist
    });
    assert("artist Profile routes to the owned Artist Page",
        ownerDestination.name === "artist" && ownerDestination.artistSlug === artist.slug);
    assert("owner detection uses linked_profile_id",
        isArtistOwner(artist, "user-1") && !isArtistOwner(artist, "visitor-1"));
    assert("listener Profile falls back to Settings",
        getProfileDestination({
            user: { id: "listener-1" },
            profile: { id: "listener-1", role: "listener" },
            artist: null
        }).name === "settings");

    const stableLink = createArtistLink(artist);
    assert("Home/Search stable artist link uses the stored slug",
        stableLink.matches("a[data-artist-slug='new-artist-stable']") &&
        new URL(stableLink.href).searchParams.get("artist") === "new-artist-stable");

    const fallback = createFallbackArtist("Legacy Credit");
    const fallbackLabel = createArtistLink(fallback);
    assert("credit fallback is never emitted as a URL",
        !hasStableArtistIdentity(fallback) &&
        fallbackLabel.tagName === "SPAN" &&
        !fallbackLabel.hasAttribute("href") &&
        !fallbackLabel.hasAttribute("data-artist-slug"));

    const fallbackMenu = document.createElement("div");
    renderArtistActionMenu(fallbackMenu, {
        title: "Legacy Track",
        artists: [fallback]
    });
    assert("fallback credits do not expose an artist navigation menu",
        fallbackMenu.hidden && !fallbackMenu.querySelector("[data-artist-slug]"));

    assert("Account screen has a separate Settings entry",
        Boolean(indexDocument.querySelector("[data-profile-action='settings']")) &&
        Boolean(indexDocument.querySelector("[data-open-account-settings]")));
    assert("Artist owner keeps upload and profile editing controls",
        Boolean(indexDocument.querySelector("[data-profile-quick-upload]")) &&
        Boolean(indexDocument.querySelector("[data-open-artist-profile-editor]")));

    document.body.dataset.testStatus = "passed";
    output.textContent = `${results.length} PASS\n${results.join("\n")}`;
} catch (error) {
    document.body.dataset.testStatus = "failed";
    output.textContent = `${results.length} PASS\nFAIL ${error.message}\n${error.stack || ""}`;
    throw error;
}
