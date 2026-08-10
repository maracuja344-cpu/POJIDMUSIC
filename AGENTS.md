# POJIDMUSIC working rules

These rules apply to AI agents and developers working in this repository.

## Source of truth

1. Read the current repository before proposing or making changes. Do not infer the
   architecture from an older POJIDMUSIC version, screenshots, or external clients.
2. `CODEMAP.md` is an orientation aid, but current executable code wins whenever the two
   disagree. Update the codemap when an architectural change lands.
3. The current `index.html` and `style.css` visual language is the design source of truth.
   Do not redesign the product without an explicit request.
4. Nuclear, Feishin, Navidrome, Spotify, Yandex Music, and similar products may be used
   only as architecture or UX-flow references, never as visual specifications.

## Change discipline

5. Before a substantial change, identify affected modules, state owners, data queries,
   DOM contracts, persistence keys, and PWA behavior.
6. Keep tasks narrowly scoped. Do not mix unrelated refactors, visual work, schema work,
   and behavior changes.
7. Refactor in small verifiable stages. Keep old working logic until the replacement is
   demonstrated on all required scenarios.
8. Preserve observable behavior unless the task explicitly asks to change it. When the
   existing behavior is ambiguous, characterize it with tests before choosing semantics.
9. Do not delete code or files merely because they appear unused. Verify entry points,
   dynamic imports, event wiring, service-worker precache, and deployed compatibility.

## Player invariants

10. Keep one shared `Audio` instance unless a documented architecture requires more.
11. Do not couple core player state to the continued existence of DOM cards. Cards are
    views and possible queue-source inputs, not authoritative playback state.
12. Before player work, cover normal play, pause/resume, Next, Previous, shuffle,
    Repeat Off/All/One, manual Next under Repeat One, natural end under Repeat One,
    end of an artist queue, navigation during playback, reload, and removal of the
    current card/catalog row.
13. Keep mini-player, fullscreen player, cards, future Media Session handlers, and
    persistence synchronized through one command/state boundary.
14. Version persisted player data and support migration/fallback for existing keys.

## Data and security

15. Do not duplicate Supabase queries without a measured reason. Prefer a shared
    repository/cache with in-flight request deduplication and explicit invalidation.
16. Treat frontend role/owner checks as presentation only. Every mutation must be backed
    by appropriate RLS, Storage policy, or a security-checked RPC.
17. Do not change Supabase schema, functions, RLS, grants, or Storage policies unless the
    task explicitly includes backend security and migration review.
18. Never expose the service-role key in browser code. The committed anon key is not a
    substitute for RLS.
19. Signed URLs are temporary capabilities. Do not persist them as durable track data;
    refresh or mint them at a controlled data/audio boundary.
20. Keep upload compensation paths: a failed multi-step upload must attempt to clean up
    created rows and Storage objects and report cleanup failures.

## UI, mobile, and PWA

21. Preserve current POJIDMUSIC layout, typography, artwork treatment, interactions, and
    responsive behavior unless a visual task says otherwise.
22. Any user-facing change must be checked on desktop, mobile, and standalone PWA.
23. Service-worker asset updates must be complete and atomic. Keep the precache list or
    generated asset manifest aligned with the real static/dynamic module graph.
24. Test both an upgrade from an installed prior version and a clean offline launch.
    Check for stale or mixed JS/CSS and define when an open client reloads.
25. Any deploy that changes a critical shell file must bump `RELEASE_VERSION` in
    `service-worker.js`, keep the matching `pojidmusic-release` meta in `index.html`,
    and pass `python tests/check-pwa-shell.py`. When adding/removing imports, update the
    critical shell list; when changing the pinned Supabase SDK, update its exact cached
    graph in the same release.
26. Preserve local/degraded catalog behavior until product requirements explicitly
    replace it.

## Verification and handoff

27. Scale tests to risk. Player, navigation, data-cache, auth/permissions, or PWA changes
    require scenario tests beyond a syntax check.
28. For architecture changes, report changed ownership boundaries and dependencies, new
    persistence/cache contracts, queries added/removed, and deployment implications.
29. If a critical bug is found outside the requested scope, document file, area, cause,
    consequence, and recommended solution; do not silently fix it.
30. Do not claim live RLS or migration parity based only on repository SQL. Verify the
    deployed project when the task requires that assurance.
31. Stop after the requested phase. An audit does not authorize refactoring.

## GitHub / Live Testing Workflow

Работать только в актуальном репозитории POJIDMUSIC.

GitHub используется как контрольные точки для крупных изменений и live-проверок.

### Перед работой

Всегда:

- проверить текущую директорию;
- убедиться, что это POJIDMUSIC repository;
- проверить git status;
- не использовать старые копии проекта.

---

### Маленькие изменения

К маленьким изменениям относятся:

- один CSS фикс;
- небольшой UI tweak;
- исправление одного бага;
- изменение одного файла без архитектурного влияния.

Для таких изменений:

- проверить локально;
- выполнить подходящие тесты;
- не делать обязательный commit/push после каждого изменения.

Можно объединять несколько маленьких исправлений в один логический commit.

---

### Большие изменения

Большими считаются:

- новые функции;
- изменение player logic;
- изменение PWA/service worker;
- новые архитектурные модули;
- большие UI этапы;
- изменения нескольких связанных компонентов;
- изменения, которые пользователь должен проверить на реальном сайте.

Для больших изменений:

1. После завершения этапа:
- проверить git diff;
- проверить отсутствие случайных файлов;
- выполнить связанные тесты.

2. Создать отдельный commit.

3. Сделать push в GitHub.

4. Дождаться обновления live-версии.

5. Сообщить пользователю:

- commit hash;
- список изменённых файлов;
- тесты;
- что именно проверить на live сайте.

---

### Live testing

Если изменение влияет на:

- мобильный интерфейс;
- PWA;
- player;
- fullscreen;
- navigation;

после push обязательно дать пользователю проверить реальную опубликованную версию.

Не считать задачу полностью завершённой только после локального теста.

---

### Commit strategy

Не создавать бессмысленные commits из каждого маленького изменения.

Хорошие примеры:

feat(player): improve mobile mini player

fix(router): enable account route

perf(artwork): responsive image loading

Плохие примеры:

fix margin 2px

fix another margin

change text spacing

---

### Перед большим экспериментом

Если изменение рискованное:

- создать отдельный commit/rollback point;
- только после этого продолжать эксперимент.
