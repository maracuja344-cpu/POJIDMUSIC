begin;

-- Crop state belongs to the artist media entity, not to an account avatar.
alter table public.artists
    add column avatar_focal_x numeric not null default 0.5,
    add column avatar_focal_y numeric not null default 0.5,
    add column avatar_zoom numeric not null default 1,
    add column banner_focal_x numeric not null default 0.5,
    add column banner_focal_y numeric not null default 0.5,
    add column banner_zoom numeric not null default 1,
    add constraint artists_avatar_focal_x_range check (avatar_focal_x between 0 and 1),
    add constraint artists_avatar_focal_y_range check (avatar_focal_y between 0 and 1),
    add constraint artists_avatar_zoom_range check (avatar_zoom between 1 and 4),
    add constraint artists_banner_focal_x_range check (banner_focal_x between 0 and 1),
    add constraint artists_banner_focal_y_range check (banner_focal_y between 0 and 1),
    add constraint artists_banner_zoom_range check (banner_zoom between 1 and 4);

-- The existing artist insert policy remains owner-scoped. This companion is
-- only for the already-authorized admin edit path and still enforces a UUID
-- folder plus a versioned UUID filename.
create policy track_covers_insert_admin
on storage.objects
for insert
to authenticated
with check (
    bucket_id = 'track-covers'
    and public.current_user_is_admin()
    and name ~ '^[0-9a-f-]+/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$'
);

