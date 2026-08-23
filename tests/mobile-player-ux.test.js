import {
    announceExclusivePopupOpen,
    renderArtistActionMenu,
    renderFullscreenArtistIdentity,
    renderArtistLinks
} from "../js/artist-utils.js";

const output = document.querySelector("#test-output");
const results = [];

function assert(name, condition) {
    if (!condition) throw new Error(name);
    results.push(`PASS ${name}`);
}

try {
    const track = {
        title: "Test track",
        artist: "Test artist",
        artists: [{
            id: "artist-test",
            displayName: "Test artist",
            slug: "test-artist",
            role: "primary",
            position: 0
        }]
    };
    const collaborationTrack = {
        title: "vb cb",
        artist: "cwa & Lufy",
        artists: [
            {
                id: "artist-vb-cb",
                displayName: "vb cb",
                slug: "vb-cb",
                role: "primary",
                position: 0
            },
            {
                id: "artist-cwa",
                displayName: "cwa",
                slug: "cwa",
                role: "primary",
                position: 1
            },
            {
                id: "artist-lufy",
                displayName: "Lufy",
                slug: "lufy",
                role: "featured",
                position: 0
            }
        ]
    };
    const directCredit = document.createElement("p");
    const cardMenu = document.createElement("div");
    const secondMenu = document.createElement("div");
    const collaborationMenu = document.createElement("div");
    const identity = document.createElement("div");
    const collaborationIdentity = document.createElement("div");
    const selected = [];

    renderArtistLinks(directCredit, track);
    assert(
        "artist credit remains a direct artist route",
        directCredit.querySelector("[data-artist-slug='test-artist']")
    );

    renderArtistActionMenu(cardMenu, track, {
        onSelect: (artist) => { selected.push(artist.slug); }
    });
    renderArtistActionMenu(secondMenu, track);
    renderArtistActionMenu(collaborationMenu, collaborationTrack, {
        onSelect: (artist) => { selected.push(artist.slug); }
    });
    renderFullscreenArtistIdentity(identity, track);
    renderFullscreenArtistIdentity(collaborationIdentity, collaborationTrack, {
        onSelect: (artist) => { selected.push(artist.slug); }
    });
    document.body.append(
        directCredit,
        cardMenu,
        secondMenu,
        collaborationMenu,
        identity,
        collaborationIdentity
    );

    assert("fullscreen uses a clean artist identity link",
        identity.querySelector("[data-artist-slug='test-artist']") &&
        !identity.querySelector("button") &&
        !identity.querySelector(".artist-action-menu"));
    assert("fullscreen artist identity never renders an avatar",
        !identity.querySelector(".fullscreen-player-artist-avatar") &&
        !identity.querySelector("img"));
    assert("fullscreen 3+ collaboration offers a selector instead of first artist",
        collaborationIdentity.querySelector("button[aria-haspopup='menu']") &&
        collaborationIdentity.querySelectorAll("[role='menuitem']").length === 3 &&
        !collaborationIdentity.querySelector(".fullscreen-player-artist-avatar"));

    collaborationIdentity.querySelector("button").click();
    assert("fullscreen collaboration selector opens without auto-selecting",
        collaborationIdentity.classList.contains("is-open") &&
        selected.length === 0);
    collaborationIdentity.querySelectorAll("[role='menuitem']")[1]
        .addEventListener("click", (event) => event.preventDefault());
    collaborationIdentity.querySelectorAll("[role='menuitem']")[1].click();
    assert("fullscreen collaboration routes the selected artist",
        selected.join(",") === "cwa" &&
        !collaborationIdentity.classList.contains("is-open"));

    const dualIdentity = document.createElement("div");
    renderFullscreenArtistIdentity(dualIdentity, {
        title: "Dual",
        artists: collaborationTrack.artists.slice(1)
    }, { onSelect: (artist) => selected.push(artist.slug) });
    document.body.append(dualIdentity);
    assert("fullscreen two-artist layout has equal direct zones",
        dualIdentity.classList.contains("fullscreen-player-artist-identity-dual") &&
        dualIdentity.querySelectorAll(".fullscreen-player-artist-zone").length === 2 &&
        !dualIdentity.querySelector("button") &&
        !dualIdentity.querySelector(".artist-action-menu-popover"));
    dualIdentity.querySelectorAll(".fullscreen-player-artist-zone")[1]
        .addEventListener("click", (event) => event.preventDefault());
    dualIdentity.querySelectorAll(".fullscreen-player-artist-zone")[1].click();
    assert("fullscreen two-artist zone routes directly",
        selected.join(",") === "cwa,lufy");

    const toggle = cardMenu.querySelector(".artist-action-menu-toggle");
    const item = cardMenu.querySelector(".artist-action-menu-primary");
    assert("solo menu exposes one universal action",
        cardMenu.querySelectorAll("[role='menuitem']").length === 1 &&
        item.textContent.trim() === "Исполнители" &&
        item.dataset.artistSlug === "test-artist");
    assert("toggle declares menu semantics",
        toggle.getAttribute("aria-haspopup") === "menu" &&
        toggle.getAttribute("aria-expanded") === "false");

    toggle.click();
    assert("opening synchronizes visibility and ARIA",
        cardMenu.classList.contains("is-open") &&
        !item.parentElement.hidden &&
        toggle.getAttribute("aria-expanded") === "true");
    assert("opening moves focus to the action", document.activeElement === item);

    item.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true
    }));
    assert("Escape closes and restores toggle focus",
        !cardMenu.classList.contains("is-open") &&
        document.activeElement === toggle);

    toggle.click();
    secondMenu.querySelector("button").click();
    assert("only one artist menu stays open",
        !cardMenu.classList.contains("is-open") &&
        secondMenu.classList.contains("is-open"));

    announceExclusivePopupOpen(document.createElement("div"));
    assert("another popup owner closes the artist menu",
        !secondMenu.classList.contains("is-open"));

    secondMenu.querySelector("button").click();
    document.body.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true
    }));
    assert("outside pointer closes an open menu",
        !secondMenu.classList.contains("is-open"));

    item.addEventListener("click", (event) => event.preventDefault());
    toggle.click();
    item.click();
    assert("solo action selects its only artist directly",
        selected.join(",") === "cwa,lufy,test-artist" &&
        !cardMenu.classList.contains("is-open"));

    const collaborationToggle = collaborationMenu.querySelector(
        ".artist-action-menu-toggle"
    );
    const collaborationAction = collaborationMenu.querySelector(
        ".artist-action-menu-primary"
    );
    const selector = collaborationMenu.querySelector(
        ".artist-action-menu-selector"
    );
    const selectorItems = [...selector.querySelectorAll("[role='menuitem']")];

    assert("collaboration starts with one universal action",
        collaborationAction.textContent.trim() === "Исполнители" &&
        selector.hidden &&
        !collaborationAction.hidden);

    collaborationToggle.click();
    collaborationAction.click();
    assert("collaboration opens an artist selector without auto-selecting",
        collaborationMenu.classList.contains("is-open") &&
        collaborationAction.hidden &&
        !selector.hidden &&
        selected.join(",") === "cwa,lufy,test-artist");
    assert("selector exposes every credited artist in order",
        selector.querySelector(".artist-action-menu-selector-label")
            .textContent.trim() === "Выберите артиста:" &&
        selectorItems.map((artist) => artist.textContent.trim()).join(",") ===
            "vb cb,cwa,Lufy" &&
        selectorItems.map((artist) => artist.dataset.artistSlug).join(",") ===
            "vb-cb,cwa,lufy" &&
        document.activeElement === selectorItems[0]);

    selectorItems[2].addEventListener("click", (event) => event.preventDefault());
    selectorItems[2].click();
    assert("choosing a collaborator closes and resets the menu",
        selected.join(",") === "cwa,lufy,test-artist,lufy" &&
        !collaborationMenu.classList.contains("is-open") &&
        selector.hidden &&
        !collaborationAction.hidden);

    collaborationToggle.click();
    assert("reopening returns focus to the universal action",
        document.activeElement === collaborationAction && selector.hidden);

    document.body.dataset.testStatus = "passed";
    output.textContent = `${results.join("\n")}\n\n${results.length} passed`;
} catch (error) {
    document.body.dataset.testStatus = "failed";
    output.textContent = `${results.join("\n")}\nFAIL ${error.stack || error}`;
}
