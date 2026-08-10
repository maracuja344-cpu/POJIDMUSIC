import { createMemoryDataCache } from "../js/data-cache.js";

const output = document.querySelector("#test-output");
const results = [];

function assert(name, condition) {
    if (!condition) throw new Error(name);
    results.push(`PASS ${name}`);
}

async function flush() {
    await Promise.resolve();
    await Promise.resolve();
}

try {
    let time = 1000;
    let loads = 0;
    const cache = createMemoryDataCache({ now: () => time });
    const loader = async () => ({ version: ++loads });

    const miss = await cache.get("artist:a", loader, { ttlMs: 100 });
    assert("cache miss loads a value", miss.version === 1 && loads === 1);

    const hit = await cache.get("artist:a", loader, { ttlMs: 100 });
    assert("cache hit reuses the value", hit === miss && loads === 1);

    time += 101;
    const expired = await cache.get("artist:a", loader, { ttlMs: 100 });
    assert("TTL expiry reloads the value", expired.version === 2 && loads === 2);

    time += 101;
    let releaseStaleRefresh;
    const staleRefresh = () => new Promise((resolve) => {
        releaseStaleRefresh = resolve;
    });
    const stale = await cache.get("artist:a", staleRefresh, {
        ttlMs: 100,
        staleWhileRevalidateMs: 500
    });
    assert("stale-while-revalidate returns stale immediately", stale === expired);
    const concurrentStale = await cache.get("artist:a", staleRefresh, {
        ttlMs: 100,
        staleWhileRevalidateMs: 500
    });
    assert("concurrent stale hit remains non-blocking", concurrentStale === expired);
    releaseStaleRefresh({ version: 3 });
    await flush();
    assert("stale background refresh updates cache", cache.peek("artist:a").version === 3);

    let releaseShared;
    let sharedLoads = 0;
    const sharedLoader = () => {
        sharedLoads += 1;
        return new Promise((resolve) => { releaseShared = resolve; });
    };
    const firstShared = cache.get("profile:p", sharedLoader, { ttlMs: 100 });
    const secondShared = cache.get("profile:p", sharedLoader, { ttlMs: 100 });
    await flush();
    releaseShared("profile");
    assert("in-flight calls share one request",
        await firstShared === "profile" && await secondShared === "profile" && sharedLoads === 1);

    let rejectedLoads = 0;
    try {
        await cache.get("artist:error", async () => {
            rejectedLoads += 1;
            throw new Error("expected");
        });
    } catch {}
    const recovered = await cache.get("artist:error", async () => {
        rejectedLoads += 1;
        return "recovered";
    });
    assert("rejected Promise clears in-flight entry",
        recovered === "recovered" && rejectedLoads === 2);

    cache.invalidate("profile:p");
    assert("invalidation removes cached value", cache.peek("profile:p") === undefined);

    const beforeForce = loads;
    await cache.get("artist:a", loader, { ttlMs: 100, force: true });
    assert("force refresh bypasses a fresh value", loads === beforeForce + 1);

    document.body.dataset.testStatus = "passed";
    output.textContent = `${results.join("\n")}\n\n${results.length} passed`;
} catch (error) {
    document.body.dataset.testStatus = "failed";
    output.textContent = `${results.join("\n")}\nFAIL ${error.stack || error}`;
}