create function public.update_artist_profile(
    target_artist_id uuid,
    new_display_name text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    clean_name text := regexp_replace(btrim(new_display_name), '[[:space:]]+', ' ', 'g');
    artist_owner uuid;
begin
    select linked_profile_id into artist_owner
    from public.artists
    where id = target_artist_id
    for update;

    if artist_owner is null then raise exception 'Artist not found or is not linked.'; end if;
    if artist_owner <> auth.uid() and not public.current_user_is_admin() then
        raise exception 'Not allowed to edit this artist.';
    end if;
    if clean_name is null or clean_name = '' or char_length(clean_name) > 200 then
        raise exception 'Artist name must contain 1 to 200 characters.';
    end if;

    -- The stable artist id and slug deliberately remain unchanged. Structured
    -- credits immediately pick up this canonical display name.
    update public.artists
    set display_name = clean_name,
        normalized_name = public.normalize_artist_name(clean_name)
    where id = target_artist_id;
end;
$$;

create function public.set_artist_crop(
    target_artist_id uuid,
    media_kind text,
    focal_x numeric,
    focal_y numeric,
    zoom_value numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare artist_owner uuid;
begin
    if media_kind not in ('avatar', 'banner')
       or focal_x not between 0 and 1
       or focal_y not between 0 and 1
       or zoom_value not between 1 and 4 then
        raise exception 'Invalid crop state.';
    end if;
    select linked_profile_id into artist_owner
    from public.artists where id = target_artist_id for update;
    if artist_owner is null then raise exception 'Artist not found or is not linked.'; end if;
    if artist_owner <> auth.uid() and not public.current_user_is_admin() then
        raise exception 'Not allowed to edit this artist.';
    end if;
    if media_kind = 'avatar' then
        update public.artists set
            avatar_focal_x = focal_x, avatar_focal_y = focal_y, avatar_zoom = zoom_value
        where id = target_artist_id;
    else
        update public.artists set
            banner_focal_x = focal_x, banner_focal_y = focal_y, banner_zoom = zoom_value
        where id = target_artist_id;
    end if;
end;
$$;

create function public.set_artist_media_with_crop(
    target_artist_id uuid,
    media_kind text,
    object_path text,
    focal_x numeric,
    focal_y numeric,
    zoom_value numeric
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    artist_row public.artists%rowtype;
    previous_path text;
begin
    if media_kind not in ('avatar', 'banner')
       or focal_x not between 0 and 1
       or focal_y not between 0 and 1
       or zoom_value not between 1 and 4 then
        raise exception 'Invalid artist media crop.';
    end if;
    if object_path !~ ('^' || target_artist_id::text || '/' || media_kind || '-[0-9a-f-]+\.(jpg|jpeg|png|webp)$') then
        raise exception 'Invalid artist media object path.';
    end if;
    select * into artist_row from public.artists
    where id = target_artist_id for update;
    if artist_row.id is null then raise exception 'Artist not found.'; end if;
    if artist_row.linked_profile_id <> auth.uid() and not public.current_user_is_admin() then
        raise exception 'Not allowed to edit this artist.';
    end if;
    if not exists (
        select 1 from storage.objects
        where bucket_id = 'artist-media' and name = object_path
          and (owner_id = auth.uid()::text or public.current_user_is_admin())
    ) then raise exception 'Uploaded artist media object was not found.'; end if;

    if media_kind = 'avatar' then
        previous_path := artist_row.avatar_path;
        update public.artists set avatar_path = object_path,
            avatar_focal_x = focal_x, avatar_focal_y = focal_y, avatar_zoom = zoom_value
        where id = target_artist_id;
    else
        previous_path := artist_row.banner_path;
        update public.artists set banner_path = object_path,
            banner_focal_x = focal_x, banner_focal_y = focal_y, banner_zoom = zoom_value
        where id = target_artist_id;
    end if;
    return previous_path;
end;
$$;

create function public.update_managed_track(
    target_track_id uuid,
    new_title text,
    new_cover_path text,
    primary_artist_ids uuid[],
    primary_artist_names text[],
    featured_artist_ids uuid[] default '{}'::uuid[],
    featured_artist_names text[] default '{}'::text[]
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    track_row public.tracks%rowtype;
    clean_title text := regexp_replace(btrim(new_title), '[[:space:]]+', ' ', 'g');
    ids uuid[] := coalesce(primary_artist_ids, '{}'::uuid[]) || coalesce(featured_artist_ids, '{}'::uuid[]);
    names text[] := coalesce(primary_artist_names, '{}'::text[]) || coalesce(featured_artist_names, '{}'::text[]);
    primary_count integer := cardinality(coalesce(primary_artist_names, '{}'::text[]));
    featured_count integer := cardinality(coalesce(featured_artist_names, '{}'::text[]));
    resolved_ids uuid[] := '{}'::uuid[];
    resolved_names text[] := '{}'::text[];
    item_id uuid;
    item_name text;
    canonical_name text;
    i integer;
begin
    select * into track_row from public.tracks where id = target_track_id for update;
    if track_row.id is null then raise exception 'Track not found.'; end if;
    if track_row.owner_id <> auth.uid() and not public.current_user_is_admin() then
        raise exception 'Not allowed to edit this track.';
    end if;
    if track_row.owner_id = auth.uid() and not (public.current_user_is_artist() or public.current_user_is_admin()) then
        raise exception 'Artist account role is required.';
    end if;
    if clean_title is null or clean_title = '' or char_length(clean_title) > 200 then
        raise exception 'Track title must contain 1 to 200 characters.';
    end if;
    if primary_count < 1 or primary_count > 10 or featured_count > 10
       or cardinality(coalesce(primary_artist_ids, '{}'::uuid[])) <> primary_count
       or cardinality(coalesce(featured_artist_ids, '{}'::uuid[])) <> featured_count then
        raise exception 'Invalid structured artist credits.';
    end if;

    for i in 1..cardinality(names) loop
        item_id := ids[i];
        item_name := regexp_replace(btrim(names[i]), '[[:space:]]+', ' ', 'g');
        if item_id is null then item_id := public.ensure_artist(item_name); end if;
        select display_name into canonical_name from public.artists where id = item_id;
        if canonical_name is null then raise exception 'Artist not found: %', item_id; end if;
        if item_id = any(resolved_ids) then raise exception 'Duplicate artist credit: %', canonical_name; end if;
        resolved_ids := array_append(resolved_ids, item_id);
        resolved_names := array_append(resolved_names, canonical_name);
    end loop;

    if new_cover_path is not null and new_cover_path <> track_row.cover_path then
        if new_cover_path !~ ('^' || track_row.owner_id::text || '/[0-9a-f-]+\.(jpg|jpeg|png|webp)$')
           or not exists (
                select 1 from storage.objects
                where bucket_id = 'track-covers' and name = new_cover_path
                  and (owner_id = auth.uid()::text or public.current_user_is_admin())
           ) then raise exception 'Uploaded track cover was not found.'; end if;
    end if;

    delete from public.track_artists where track_id = target_track_id;
    for i in 1..cardinality(resolved_ids) loop
        insert into public.track_artists(track_id, artist_id, role, position)
        values (
            target_track_id, resolved_ids[i],
            case when i <= primary_count then 'primary'::public.track_artist_role else 'featured'::public.track_artist_role end,
            case when i <= primary_count then i - 1 else i - primary_count - 1 end
        );
    end loop;
    update public.tracks set
        title = clean_title,
        cover_path = coalesce(new_cover_path, cover_path),
        artist_name = array_to_string(resolved_names[1:primary_count], ' & ')
            || case when featured_count > 0 then ' feat. ' || array_to_string(resolved_names[primary_count + 1:cardinality(resolved_names)], ', ') else '' end
    where id = target_track_id;
    return track_row.cover_path;
end;
$$;

create function public.set_managed_track_visibility(target_track_id uuid, make_hidden boolean)
returns public.track_status
language plpgsql security definer set search_path = ''
as $$
declare track_row public.tracks%rowtype; next_status public.track_status;
begin
    select * into track_row from public.tracks where id = target_track_id for update;
    if track_row.id is null then raise exception 'Track not found.'; end if;
    if track_row.owner_id <> auth.uid() and not public.current_user_is_admin() then raise exception 'Not allowed to manage this track.'; end if;
    if track_row.status not in ('published'::public.track_status, 'hidden'::public.track_status) then raise exception 'Only published or hidden tracks can change visibility.'; end if;
    next_status := case when make_hidden then 'hidden'::public.track_status else 'published'::public.track_status end;
    update public.tracks set status = next_status where id = target_track_id;
    return next_status;
end;
$$;

create function public.delete_managed_track(target_track_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare track_row public.tracks%rowtype;
begin
    select * into track_row from public.tracks where id = target_track_id for update;
    if track_row.id is null then raise exception 'Track not found.'; end if;
    if track_row.owner_id <> auth.uid() and not public.current_user_is_admin() then raise exception 'Not allowed to delete this track.'; end if;
    delete from public.tracks where id = target_track_id;
    return jsonb_build_object('cover_path', track_row.cover_path, 'audio_path', track_row.audio_path);
end;
$$;

revoke all on function public.update_artist_profile(uuid, text) from public;
revoke all on function public.set_artist_crop(uuid, text, numeric, numeric, numeric) from public;
revoke all on function public.set_artist_media_with_crop(uuid, text, text, numeric, numeric, numeric) from public;
revoke all on function public.update_managed_track(uuid, text, text, uuid[], text[], uuid[], text[]) from public;
revoke all on function public.set_managed_track_visibility(uuid, boolean) from public;
revoke all on function public.delete_managed_track(uuid) from public;
grant execute on function public.update_artist_profile(uuid, text) to authenticated;
grant execute on function public.set_artist_crop(uuid, text, numeric, numeric, numeric) to authenticated;
grant execute on function public.set_artist_media_with_crop(uuid, text, text, numeric, numeric, numeric) to authenticated;
grant execute on function public.update_managed_track(uuid, text, text, uuid[], text[], uuid[], text[]) to authenticated;
grant execute on function public.set_managed_track_visibility(uuid, boolean) to authenticated;
grant execute on function public.delete_managed_track(uuid) to authenticated;

commit;
