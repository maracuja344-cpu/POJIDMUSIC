# POJIDMUSIC: artwork performance

Дата замера: 2026-08-10. Этот этап меняет только доставку изображений. CSS, размеры блоков,
`object-fit`, focal crop, player transitions, Storage originals, аудио, Service Worker и схема БД
не менялись.

## A. Итог

Основная причина перерасхода: карточки размером 150-228 CSS px загружали исходные изображения
до 1200-1280 px. Один и тот же original использовался в Home, рекомендациях, mini-player и
fullscreen; у изображений не было `srcset`, `sizes`, `loading` и `decoding`.

Решение: Supabase Image Transformations поверх сохранённых public originals, измеренные tiers
320/512/768 px, отдельные 320 px avatar и 1200 px banner, native lazy loading и повышение
fullscreen до original только при открытии.

## B. Методика

Локальный CDP harness `tests/artwork-performance-runtime.py` запускал чистый профиль Chromium,
очищал HTTP/Cache Storage и повторял одинаковые сценарии:

1. cold Home;
2. warm Home;
3. первый и повторный Artist Profile;
4. Search;
5. выбор трека и открытие fullscreen.

Viewport: desktop 1424x905, DPR 1; mobile 390x844, DPR 3. Считались image requests,
transferred bytes, disk/SW cache hits, уникальные URL, file bytes, natural/rendered dimensions,
примерный RGBA decode и размещение ниже fold.

LCP в этом harness равен `null`: observer подключался после navigation и Chromium не вернул
буферизованную запись. Число не восстанавливалось косвенно и не используется в выводах.

## C. BEFORE

| Сценарий | Desktop transfer | Mobile transfer | Наблюдение |
|---|---:|---:|---|
| cold Home | 4,597,795 B / 19 req | 4,597,778 B / 19 req | 18 artwork originals |
| warm Home | 0 B / 18 req | 0 B / 18 req | disk cache |
| Artist first | 436,703 B / 11 req | 436,910 B / 11 req | original banner + avatar |
| Artist repeat | 0 B / 9 req | 0 B / 9 req | disk cache |
| Search | 0 B / 1 req | 0 B / 1 req | уже cached original |
| fullscreen | 0 B / 1 req | 0 B / 1 req | original уже загружен карточкой |

Cold Home inventory: 5,591,567 B уникальных файлов и примерно 84,940,624 B decoded RGBA.
Desktop: 37 usages, 24 ниже fold, 17 oversized. Mobile: 37 usages, 32 ниже fold,
14 oversized. Remote covers обычно 1200x1200 и весили до 660,256 B при рендере 150x150,
160x160 или 228x150.

Artist media BEFORE: banner 1983x793, 327,032 B, рендер 1098x388 desktop и 364x358 mobile;
avatar 1254x1254, 108,374 B, рендер 116x116 desktop и 82x82 mobile.

| Image type | Source | Original dimensions | Observed file size | Desktop render | Mobile render | BEFORE loading | Opportunity |
|---|---|---:|---:|---:|---:|---|---|
| track cover | `track-covers` / local | remote mostly 1200x1200; total range 500-1280 | remote examples 112,028-660,256 B | 150x150 | about 160x160 | original, eager/auto | 320/512 responsive |
| recommendation | same track original | same source set | same source bytes | 228x150 visible crop | 228x160 visible crop | original, eager/auto, below fold | 320/512/768 responsive + lazy |
| mini-player | same `track.cover` | up to 1200x1200 | same original bytes | 150x150 | 44x44 | original after Play | 320 on selection |
| fullscreen | same `track.cover` | up to 1200x1200 | same original bytes | 520x520 | 350x350 | original already paid by cards | original on demand |
| artist avatar | `artist-media` | 1254x1254 measured | 108,374 B | 116x116 | 82x82 | CSS original | 320 bound |
| artist banner | `artist-media` | 1983x793 measured | 327,032 B | 1098x388 | 364x358 | CSS original | 1200 bound |

## D. Поток данных

Track artwork:

