# POJIDMUSIC: PWA release and offline baseline

Дата: 2026-08-10. Scope этапа: Service Worker, cache generation, update lifecycle и
предсказуемый degraded/offline shell. UI, player, artwork, audio resolver, Supabase data cache,
schema/RLS и query-router не менялись.

## A. Методика

`tests/pwa-baseline-runtime.py` использовал новый Chromium profile и последовательно проверял:

1. первый online load и регистрацию worker;
2. controlled reload;
3. Cache Storage и resource requests;
4. offline reload;
5. состояние DOM и missing requests.

`tests/pwa-runtime.py` затем моделировал три server releases на одном origin:

1. полную Version A с недоступной optional icon;
2. broken intermediate version с недоступным critical CSS;
3. полную Version B;
4. offline reload после B.

Installed standalone window нельзя воспроизвести достоверно в headless Chromium. Проверены тот же
SW scope/lifecycle и mobile-responsive application runtime; browser-chrome standalone semantics
остаются ручной device-проверкой.

## B. BEFORE: service worker

Worker `pojidmusic-static-v5` делал `cache.addAll()` для вручную заданных 33 URL, сразу вызывал
`skipWaiting()`, удалял все старые `pojidmusic-*` cache и вызывал `clients.claim()`.

Navigation использовал network-first и записывал каждый URL с query в тот же cache. JS, CSS,
images, fonts и manifest использовали stale-while-revalidate в одном общем cache. Клиент не
обрабатывал `controllerchange` и не перезагружался после смены worker.

| Проверка BEFORE | Результат |
|---|---|
| registered worker | active `service-worker.js`, no waiting/installing |
| initial Cache Storage | один `pojidmusic-static-v5`, 33 declared entries |
| cache generations | одна, но shell и runtime responses смешаны |
| controlled JS/CSS | старый response сразу, новый только background update |
| navigation | свежий network HTML мог сочетаться со старыми JS/CSS |
| update of open client | новый worker claim без reload module graph |
| offline guarantee immediately after install | отсутствовала |
| runtime pollution | query navigation, missing JS и local images добавлялись в shell cache |

## C. BEFORE: missing precache graph

Автоматический обход от `js/script.js`, включая string-literal dynamic imports, дал 26 production
ES modules. В v5 отсутствовали восемь реально требуемых файлов:

- `js/artwork.js`;
- `js/queue-decisions.js`;
- `js/audio-url-resolver.js`;
- `js/audio-url-resolver-core.js`;
- `js/data-cache.js`;
- `js/data-repository.js`;
- `js/image-cropper.js`;
- `js/track-management.js`.

Неиспользуемый `js/navigation.js`, наоборот, находился в precache. Controlled online load скрывал
ошибку: stale-while-revalidate постепенно добавлял missing modules в v5. Поэтому offline после
предыдущего полного online boot мог работать иначе, чем clean offline сразу после install.

## D. BEFORE: request routing

| Resource | BEFORE behavior |
|---|---|
| `index.html` / root navigation | network-first, cache write per request URL |
| same-origin JS/CSS | stale-while-revalidate |
| local images | stale-while-revalidate, включая runtime artwork |
| transformed Supabase artwork | cross-origin, SW bypass |
| audio | explicit SW bypass |
| Supabase REST/Auth/Storage data | cross-origin, SW bypass |
| esm.sh SDK | cross-origin, SW bypass; зависимость от HTTP cache |

Offline baseline через пять секунд имел CSS и module responses из уже прогретого v5, но ноль
карточек. Supabase catalog requests падали offline, а локальный fallback ожидал network timeout.
Результат был зависим от того, успел ли предыдущий online run случайно наполнить runtime cache.

## E. BEFORE: esm.sh

Import `https://esm.sh/@supabase/supabase-js@2` фиксировал только major version. Live response
2026-08-10 разрешился в `2.112.2` и создал 17 observed module requests, включая Supabase
subpackages, Node shims, Phoenix, tslib и iceberg. Cache Storage не содержал ни одного из них;
offline boot зависел от непрозрачного browser HTTP cache.

## F. Root cause stale/mixed version

Cache name был versioned, но response strategy не была release-atomic:

1. старый worker мог получить HTML N+1 через network-first;
2. тот же worker возвращал JS/CSS N из stale cache;
3. background writes частично заменяли файлы внутри v5;
4. `clients.claim()` менял controller без reload уже загруженного graph;
5. incomplete precache делал clean offline недетерминированным.

## G. AFTER: cache contract

Release marker: `pwa-v7`, одинаковый в `service-worker.js` и `index.html`.

Cache Storage содержит ровно два purpose-specific cache:

- `pojidmusic-shell-pwa-v7`: одна полная local app-shell generation;
- `pojidmusic-sdk-supabase-2.112.2`: immutable pinned external SDK graph.

Activation удаляет только другие cache с prefix `pojidmusic-`. Unrelated caches не удаляются.
Неполная release не активируется: critical local shell и SDK graph должны полностью заполниться
до `skipWaiting()`. Install использует `Request.cache = "reload"`, поэтому новая generation не
может заполниться stale response из обычного HTTP cache. Семь icons являются optional и
cache-ятся через `Promise.allSettled()`.

