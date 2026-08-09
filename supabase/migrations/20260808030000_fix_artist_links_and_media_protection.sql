begin;

-- Link only unambiguous legacy primary artists. A link is inferred when all
-- primary credits for the artist belong to one artist-role profile and that
-- profile's display name exactly matches the normalized catalogue name.
with primary_owners as (
    select
        track_artists.artist_id,
        min(tracks.owner_id::text)::uuid as owner_id
    from public.track_artists
    join public.tracks
      on tracks.id = track_artists.track_id
    where track_artists.role = 'primary'::public.track_artist_role
    group by track_artists.artist_id
    having count(distinct tracks.owner_id) = 1
),
eligible_links as (
    select
        artists.id as artist_id,
        primary_owners.owner_id
    from primary_owners
    join public.artists
      on artists.id = primary_owners.artist_id
    join public.profiles
      on profiles.id = primary_owners.owner_id
    where artists.linked_profile_id is null
      and profiles.role = 'artist'::public.app_role
      and nullif(btrim(profiles.display_name), '') is not null
      and public.normalize_artist_name(profiles.display_name)
          = artists.normalized_name
      and not exists (
          select 1
          from public.artists as linked_artist
          where linked_artist.linked_profile_id = profiles.id
      )
)
update public.artists as artists
set linked_profile_id = eligible_links.owner_id
from eligible_links
where artists.id = eligible_links.artist_id;


-- Apply the same conservative rule to future primary credits. This does not
-- let an uploader claim an arbitrary artist name: the owner must have the
-- artist account role and an exactly matching profile display name.
create function public.link_primary_artist_to_track_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    track_owner_id uuid;
    owner_display_name text;
    owner_role public.app_role;
begin
    if new.role <> 'primary'::public.track_artist_role then
        return new;
    end if;

    select
        tracks.owner_id,
        profiles.display_name,
        profiles.role
    into
        track_owner_id,
        owner_display_name,
        owner_role
    from public.tracks
    join public.profiles
      on profiles.id = tracks.owner_id
    where tracks.id = new.track_id;

    if owner_role <> 'artist'::public.app_role
       or nullif(btrim(owner_display_name), '') is null then
        return new;
    end if;

    update public.artists as artists
    set linked_profile_id = track_owner_id
    where artists.id = new.artist_id
      and artists.linked_profile_id is null
      and artists.normalized_name
          = public.normalize_artist_name(owner_display_name)
      and not exists (
          select 1
          from public.artists as linked_artist
          where linked_artist.linked_profile_id = track_owner_id
      );

    return new;
exception
    when unique_violation then
        -- A concurrent upload may have linked the profile first.
        return new;
end;
$$;

revoke all on function public.link_primary_artist_to_track_owner()
from public;

create trigger track_artists_20_link_primary_owner
after insert on public.track_artists
for each row
execute function public.link_primary_artist_to_track_owner();


-- Prevent direct Storage deletes from leaving a database row pointing to a
-- missing profile avatar or artist avatar/banner. The normal client flow
-- updates the database first, so deletion of the previous object still works.
create function public.profile_artist_media_object_is_protected(
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
        when 'artist-media' then exists (
            select 1
            from public.artists as artist
            where artist.avatar_path = object_name
               or artist.banner_path = object_name
               or right(
                    split_part(coalesce(artist.avatar_url, ''), '?', 1),
                    char_length(object_name) + 1
                  ) = '/' || object_name
               or right(
                    split_part(coalesce(artist.banner_url, ''), '?', 1),
                    char_length(object_name) + 1
                  ) = '/' || object_name
        )
        when 'profile-avatars' then exists (
            select 1
            from public.profiles as profile
            where right(
                split_part(coalesce(profile.avatar_url, ''), '?', 1),
                char_length(object_name) + 1
            ) = '/' || object_name
        )
        else true
    end;
$$;

revoke all on function public.profile_artist_media_object_is_protected(
    text,
    text
) from public;

grant execute on function public.profile_artist_media_object_is_protected(
    text,
    text
) to authenticated;

drop policy if exists profile_avatars_delete_own
on storage.objects;

create policy profile_avatars_delete_own
on storage.objects
for delete
to authenticated
using (
    bucket_id = 'profile-avatars'
    and owner_id = (select auth.uid())::text
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and not public.profile_artist_media_object_is_protected(bucket_id, name)
);

drop policy if exists artist_media_delete_linked
on storage.objects;

create policy artist_media_delete_linked
on storage.objects
for delete
to authenticated
using (
    bucket_id = 'artist-media'
    and not public.profile_artist_media_object_is_protected(bucket_id, name)
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

commit;
