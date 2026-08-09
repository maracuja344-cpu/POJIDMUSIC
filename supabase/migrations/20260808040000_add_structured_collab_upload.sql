begin;

-- The first three parameters keep the original RPC contract intact. New
-- clients additionally pass parallel ID/name arrays so IDs are authoritative
-- while an explicitly selected placeholder can still be resolved by name.
drop function public.set_track_artist_credits(uuid, text, text[]);

create function public.set_track_artist_credits(
    target_track_id uuid,
    primary_artist_name text,
    featured_artist_names text[] default '{}'::text[],
    primary_artist_ids uuid[] default '{}'::uuid[],
    primary_artist_names text[] default '{}'::text[],
    featured_artist_ids uuid[] default '{}'::uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    track_owner_id uuid;
    track_status_value public.track_status;
    primary_ids uuid[] := coalesce(primary_artist_ids, '{}'::uuid[]);
    primary_names text[] := coalesce(primary_artist_names, '{}'::text[]);
    featured_ids uuid[] := coalesce(featured_artist_ids, '{}'::uuid[]);
    featured_names text[] := coalesce(featured_artist_names, '{}'::text[]);
    resolved_primary_ids uuid[] := '{}'::uuid[];
    resolved_primary_names text[] := '{}'::text[];
    resolved_featured_ids uuid[] := '{}'::uuid[];
    resolved_featured_names text[] := '{}'::text[];
    seen_artist_ids uuid[] := '{}'::uuid[];
    item_id uuid;
    item_name text;
    stored_name text;
    item_index integer;
    primary_count integer;
    featured_count integer;
begin
    select owner_id, status
    into track_owner_id, track_status_value
    from public.tracks
    where id = target_track_id
    for update;

    if track_owner_id is null then
        raise exception 'Track not found.';
    end if;

    if not (
        track_owner_id = auth.uid()
        or public.current_user_is_admin()
    ) then
        raise exception 'Not allowed to edit this track.';
    end if;

    if track_owner_id = auth.uid()
       and not (
           public.current_user_is_artist()
           or public.current_user_is_admin()
       ) then
        raise exception 'Artist account role is required.';
    end if;

    if not public.current_user_is_admin()
       and track_status_value not in (
           'draft'::public.track_status,
           'pending'::public.track_status
       ) then
        raise exception 'Credits can only be edited before publication.';
    end if;

    -- Legacy callers provide one primary name and no structured arrays.
    if cardinality(primary_ids) = 0
       and cardinality(primary_names) = 0 then
        primary_ids := array[null::uuid];
        primary_names := array[primary_artist_name];
    elsif cardinality(primary_ids) <> cardinality(primary_names) then
        raise exception 'Primary artist ID and name arrays must have equal length.';
    end if;

    if cardinality(featured_ids) = 0
       and cardinality(featured_names) > 0 then
        featured_ids := array_fill(
            null::uuid,
            array[cardinality(featured_names)]
        );
    elsif cardinality(featured_ids) <> cardinality(featured_names) then
        raise exception 'Featured artist ID and name arrays must have equal length.';
    end if;

    primary_count := cardinality(primary_names);
    featured_count := cardinality(featured_names);

    if primary_count < 1 or primary_count > 10 then
        raise exception 'One to 10 primary artists are required.';
    end if;

    if featured_count > 10 then
        raise exception 'No more than 10 featured artists are allowed.';
    end if;

    for item_index in 1..primary_count loop
        item_id := primary_ids[item_index];
        item_name := regexp_replace(
            btrim(primary_names[item_index]),
            '[[:space:]]+',
            ' ',
            'g'
        );

        if item_id is null then
            if item_name is null
               or item_name = ''
               or char_length(item_name) > 200 then
                raise exception 'Primary artist name must contain 1 to 200 characters.';
            end if;

            item_id := public.ensure_artist(item_name);
        end if;

        select display_name
        into stored_name
        from public.artists
        where id = item_id;

        if stored_name is null then
            raise exception 'Primary artist not found: %', item_id;
        end if;

        if item_id = any(seen_artist_ids) then
            raise exception 'Duplicate artist credit: %', stored_name;
        end if;

        seen_artist_ids := array_append(seen_artist_ids, item_id);
        resolved_primary_ids := array_append(resolved_primary_ids, item_id);
        resolved_primary_names := array_append(
            resolved_primary_names,
            stored_name
        );
    end loop;

    if featured_count > 0 then
        for item_index in 1..featured_count loop
            item_id := featured_ids[item_index];
            item_name := regexp_replace(
                btrim(featured_names[item_index]),
                '[[:space:]]+',
                ' ',
                'g'
            );

            if item_id is null then
                if item_name is null
                   or item_name = ''
                   or char_length(item_name) > 200 then
                    raise exception 'Featured artist name must contain 1 to 200 characters.';
                end if;

                item_id := public.ensure_artist(item_name);
            end if;

            select display_name
            into stored_name
            from public.artists
            where id = item_id;

            if stored_name is null then
                raise exception 'Featured artist not found: %', item_id;
            end if;

            if item_id = any(seen_artist_ids) then
                raise exception 'Duplicate artist credit: %', stored_name;
            end if;

            seen_artist_ids := array_append(seen_artist_ids, item_id);
            resolved_featured_ids := array_append(
                resolved_featured_ids,
                item_id
            );
            resolved_featured_names := array_append(
                resolved_featured_names,
                stored_name
            );
        end loop;
    end if;

    delete from public.track_artists
    where track_id = target_track_id;

    insert into public.track_artists (
        track_id,
        artist_id,
        role,
        position
    )
    select
        target_track_id,
        resolved_primary_ids[positions.array_index],
        'primary'::public.track_artist_role,
        (positions.array_index - 1)::smallint
    from generate_subscripts(resolved_primary_ids, 1)
        as positions(array_index);

    insert into public.track_artists (
        track_id,
        artist_id,
        role,
        position
    )
    select
        target_track_id,
        resolved_featured_ids[positions.array_index],
        'featured'::public.track_artist_role,
        (positions.array_index - 1)::smallint
    from generate_subscripts(resolved_featured_ids, 1)
        as positions(array_index);

    update public.tracks
    set artist_name = array_to_string(resolved_primary_names, ' & ')
        || case
            when cardinality(resolved_featured_names) > 0
                then ' feat. '
                    || array_to_string(resolved_featured_names, ', ')
            else ''
        end
    where id = target_track_id;
end;
$$;

revoke all on function public.set_track_artist_credits(
    uuid,
    text,
    text[],
    uuid[],
    text[],
    uuid[]
) from public;

grant execute on function public.set_track_artist_credits(
    uuid,
    text,
    text[],
    uuid[],
    text[],
    uuid[]
) to authenticated;


-- Structured autocomplete exposes only artists already visible through the
-- existing catalogue/ownership rules. A linked profile handle is returned as
-- search metadata without granting any management permission.
create function public.search_artists_for_credit(
    search_term text,
    result_limit integer default 8
)
returns table (
    id uuid,
    display_name text,
    normalized_name text,
    slug text,
    handle text
)
language sql
stable
security definer
set search_path = ''
as $$
    with input as (
        select
            left(
                public.normalize_artist_name(coalesce(search_term, '')),
                200
            ) as term,
            least(greatest(coalesce(result_limit, 8), 1), 20) as row_limit
    )
    select
        artist.id,
        artist.display_name,
        artist.normalized_name,
        artist.slug,
        profile.username as handle
    from input
    join public.artists as artist
      on input.term <> ''
    left join public.profiles as profile
      on profile.id = artist.linked_profile_id
    where (
        position(input.term in artist.normalized_name) > 0
        or position(input.term in coalesce(profile.username, '')) > 0
    )
      and (
          artist.linked_profile_id = auth.uid()
          or public.current_user_is_admin()
          or exists (
              select 1
              from public.track_artists as credit
              join public.tracks as track
                on track.id = credit.track_id
              where credit.artist_id = artist.id
                and (
                    track.status = 'published'::public.track_status
                    or track.owner_id = auth.uid()
                )
          )
      )
    order by
        case
            when artist.normalized_name = input.term
              or profile.username = input.term then 0
            when artist.normalized_name like input.term || '%'
              or profile.username like input.term || '%' then 1
            else 2
        end,
        artist.display_name,
        artist.id
    limit (select row_limit from input);
$$;

revoke all on function public.search_artists_for_credit(text, integer)
from public;

grant execute on function public.search_artists_for_credit(text, integer)
to authenticated;

commit;
