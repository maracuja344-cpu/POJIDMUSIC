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
            displayName: "Test artist",
            slug: "test-artist",
            role: "primary",
            position: 0
        }]
    };
    const directCredit = document.createElement("p");
    const cardMenu = document.createElement("div");
    const secondMenu = document.createElement("div");
    const identity = document.createElement("div");
    let selected = 0;

    renderArtistLinks(directCredit, track);
    assert(
        "artist credit remains a direct artist route",
        directCredit.querySelector("[data-artist-slug='test-artist']")
    );

    renderArtistActionMenu(cardMenu, track, {
        onSelect: () => { selected += 1; }
    });
    renderArtistActionMenu(secondMenu, track);
    renderFullscreenArtistIdentity(identity, track);
    document.body.append(directCredit, cardMenu, secondMenu, identity);

    assert("fullscreen uses a clean artist identity link",
        identity.querySelector("[data-artist-slug='test-artist']") &&
        !identity.querySelector("button") &&
        !identity.querySelector(".artist-action-menu"));

    const toggle = cardMenu.querySelector("button");
    const item = cardMenu.querySelector("[role='menuitem']");
    assert("menu exposes exactly one real action",
        cardMenu.querySelectorAll("[role='menuitem']").length === 1 &&
        item.textContent.trim() === "Перейти к артисту");
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
    assert("select callback runs without inventing another action",
        selected === 1 && !cardMenu.classList.contains("is-open"));

    document.body.dataset.testStatus = "passed";
    output.textContent = `${results.join("\n")}\n\n${results.length} passed`;
} catch (error) {
    document.body.dataset.testStatus = "failed";
    output.textContent = `${results.join("\n")}\nFAIL ${error.stack || error}`;
}
