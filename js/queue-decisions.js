function uniqueIds(values) {
    const seen = new Set();
    return (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter((value) => {
            if (!value || seen.has(value)) return false;
            seen.add(value);
            return true;
        });
}

function randomItem(values, random) {
    return values[Math.floor(random() * values.length)] || null;
}

export function getSequentialQueueId({
    queueIds,
    currentId,
    direction,
    repeatMode
}) {
    const ids = uniqueIds(queueIds);
    if (!ids.length) return null;

    const currentIndex = ids.indexOf(currentId);
    if (currentIndex === -1) return ids[0];

    const targetIndex = currentIndex + direction;
    if (targetIndex >= 0 && targetIndex < ids.length) {
        return ids[targetIndex];
    }

    if (repeatMode !== "all") return null;
    return direction > 0 ? ids[0] : ids[ids.length - 1];
}

export function getHistoryDecision({
    historyIds,
    historyIndex,
    direction,
    validIds
}) {
    const targetIndex = historyIndex + direction;
    if (targetIndex < 0 || targetIndex >= historyIds.length) {
        return { catalogId: null, historyIndex: null };
    }

    const catalogId = historyIds[targetIndex];
    if (!new Set(validIds).has(catalogId)) {
        return { catalogId: null, historyIndex: null };
    }

    return { catalogId, historyIndex: targetIndex };
}

export function getShuffleDecision({
    queueIds,
    currentId,
    direction,
    repeatMode,
    historyIds,
    historyIndex,
    validHistoryIds,
    cycleIds,
    random = Math.random
}) {
    const ids = uniqueIds(queueIds);
    const currentCycleIds = uniqueIds(cycleIds);

    if (!currentId) {
        return {
            catalogId: randomItem(ids, random),
            historyIndex: null,
            cycleIds: currentCycleIds
        };
    }

    if (ids.length === 1) {
        return {
            catalogId: repeatMode === "all" ? currentId : null,
            historyIndex: null,
            cycleIds: currentCycleIds
        };
    }

    const historyDecision = getHistoryDecision({
        historyIds,
        historyIndex,
        direction,
        validIds: validHistoryIds
    });
    if (historyDecision.catalogId) {
        return {
            catalogId: historyDecision.catalogId,
            historyIndex: historyDecision.historyIndex,
            cycleIds: currentCycleIds
        };
    }

    if (direction < 0) {
        return {
            catalogId: null,
            historyIndex: null,
            cycleIds: currentCycleIds
        };
    }

    let nextCycleIds = currentCycleIds;
    let cycleSet = new Set(nextCycleIds);
    let candidates = ids.filter((id) => (
        id !== currentId && !cycleSet.has(id)
    ));

    if (!candidates.length && repeatMode === "all") {
        nextCycleIds = [currentId];
        cycleSet = new Set(nextCycleIds);
        candidates = ids.filter((id) => id !== currentId);
    }

    return {
        catalogId: randomItem(candidates, random),
        historyIndex: null,
        cycleIds: nextCycleIds
    };
}

export function shouldRepeatCurrentTrack({
    reason,
    fromError,
    repeatMode,
    currentId
}) {
    return Boolean(
        reason === "ended" &&
        !fromError &&
        repeatMode === "one" &&
        currentId
    );
}

export function reconcileQueueSnapshot({
    queueIds,
    currentIndex,
    sourceType,
    validIds,
    catalogIds = []
}) {
    const valid = new Set(uniqueIds(validIds));
    const originalIds = uniqueIds(queueIds);
    const nextIds = originalIds.filter((id) => valid.has(id));

    if (sourceType === "catalog" && nextIds.length === 0) {
        nextIds.push(...uniqueIds(catalogIds).filter((id) => valid.has(id)));
    }

    const currentId = originalIds[currentIndex];
    return {
        queueIds: nextIds,
        currentIndex: currentId ? nextIds.indexOf(currentId) : -1
    };
}