## H. AFTER: navigation

Только root и `index.html` navigation относятся к SPA shell. Страницы `/tests/*.html` и другие
independent documents не подменяются приложением.

Online worker делает network-first, но принимает HTML только если его
`<meta name="pojidmusic-release">` совпадает с собственной release. Если server уже отдаёт N+1,
worker N возвращает cached HTML N до завершения update. Offline используется cached `index.html`
текущей полной generation. Query-router (`?artist=...`) продолжает работать через тот же shell.

## I. AFTER: JS/CSS и update flow

Все critical same-origin JS/CSS/manifest/fallback resources выдаются cache-first только из
активной shell generation. Runtime response не записывается поверх неё. Cache miss critical
resource возвращает 503 вместо незаметного смешивания с неизвестной server generation.

Registration использует `updateViaCache: "none"` и вызывает `registration.update()`. Новый worker
install -> `skipWaiting()` -> activate/cleanup -> `clients.claim()` -> `controllerchange`.
Клиент запрашивает у controller точный `RELEASE_VERSION` через `MessageChannel`, сохраняет его в
sessionStorage и делает один reload.

Reload-loop guard хранит последнюю уже перезагруженную release, а не временной интервал. Повторный
`controllerchange` той же release игнорируется; следующая release получает новый token и может
немедленно обновиться.

## J. AFTER: app shell

Critical shell: `index.html`, CSS, local catalog, manifest, fallback cover и полный closure из
28 production modules. Полный список находится рядом с worker install policy и автоматически
сверяется `tests/check-pwa-shell.py`.

Не входят в Cache Storage:

- Supabase REST/Auth/Storage data;
- remote или transformed artwork;
- local catalog artwork, кроме shell fallback;
- local/remote audio;
- arbitrary runtime responses.

## K. AFTER: Supabase SDK

Client pin: `@supabase/supabase-js@2.112.2?bundle`. Static bundle graph состоит из семи exact URLs
и cache-ится отдельно cache-first. Версия package соответствует версии, которую реально отдавал
прежний `@2` URL в baseline; бизнес API и Supabase configuration не менялись.

SDK graph является critical, потому что production boot graph статически импортирует client через
player/data/navigation modules. Если CDN недоступен при установке новой release, install корректно
падает и предыдущий complete worker остаётся active. Optional local icon failure install не блокирует.

## L. Automated deployment result

| Scenario | Result |
|---|---|
| clean install A | active, usable UI, 2 purpose caches, 0 reloads |
| optional icon unavailable | A still installed and activated |
| critical CSS unavailable in intermediate release | install rejected; controller stayed A; 0 reloads |
| deploy B | B installed/activated |
| controller change | exactly 1 automatic reload |
| HTML / JS / CSS after reload | all `pwa-v7`, mixed-version = false |
| old/partial cache cleanup | A and broken generation removed |
| remaining generations | one shell generation + one exact SDK cache |
| offline reload desktop | CSS loaded, 7 local cards, 0 same-origin module failures |
| offline reload mobile | 390x844, DPR 3, mobile class, 7 local cards, release `pwa-v7` |

## M. BEFORE / AFTER KPI

| KPI | BEFORE | AFTER |
|---|---|---|
| stale/mixed shell risk after deploy | possible indefinitely | 0 mixed responses in A -> B test |
| missing critical local modules at install | 8 | 0 |
| automatic client reload | 0 | exactly 1 per new release |
| manual close/hard reload required | possible | no in automated upgrade |
| cache generations after activation | shared mutable v5 | one immutable shell generation |
| clean offline UI | nondeterministic | shell + 7 local cards |

## N. Known offline limitations

- Supabase data is deliberately not persisted; offline catalog falls back to `tracks.js` after the
  existing request timeout.
- Remote artwork is not available unless browser HTTP cache already has it; fallback/local images
  remain subject to their normal cache state.
- Remote signed audio and Supabase mutations/auth are unavailable offline.
- Local audio is intentionally not precached because of its size.
- Chromium CDP accepted a `display-mode: standalone` emulation request but `matchMedia` remained
  false; installed window chrome and OS update scheduling therefore require a manual device check.
- Dynamic tracing-only bare import inside the upstream Supabase bundle is not used by current boot;
  enabling that optional SDK tracing path would require reviewing its offline mapping.

## O. Release maintenance rule

Every deploy that changes `index.html`, `style.css`, `tracks.js`, a critical module, manifest, or
fallback shell asset must:

1. bump `RELEASE_VERSION` in `service-worker.js`;
2. set the same marker in `index.html`;
3. keep the pinned SDK import and `SDK_ASSETS` aligned;
4. run `python tests/check-pwa-shell.py` and `python tests/pwa-runtime.py`.

No timestamp query parameters are needed for JS/CSS.

## P. Next stability step

Without starting DOM optimization, the next highest stability return is authenticated live
integration coverage for RLS-backed upload/edit/delete and degraded network timeouts. PWA work
should next receive a short manual installed Android/iOS/desktop checklist on a deployed HTTPS
origin; no further cache expansion is recommended without measured offline product requirements.