`track-upload.js` / `track-management.js` -> bucket `track-covers` -> `tracks.cover_path` ->
`tracks-api.js:getCoverUrl()` -> `track.cover` -> `render.js` и `player.js`.

Artist artwork:

`artist-media.js` -> bucket `artist-media` -> avatar/banner path + focal metadata в `artists` ->
`app-navigation.js:getArtistMediaUrl()` -> CSS background через `applyFocalBackground()`.

Account avatar:

`artist-media.js` -> bucket `profile-avatars` -> public `profiles.avatar_url` -> account avatar
background.

Track original остаётся исходником для будущих tiers и fullscreen. Artist upload по уже
существующему контракту сохраняет нормализованный master: avatar до 512 WebP, banner до
1920x1080 WebP. Новых таблиц, колонок и derivative objects в Storage не добавлено.

## E. Реальные размеры UI

| Тип | Desktop CSS | Mobile CSS | Выдача |
|---|---:|---:|---|
| обычная карточка | 150x150 | около 160x160 | 320w / 512w по `srcset` |
| recommendation | 228x150 visible crop | 228x160 visible crop | 320w / 512w / 768w |
| mini-player | 150x150 desktop, 44x44 mobile | 44x44 | 320w |
| fullscreen | 520x520 | 350x350, DPR 3 | original по факту открытия |
| avatar | 116x116 | 82x82, DPR 3 | 320 bound |
| banner | 1098x388 | 364x358, DPR 3 | 1200 bound |

`width+height+resize=contain` задают bounding box, а не новый crop. На живом баннере это дало
1200x480 с сохранённой пропорцией 1983:793; focal positioning по-прежнему выполняет CSS.

## F. Supabase verification

Проверен реальный project endpoint, а не только документация. Запрос public render URL для
track cover вернул HTTP 200, WebP 320x320 и 19,873 B. На живом artist banner проверены режимы:
один `width=1200` дал 1200x793, а bounding `1200x1200&resize=contain` дал 1200x480 и около
114 KB. Поэтому production helper задаёт обе границы.

Официально Image Transformations используют путь `/storage/v1/render/image/public/...`,
поддерживают width/height/quality/resize и автоматическую WebP-выдачу поддерживаемым браузерам:
https://supabase.com/docs/guides/storage/serving/image-transformations

Функция тарифицируется по числу разных origin images; актуальные квоты и overage нужно
контролировать на странице тарифов: https://supabase.com/pricing

Точный plan проекта из public client определить нельзя. Практическая доступность подтверждена
ответами live endpoint.

## G. Реализация

`js/artwork.js`:

- преобразует только Supabase public object URL в render URL;
- сохраняет существующий query `v`, поэтому crop/update invalidation не теряется;
- возвращает local/legacy URL без изменений;
- формирует стабильные 320/512/768 URLs;
- ставит original fallback для `<img>` и CSS background;
- защищает background fallback от устаревшего async error после смены route.

`render.js` добавляет `srcset`, точные `sizes`, square intrinsic ratio, `decoding="async"` и
`loading`. Первые четыре New/Artist/Search карточки eager; All и Recommendations lazy.

`player.js` использует 320 px в mini-player и закрытом fullscreen. При открытии fullscreen
original предзагружается и подменяет compact URL только если track/request всё ещё актуальны.
При смене трека в открытом fullscreen существующий transition получает original, поэтому
анимация и качество не деградируют.

## H. Cache и mutations

- URL tiers детерминированы: path + width + height + quality + resize.
- warm Home, Artist repeat и Search сохранили нулевой transferred payload.
- новый upload получает новый UUID path, поэтому автоматически получает новый namespace tiers.
- замена cover/media использует существующий новый path и существующее удаление старого объекта.
- crop-only update сохраняет `?v=updated_at`; helper переносит `v` в transform URL.
- originals не перезаписываются производными и доступны для будущей переработки.
- Service Worker не менялся; transformed remote URLs обслуживаются HTTP/browser cache.

## I. AFTER

