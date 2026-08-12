import {
    FALLBACK_PLAYER_ACCENT,
    normalizePlayerAccent,
    selectPlayerAccentFromPixels
} from "../js/player.js";

const output = document.querySelector("#test-output");
const results = [];
const fallback = { red: 226, green: 173, blue: 255 };

function assert(name, condition) {
    if (!condition) throw new Error(name);
    results.push(`PASS ${name}`);
}

function equals(left, right) {
    return left.red === right.red &&
        left.green === right.green &&
        left.blue === right.blue;
}

try {
    assert("black artwork normalizes to the safe fallback",
        equals(normalizePlayerAccent({ red: 0, green: 0, blue: 0 }), fallback));
    assert("white artwork normalizes to the safe fallback",
        equals(normalizePlayerAccent({ red: 255, green: 255, blue: 255 }), fallback));
    assert("neutral artwork normalizes to the safe fallback",
        equals(normalizePlayerAccent({ red: 128, green: 128, blue: 128 }), fallback));

    const red = normalizePlayerAccent({ red: 255, green: 0, blue: 0 });
    const green = normalizePlayerAccent({ red: 0, green: 255, blue: 0 });
    const cyan = normalizePlayerAccent({ red: 0, green: 255, blue: 255 });
    assert("saturated red remains colored but is brightness-limited",
        red.red > red.green && red.red > red.blue && red.red < 255);
    assert("saturated cyan remains colored but is brightness-limited",
        cyan.green > cyan.red && cyan.blue > cyan.red &&
        cyan.green < 255 && cyan.blue < 255);
    assert("saturated green remains colored but is brightness-limited",
        green.green > green.red && green.green > green.blue && green.green < 255);
    assert("missing artwork uses the same documented fallback",
        equals(FALLBACK_PLAYER_ACCENT, fallback));

    const grayscalePixels = new Uint8ClampedArray(32 * 32 * 4);
    for (let index = 0; index < grayscalePixels.length; index += 4) {
        grayscalePixels.set([118, 118, 118, 255], index);
    }
    const grayscale = selectPlayerAccentFromPixels(grayscalePixels);
    assert("true grayscale artwork receives a safe neutral accent",
        Math.max(grayscale.red, grayscale.green, grayscale.blue) -
            Math.min(grayscale.red, grayscale.green, grayscale.blue) < 10 &&
        !equals(grayscale, fallback));

    const detailPixels = grayscalePixels.slice();
    for (let pixel = 0; pixel < 6; pixel += 1) {
        detailPixels.set([240, 32, 44, 255], pixel * 4);
    }
    const detailed = selectPlayerAccentFromPixels(detailPixels);
    assert("small saturated artwork detail wins over a grayscale field",
        detailed.red > detailed.green * 1.8 && detailed.red > detailed.blue * 1.8);

    document.body.dataset.testStatus = "passed";
    output.textContent = `${results.join("\n")}\n\n${results.length} passed`;
} catch (error) {
    document.body.dataset.testStatus = "failed";
    output.textContent = `${results.join("\n")}\nFAIL ${error.stack || error}`;
}
