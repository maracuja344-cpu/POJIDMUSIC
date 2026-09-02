# SQL-миграции Supabase

Миграции проекта находятся в каталоге `supabase/migrations/`.

Миграции применяются по имени файла, в хронологическом порядке:

```text
20260731023000_create_profiles_and_tracks.sql
20260731025213_fix_profile_role_management.sql
20260731030610_prepare_track_storage.sql
20260731041025_allow_anon_read_published_track_audio.sql
20260808010000_create_artist_system.sql
20260808020000_add_profile_artist_media.sql
20260808030000_fix_artist_links_and_media_protection.sql
20260808040000_add_structured_collab_upload.sql
20260808050000_unify_artist_profile_management.sql
20260823090000_enforce_artist_profile_invariant.sql
20260902191700_create_telegram_accounts.sql
```

Миграция artist system добавляет отдельные `artists` и `track_artists`, защищённую RPC для кредитов и консервативный backfill старого `artist_name`. Неоднозначные кредиты она не угадывает: такие строки остаются fallback и выводятся как `NOTICE` для ручной проверки.

Последняя миграция добавляет пути аватара и баннера артиста, публичные buckets `artist-media` и `profile-avatars`, узкие Storage RLS-политики и RPC `set_artist_media_path`. RPC связывает только уже загруженный объект с артистом, которым управляет текущий связанный аккаунт; прямой `UPDATE artists` клиенту по-прежнему не разрешён.

Миграция `20260902191700_create_telegram_accounts.sql` добавляет закрытую таблицу
однозначной связи Telegram/Supabase. Для неё включён RLS, клиентские policies
отсутствуют, а права `anon` и `authenticated` явно отозваны; доступ остаётся только у
серверной Edge Function `telegram-auth`.

Исправляющая миграция `20260808030000_fix_artist_links_and_media_protection.sql` консервативно связывает однозначные primary-credit с artist-профилем владельца при точном совпадении display name, применяет то же правило к будущим кредитам и запрещает удалять из Storage ещё используемые avatar/banner-объекты.

Миграция `20260808040000_add_structured_collab_upload.sql` обратно совместимо расширяет credits RPC ordered-массивами Artist ID/name для нескольких primary и featured artists и добавляет защищённый autocomplete по имени, normalized name и handle.

Миграция `20260808050000_unify_artist_profile_management.sql` добавляет независимые crop metadata для avatar/banner и owner/admin RPC для переименования Artist entity, транзакционного редактирования structured credits и versioned cover path, hide/restore и удаления трека. Execute остаётся только у `authenticated`; прямые table writes и public audio не открываются.

Миграция `20260823090000_enforce_artist_profile_invariant.sql` вводит атомарный
инвариант `profile role=artist -> linked artists row`. Параметрическая server-side
функция доступна только триггеру, а браузер вызывает только параметрический-free RPC
`activate_current_user_as_artist()`, который берёт пользователя из `auth.uid()`.
Будущие совпадения имён не присваиваются автоматически: конфликт имени откатывает
операцию. Exact-name backfill ограничен подтверждёнными production-профилями Zhorik
и Lufy и требует однозначной незанятой строки Artist.

## Как применить вручную

1. Откройте нужный проект в Supabase Dashboard.
2. Убедитесь, что выбран именно проект pozhidmusic.
3. Откройте раздел **SQL Editor**.
4. Нажмите **New query**.
5. Откройте следующий ещё не применённый файл из списка выше.
6. Скопируйте в SQL Editor файл целиком, включая `begin;` и `commit;`.
7. Ещё раз проверьте имя проекта и содержимое запроса.
8. Нажмите **Run** один раз.
9. Повторите шаги для остальных файлов строго по порядку.
10. После последней миграции убедитесь, что появились `artists`, `track_artists`, оба media bucket и все указанные RLS-политики.

Не запускайте отдельные фрагменты миграции и не запускайте весь файл повторно: это последовательная миграция для пустой схемы приложения. При ошибке транзакция должна откатиться целиком; сохраните текст ошибки и сначала выясните причину.

## Что проверить после применения

- В `profiles` включён RLS.
- В `tracks` включён RLS.
- В схеме `public` есть enum-типы `app_role`, `track_status`, `release_type` и `track_artist_role`.
- У опубликованных однозначных старых треков появились строки в `track_artists`.
- В `artists` появились `avatar_path` и `banner_path`.
- Buckets `artist-media` и `profile-avatars` публичны для доставки файлов, но запись и удаление ограничены владельцем/связанным аккаунтом через Storage RLS.
- Выполнение `set_artist_media_path` разрешено `authenticated`, а прямое изменение `artists` из браузера остаётся запрещено.
- Однозначные артисты с совпадающим artist-профилем получили `linked_profile_id`; удаление активного profile/artist media-объекта блокируется Storage RLS.
- В выводе SQL Editor проверены `NOTICE` о кредитах, требующих ручного разбора.
- В **Authentication → Users** создание тестового пользователя автоматически создаёт строку `profiles` с ролью `listener`.
- Клиент с Publishable Key видит только опубликованные треки.
- Выбор artist при signup хранится только как UX-намерение `account_type`; роль и
  связь создаёт защищённый RPC/trigger. `user_metadata` не является источником
  авторизации.
- Для каждого `profiles.role = 'artist'` существует ровно одна строка `artists` с
  `linked_profile_id = profiles.id`; конфликт будущего имени не оставляет частично
  назначенную роль.

Создание тестового Auth-пользователя и любые проверки с данными выполняйте отдельным этапом. Secret Key, `service_role` и Database Password нельзя добавлять в браузерный код.