Финальные значения находятся ниже; network transfer отражает фактический critical delivery,
а inventory включает также уже существующие local/static assets в DOM.

| Сценарий | Desktop transfer | Mobile transfer |
|---|---:|---:|
| cold Home | 424,720 B / 19 req | 267,871 B / 11 req |
| warm Home | 0 B | 0 B |
| Artist first | 103,882 B / 11 req | 291,920 B / 11 req |
| Artist repeat | 0 B | 0 B |
| Search | 0 B | 0 B |
| fullscreen promotion | 112,577 B / 5 req | 128,861 B / 3 req |

Cold Home transferred delta: -90.8% desktop и -94.2% mobile. Desktop inventory снизился
с 5,591,567 до 1,423,621 B (-74.5%), estimated decoded RGBA с 84,940,624 до 22,914,864 B
(-73.0%). Mobile inventory снизился до 1,511,076 B (-73.0%), decoded до 25,164,624 B
(-70.4%). Oversized count снизился с 17 до 6 desktop и с 14 до 3 mobile.

Artist first отдельно стал легче на 76.2% desktop и 33.2% mobile. Fullscreen теперь осознанно
создаёт новый on-demand transfer: BEFORE original уже был оплачен на Home, AFTER он не входит в
critical Home и запрашивается только при открытии. Даже Home + fullscreen вместе составляют
537,297 B desktop против 4,597,795 B прежнего Home и 396,732 B mobile против 4,597,778 B.

## J. Совместимость

- Local covers и любые URL вне Supabase остаются single-source originals.
- Ошибка transform URL у `<img>` сбрасывает `srcset` и возвращает original.
- Ошибка CSS background transform возвращает original, если element всё ещё показывает тот же request.
- Upload/edit/crop API, DB metadata и RLS не изменены.
- Публичные originals остаются публичными в соответствии с текущей архитектурой.

## K. Проверки

- `python tests/browser-page-tests.py`: все deterministic pages passed.
- `artwork.test.html`: 8/8 assertions, включая original fallback.
- `player-runtime.test.html`: 13 passed; real headless media play остаётся помечен `BLOCKED`,
  остальные player/fullscreen/navigation/reload сценарии прошли.
- `python tests/artwork-performance-runtime.py`: desktop/mobile cold/warm/artist/search/fullscreen.
- `python tests/artwork-visual-runtime.py`: desktop/mobile Home и fullscreen screenshots.

Реальные authenticated upload/edit mutations не выполнялись, чтобы не менять пользовательские
данные. Их cover/avatar/banner/crop paths проверены по production-коду; новая выдача полностью
вычисляется из уже обновляемых path/`updated_at`, поэтому отдельной derivative mutation нет.

## L. Что сознательно не менялось

CSS и layout, видимый crop, artist focal controls, player animation, queue decisions, audio URL
resolver, Service Worker/PWA, router, auth/RLS и Supabase schema.

## M. Остаточные риски

- Image Transformations расходуют Supabase quota; нужно следить за usage после production rollout.
- Некоторые local/static covers меньше целевого DPR и остаются как есть: helper не может безопасно
  создать им CDN derivative.
- Большие исходники всё ещё намеренно загружаются при fullscreen; это качество по требованию,
  а не Home critical cost.
- Текущий LCP harness нужно подключать через `Page.addScriptToEvaluateOnNewDocument`, если потребуется
  отдельная статистически устойчивaя LCP серия.

## N. Рекомендации

1. Через 7-14 дней проверить Supabase transformed image usage и cache hit rate.
2. Для будущих uploads при необходимости сохранять intrinsic width/height metadata, чтобы точнее
   выбирать banner tier без декодирования файла.
3. Не добавлять новые tiers без реального нового rendered-size кластера: каждый вариант увеличивает
   cache cardinality.

## O. Критерий завершения

Фактические AFTER значения зафиксированы, browser suites зелёные. Originals сохранены; четыре
desktop/mobile Home/fullscreen screenshots просмотрены: пропорции, crop, layout и fullscreen
композиция не изменились.
