begin;

-- Musical artists are public catalogue entities. They are deliberately
-- separate from profiles (accounts) and tracks.owner_id (upload ownership).
create type public.track_artist_role as enum (
    'primary',
    'featured'
);

create table public.artists (
    id uuid primary key default gen_random_uuid(),
    display_name text not null,
    normalized_name text not null unique,
    slug text not null unique,
    avatar_url text,
    banner_url text,
    bio text,
    linked_profile_id uuid unique
        references public.profiles(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint artists_display_name_not_blank
        check (btrim(display_name) <> ''),
    constraint artists_display_name_length
        check (char_length(display_name) <= 200),
    constraint artists_normalized_name_not_blank
        check (btrim(normalized_name) <> ''),
    constraint artists_slug_format
        check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
    constraint artists_bio_length
        check (bio is null or char_length(bio) <= 4000)
);

create table public.track_artists (
    track_id uuid not null
        references public.tracks(id) on delete cascade,
    artist_id uuid not null
        references public.artists(id) on delete cascade,
    role public.track_artist_role not null,
    position smallint not null default 0,
    created_at timestamptz not null default now(),

    primary key (track_id, artist_id),
    constraint track_artists_position_nonnegative
        check (position >= 0),
    constraint track_artists_role_position_unique
        unique (track_id, role, position)
);

create index track_artists_artist_id_idx
    on public.track_artists (artist_id);

create index track_artists_track_order_idx
    on public.track_artists (track_id, role, position);

create index artists_linked_profile_id_idx
    on public.artists (linked_profile_id)
    where linked_profile_id is not null;

create trigger artists_90_set_updated_at
before update on public.artists
for each row
execute function public.set_updated_at();


create function public.normalize_artist_name(value text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
    select lower(
        regexp_replace(btrim(value), '[[:space:]]+', ' ', 'g')
    );
$$;

create function public.artist_slug_for_name(value text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
    select
        coalesce(
            nullif(
                trim(
                    both '-' from regexp_replace(
                        lower(public.normalize_artist_name(value)),
                        '[^a-z0-9]+',
                        '-',
                        'g'
                    )
                ),
                ''
            ),
            'artist'
        )
        || '-'
        || substr(md5(public.normalize_artist_name(value)), 1, 8);
$$;

alter table public.artists
add constraint artists_normalized_name_matches
check (
    normalized_name = public.normalize_artist_name(display_name)
);

-- Internal exact-match upsert. No fuzzy matching is performed.
create function public.ensure_artist(value text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    clean_name text := regexp_replace(btrim(value), '[[:space:]]+', ' ', 'g');
    normalized text;
    result_id uuid;
begin
    if clean_name is null
       or clean_name = ''
       or char_length(clean_name) > 200 then
        raise exception 'Artist name must contain 1 to 200 characters.';
    end if;

    normalized := public.normalize_artist_name(clean_name);

    insert into public.artists (
        display_name,
        normalized_name,
        slug
    )
    values (
        clean_name,
        normalized,
        public.artist_slug_for_name(clean_name)
    )
    on conflict (normalized_name) do update
        set normalized_name = excluded.normalized_name
    returning id into result_id;

    return result_id;
end;
$$;


-- Replaces all credits for one owned track in a single protected operation.
-- Upload permission still comes from the account role; no artist relation
-- grants ownership or moderation rights.
create function public.set_track_artist_credits(
    target_track_id uuid,
    primary_artist_name text,
    featured_artist_names text[] default '{}'::text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    track_owner_id uuid;
    track_status_value public.track_status;
    primary_id uuid;
    featured_name text;
    featured_id uuid;
    seen_names text[];
    featured_position smallint := 0;
    normalized text;
    clean_primary text := regexp_replace(
        btrim(primary_artist_name),
        '[[:space:]]+',
        ' ',
        'g'
    );
    clean_featured text[] := '{}'::text[];
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

    if clean_primary is null
       or clean_primary = ''
       or char_length(clean_primary) > 200 then
        raise exception 'Primary artist name must contain 1 to 200 characters.';
    end if;

    if coalesce(array_length(featured_artist_names, 1), 0) > 10 then
        raise exception 'No more than 10 featured artists are allowed.';
    end if;

    seen_names := array[public.normalize_artist_name(clean_primary)];

    foreach featured_name in array featured_artist_names loop
        featured_name := regexp_replace(
            btrim(featured_name),
            '[[:space:]]+',
            ' ',
            'g'
        );

        if featured_name is null
           or featured_name = ''
           or char_length(featured_name) > 200 then
            raise exception 'Featured artist name must contain 1 to 200 characters.';
        end if;

        normalized := public.normalize_artist_name(featured_name);

        if normalized = any(seen_names) then
            raise exception 'Duplicate artist credit: %', featured_name;
        end if;

        seen_names := array_append(seen_names, normalized);
        clean_featured := array_append(clean_featured, featured_name);
    end loop;

    primary_id := public.ensure_artist(clean_primary);
    delete from public.track_artists where track_id = target_track_id;

    insert into public.track_artists (
        track_id,
        artist_id,
        role,
        position
    ) values (
        target_track_id,
        primary_id,
        'primary'::public.track_artist_role,
        0
    );

    foreach featured_name in array clean_featured loop
        featured_id := public.ensure_artist(featured_name);

        insert into public.track_artists (
            track_id,
            artist_id,
            role,
            position
        ) values (
            target_track_id,
            featured_id,
            'featured'::public.track_artist_role,
            featured_position
        );

        featured_position := featured_position + 1;
    end loop;

    update public.tracks
    set artist_name = clean_primary
        || case
            when cardinality(clean_featured) > 0
                then ' feat. ' || array_to_string(clean_featured, ', ')
            else ''
        end
    where id = target_track_id;
end;
$$;


-- Conservative legacy backfill: only a single name or explicit feat./ft.
-- syntax is interpreted. Potentially ambiguous separators stay untouched and
-- retain tracks.artist_name as the runtime fallback.
do $$
declare
    legacy_track record;
    names text[];
    name_part text;
    artist_id_value uuid;
    item_position smallint;
begin
    for legacy_track in
        select id, artist_name
        from public.tracks
        where not exists (
            select 1
            from public.track_artists
            where track_id = tracks.id
        )
        order by created_at, id
    loop
        if legacy_track.artist_name ~* '(&|/|,|[[:space:]]+x[[:space:]]+|[[:space:]]+with[[:space:]]+)' then
            raise notice
                'Artist backfill review required: track %, credit "%"',
                legacy_track.id,
                legacy_track.artist_name;
            continue;
        end if;

        if legacy_track.artist_name ~* '[[:space:]]+(feat\.?|ft\.?)[[:space:]]+' then
            names := regexp_split_to_array(
                legacy_track.artist_name,
                '[[:space:]]+(feat\.?|ft\.?)[[:space:]]+',
                'i'
            );
        else
            names := array[legacy_track.artist_name];
        end if;

        item_position := 0;
        foreach name_part in array names loop
            name_part := regexp_replace(
                btrim(name_part),
                '[[:space:]]+',
                ' ',
                'g'
            );

            if name_part = '' then
                continue;
            end if;

            artist_id_value := public.ensure_artist(name_part);

            insert into public.track_artists (
                track_id,
                artist_id,
                role,
                position
            ) values (
                legacy_track.id,
                artist_id_value,
                case
                    when item_position = 0
                        then 'primary'::public.track_artist_role
                    else 'featured'::public.track_artist_role
                end,
                case when item_position = 0 then 0 else item_position - 1 end
            )
            on conflict (track_id, artist_id) do nothing;

            item_position := item_position + 1;
        end loop;
    end loop;
end;
$$;


alter table public.artists enable row level security;
alter table public.track_artists enable row level security;

revoke all on table public.artists from anon, authenticated;
revoke all on table public.track_artists from anon, authenticated;

-- Artist rows contain public catalogue metadata only. Mutations happen via
-- the protected RPC above or an administrative backend.
grant select on table public.artists to anon, authenticated;
grant select on table public.track_artists to anon, authenticated;

create policy artists_select_public
on public.artists
for select
to anon, authenticated
using (
    exists (
        select 1
        from public.track_artists
        join public.tracks
          on tracks.id = track_artists.track_id
        where track_artists.artist_id = artists.id
          and tracks.status = 'published'::public.track_status
    )
);

create policy artists_select_linked_profile
on public.artists
for select
to authenticated
using (linked_profile_id = auth.uid());

create policy artists_select_track_owner
on public.artists
for select
to authenticated
using (
    exists (
        select 1
        from public.track_artists
        join public.tracks
          on tracks.id = track_artists.track_id
        where track_artists.artist_id = artists.id
          and tracks.owner_id = auth.uid()
    )
);

create policy artists_select_admin
on public.artists
for select
to authenticated
using (public.current_user_is_admin());

create policy track_artists_select_published
on public.track_artists
for select
to anon, authenticated
using (
    exists (
        select 1
        from public.tracks
        where tracks.id = track_artists.track_id
          and tracks.status = 'published'::public.track_status
    )
);

create policy track_artists_select_owner
on public.track_artists
for select
to authenticated
using (
    exists (
        select 1
        from public.tracks
        where tracks.id = track_artists.track_id
          and tracks.owner_id = auth.uid()
    )
);

create policy track_artists_select_admin
on public.track_artists
for select
to authenticated
using (public.current_user_is_admin());

revoke all on function public.normalize_artist_name(text) from public;
revoke all on function public.artist_slug_for_name(text) from public;
revoke all on function public.ensure_artist(text) from public;
revoke all on function public.set_track_artist_credits(uuid, text, text[])
    from public;

grant execute on function public.set_track_artist_credits(uuid, text, text[])
    to authenticated;

commit;
