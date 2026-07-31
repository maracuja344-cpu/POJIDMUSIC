begin;

-- Buckets are configured by this migration only. The upsert updates limits
-- without dropping buckets or touching existing objects.
insert into storage.buckets (
    id,
    name,
    public,
    file_size_limit,
    allowed_mime_types
)
values
    (
        'track-audio',
        'track-audio',
        false,
        52428800,
        array[
            'audio/mpeg',
            'audio/wav',
            'audio/x-wav',
            'audio/flac',
            'audio/x-flac'
        ]::text[]
    ),
    (
        'track-covers',
        'track-covers',
        true,
        5242880,
        array[
            'image/jpeg',
            'image/png',
            'image/webp'
        ]::text[]
    )
on conflict (id) do update
set
    name = excluded.name,
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;


-- Bucket lifecycle remains server-managed even if a permissive buckets policy
-- is added later. Reading bucket metadata is not changed.
revoke insert, update, delete
on table storage.buckets
from anon, authenticated;


-- This helper deliberately bypasses tracks RLS so a hidden or otherwise
-- non-visible track association cannot be missed by an artist DELETE policy.
create or replace function public.track_storage_object_is_protected(
    object_bucket_id text,
    object_name text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select case object_bucket_id
        when 'track-audio' then exists (
            select 1
            from public.tracks as track
            where track.audio_path = object_name
              and track.status in (
                  'published'::public.track_status,
                  'hidden'::public.track_status
              )
        )
        when 'track-covers' then exists (
            select 1
            from public.tracks as track
            where track.cover_path = object_name
              and track.status in (
                  'published'::public.track_status,
                  'hidden'::public.track_status
              )
        )
        else true
    end;
$$;

revoke all on function public.track_storage_object_is_protected(text, text)
from public;

grant execute on function public.track_storage_object_is_protected(text, text)
to authenticated;


-- Re-running this migration replaces only its own policies.
drop policy if exists track_audio_insert_artist
on storage.objects;

drop policy if exists track_covers_insert_artist
on storage.objects;

drop policy if exists track_audio_select_authenticated
on storage.objects;

drop policy if exists track_covers_select_owner
on storage.objects;

drop policy if exists track_media_delete_artist
on storage.objects;

drop policy if exists track_media_delete_admin
on storage.objects;


-- Audio uploads: artist role, authenticated UUID folder, UUID filename,
-- and one of the extensions matching the bucket's allowed audio MIME types.
create policy track_audio_insert_artist
on storage.objects
for insert
to authenticated
with check (
    bucket_id = 'track-audio'
    and (select auth.uid()) is not null
    and public.current_user_is_artist()
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and name ~ (
        '^'
        || (select auth.uid())::text
        || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-'
        || '[0-9a-f]{4}-[0-9a-f]{12}\.(mp3|wav|flac)$'
    )
);


-- Cover uploads use the same ownership and UUID-path rules.
create policy track_covers_insert_artist
on storage.objects
for insert
to authenticated
with check (
    bucket_id = 'track-covers'
    and (select auth.uid()) is not null
    and public.current_user_is_artist()
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and name ~ (
        '^'
        || (select auth.uid())::text
        || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-'
        || '[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$'
    )
);


-- Private audio may be read by its authenticated owner, by authenticated
-- users when public.tracks.audio_path references a published track, or by
-- a profile admin. No anonymous audio access is granted.
create policy track_audio_select_authenticated
on storage.objects
for select
to authenticated
using (
    bucket_id = 'track-audio'
    and (
        (
            (select auth.uid()) is not null
            and owner_id = (select auth.uid())::text
            and (storage.foldername(name))[1] = (select auth.uid())::text
        )
        or exists (
            select 1
            from public.tracks as track
            where track.audio_path = storage.objects.name
              and track.status = 'published'::public.track_status
        )
        or public.current_user_is_admin()
    )
);


-- Public cover delivery uses the bucket's public endpoint. This narrow policy
-- only lets an authenticated uploader read metadata for their own object,
-- which is required for the Storage API's INSERT ... RETURNING response.
create policy track_covers_select_owner
on storage.objects
for select
to authenticated
using (
    bucket_id = 'track-covers'
    and (select auth.uid()) is not null
    and owner_id = (select auth.uid())::text
    and (storage.foldername(name))[1] = (select auth.uid())::text
);


-- Artists may remove only authenticated-owned objects in their own UUID
-- folder, and only while no published or hidden track references the path.
create policy track_media_delete_artist
on storage.objects
for delete
to authenticated
using (
    bucket_id in ('track-audio', 'track-covers')
    and (select auth.uid()) is not null
    and public.current_user_is_artist()
    and owner_id = (select auth.uid())::text
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and not public.track_storage_object_is_protected(bucket_id, name)
);


-- Admin deletion is limited to the two application-owned track buckets.
create policy track_media_delete_admin
on storage.objects
for delete
to authenticated
using (
    bucket_id in ('track-audio', 'track-covers')
    and public.current_user_is_admin()
);

-- Intentionally no UPDATE policy: overwrite/upsert operations remain denied.
-- No permissive public SELECT policy is added for track-covers: public bucket
-- delivery remains responsible for anonymous cover reads.

commit;
