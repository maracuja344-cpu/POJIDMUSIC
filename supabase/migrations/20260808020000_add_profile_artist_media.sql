begin;

alter table public.artists
    add column avatar_path text,
    add column banner_path text,
    add constraint artists_avatar_path_is_storage_path
        check (avatar_path is null or avatar_path !~* '^[[:space:]]*([a-z][a-z0-9+.-]*:|//)'),
    add constraint artists_banner_path_is_storage_path
        check (banner_path is null or banner_path !~* '^[[:space:]]*([a-z][a-z0-9+.-]*:|//)');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'profile-avatars',
    'profile-avatars',
    true,
    5242880,
    array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'artist-media',
    'artist-media',
    true,
    10485760,
    array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy profile_avatars_insert_own
on storage.objects
for insert
to authenticated
with check (
    bucket_id = 'profile-avatars'
    and owner_id = (select auth.uid())::text
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and name ~ ('^' || (select auth.uid())::text || '/avatar-[0-9a-f-]+\.(jpg|jpeg|png|webp)$')
);

create policy profile_avatars_select_own
on storage.objects
for select
to authenticated
using (
    bucket_id = 'profile-avatars'
    and owner_id = (select auth.uid())::text
    and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy profile_avatars_delete_own
on storage.objects
for delete
to authenticated
using (
    bucket_id = 'profile-avatars'
    and owner_id = (select auth.uid())::text
    and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy artist_media_insert_linked
on storage.objects
for insert
to authenticated
with check (
    bucket_id = 'artist-media'
    and owner_id = (select auth.uid())::text
    and name ~ '^[0-9a-f-]+/(avatar|banner)-[0-9a-f-]+\.(jpg|jpeg|png|webp)$'
    and exists (
        select 1
        from public.artists
        where artists.id::text = (storage.foldername(name))[1]
          and (
              artists.linked_profile_id = (select auth.uid())
              or public.current_user_is_admin()
          )
    )
);

create policy artist_media_select_owner
on storage.objects
for select
to authenticated
using (
    bucket_id = 'artist-media'
    and owner_id = (select auth.uid())::text
    and (
        public.current_user_is_admin()
        or exists (
            select 1
            from public.artists
            where artists.id::text = (storage.foldername(name))[1]
              and artists.linked_profile_id = (select auth.uid())
        )
    )
);

create policy artist_media_delete_linked
on storage.objects
for delete
to authenticated
using (
    bucket_id = 'artist-media'
    and (
        public.current_user_is_admin()
        or (
            owner_id = (select auth.uid())::text
            and exists (
                select 1
                from public.artists
                where artists.id::text = (storage.foldername(name))[1]
                  and artists.linked_profile_id = (select auth.uid())
            )
        )
    )
);

-- The linked account may attach only a newly uploaded, owned object. Direct
-- updates of artists stay denied by the table RLS from the artist migration.
create function public.set_artist_media_path(
    target_artist_id uuid,
    media_kind text,
    object_path text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    artist_row public.artists%rowtype;
    expected_prefix text;
    previous_path text;
begin
    if media_kind not in ('avatar', 'banner') then
        raise exception 'Unknown artist media kind.';
    end if;

    expected_prefix := target_artist_id::text || '/' || media_kind || '-';

    if object_path !~ ('^' || expected_prefix || '[0-9a-f-]+\.(jpg|jpeg|png|webp)$') then
        raise exception 'Invalid artist media object path.';
    end if;

    select * into artist_row
    from public.artists
    where id = target_artist_id
    for update;

    if artist_row.id is null then
        raise exception 'Artist not found.';
    end if;

    if not (
        artist_row.linked_profile_id = auth.uid()
        or public.current_user_is_admin()
    ) then
        raise exception 'Not allowed to edit this artist.';
    end if;

    if not exists (
        select 1
        from storage.objects
        where bucket_id = 'artist-media'
          and name = object_path
          and (
              owner_id = auth.uid()::text
              or public.current_user_is_admin()
          )
    ) then
        raise exception 'Uploaded artist media object was not found.';
    end if;

    if media_kind = 'avatar' then
        previous_path := artist_row.avatar_path;
        update public.artists set avatar_path = object_path
        where id = target_artist_id;
    else
        previous_path := artist_row.banner_path;
        update public.artists set banner_path = object_path
        where id = target_artist_id;
    end if;

    return previous_path;
end;
$$;

revoke all on function public.set_artist_media_path(uuid, text, text)
    from public;
grant execute on function public.set_artist_media_path(uuid, text, text)
    to authenticated;

-- No UPDATE policy is created for either bucket: clients always use a new,
-- versioned object and remove the previous object after the database commit.

commit;
