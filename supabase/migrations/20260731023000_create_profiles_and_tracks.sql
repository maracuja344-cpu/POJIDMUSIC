begin;

-- Application roles are stored in public.profiles.
create type public.app_role as enum (
    'listener',
    'artist',
    'admin'
);

create type public.track_status as enum (
    'draft',
    'pending',
    'published',
    'rejected',
    'hidden'
);

create type public.release_type as enum (
    'demo',
    'single',
    'album_track'
);


create table public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    username text unique,
    display_name text,
    avatar_url text,
    role public.app_role not null default 'listener',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint profiles_username_not_blank
        check (
            username is null
            or btrim(username) <> ''
        ),
    constraint profiles_username_lowercase
        check (
            username is null
            or username = lower(username)
        ),
    constraint profiles_username_format
        check (
            username is null
            or username ~ '^[a-z0-9_.]+$'
        )
);


create table public.tracks (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null
        references public.profiles(id) on delete cascade,
    title text not null,
    artist_name text not null,
    description text,
    cover_path text,
    audio_path text,
    release_type public.release_type not null default 'single',
    status public.track_status not null default 'draft',
    release_date date,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint tracks_title_not_blank
        check (btrim(title) <> ''),
    constraint tracks_artist_name_not_blank
        check (btrim(artist_name) <> ''),
    constraint tracks_cover_path_is_not_public_url
        check (
            cover_path is null
            or cover_path !~*
                '^[[:space:]]*([a-z][a-z0-9+.-]*:|//)'
        ),
    constraint tracks_audio_path_is_not_public_url
        check (
            audio_path is null
            or audio_path !~*
                '^[[:space:]]*([a-z][a-z0-9+.-]*:|//)'
        ),
    constraint tracks_review_files_required
        check (
            status not in ('pending', 'published')
            or (
                nullif(btrim(audio_path), '') is not null
                and nullif(btrim(cover_path), '') is not null
            )
        )
);


create index tracks_owner_id_idx
    on public.tracks (owner_id);

create index tracks_status_idx
    on public.tracks (status);

create index tracks_created_at_desc_idx
    on public.tracks (created_at desc);

create index tracks_release_date_desc_idx
    on public.tracks (release_date desc);


-- Shared timestamp maintenance for mutable application rows.
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

create trigger profiles_90_set_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

create trigger tracks_90_set_updated_at
before update on public.tracks
for each row
execute function public.set_updated_at();


-- Creates the application profile for every new Supabase Auth user.
-- The role is hard-coded and never read from user-controlled metadata.
create function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.profiles (
        id,
        display_name,
        role
    )
    values (
        new.id,
        nullif(
            btrim(
                coalesce(
                    new.raw_user_meta_data ->> 'display_name',
                    new.raw_user_meta_data ->> 'full_name',
                    ''
                )
            ),
            ''
        ),
        'listener'::public.app_role
    )
    on conflict (id) do nothing;

    return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_auth_user();


-- Role helpers deliberately accept no client-provided role or user id.
-- SECURITY DEFINER prevents profiles RLS from recursively evaluating itself.
create function public.current_user_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.profiles as profile
        where profile.id = auth.uid()
          and profile.role = 'admin'::public.app_role
    );
$$;

create function public.current_user_is_artist()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.profiles as profile
        where profile.id = auth.uid()
          and profile.role = 'artist'::public.app_role
    );
$$;


-- Exposes only the explicitly public artist fields.
-- The narrow SECURITY DEFINER function is the intentional RLS boundary;
-- the view itself runs with invoker semantics.
create function public.get_artist_public_profiles()
returns table (
    id uuid,
    username text,
    display_name text,
    avatar_url text
)
language sql
stable
security definer
set search_path = ''
as $$
    select
        profile.id,
        profile.username,
        profile.display_name,
        profile.avatar_url
    from public.profiles as profile
    where exists (
        select 1
        from public.tracks as track
        where track.owner_id = profile.id
          and track.status = 'published'::public.track_status
    );
$$;

create view public.artist_public_profiles
with (
    security_invoker = true,
    security_barrier = true
)
as
select
    artist.id,
    artist.username,
    artist.display_name,
    artist.avatar_url
from public.get_artist_public_profiles() as artist;


-- RLS compares row visibility, but cannot compare OLD.role with NEW.role.
-- This guard prevents non-admin API users from changing privileged fields.
create function public.protect_profile_privileged_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if new.id is distinct from old.id then
        raise exception 'Profile id cannot be changed';
    end if;

    if new.created_at is distinct from old.created_at then
        raise exception 'Profile created_at cannot be changed';
    end if;

    if new.role is distinct from old.role
       and not public.current_user_is_admin() then
        raise exception 'Only an admin can change profile roles';
    end if;

    return new;
end;
$$;

create trigger profiles_10_protect_privileged_fields
before update on public.profiles
for each row
execute function public.protect_profile_privileged_fields();


alter table public.profiles enable row level security;
alter table public.tracks enable row level security;


-- Start from explicit client privileges; RLS then limits individual rows.
revoke all on table public.profiles from anon, authenticated;
revoke all on table public.tracks from anon, authenticated;
revoke all on table public.artist_public_profiles
    from anon, authenticated;

grant select on table public.profiles to authenticated;
grant update on table public.profiles to authenticated;

grant select on table public.tracks to anon, authenticated;
grant insert, update, delete on table public.tracks to authenticated;

grant select on table public.artist_public_profiles
    to anon, authenticated;

revoke all on function public.set_updated_at() from public;
revoke all on function public.handle_new_auth_user() from public;
revoke all on function public.current_user_is_admin() from public;
revoke all on function public.current_user_is_artist() from public;
revoke all on function public.get_artist_public_profiles()
    from public;
revoke all on function public.protect_profile_privileged_fields()
    from public;

grant execute on function public.current_user_is_admin()
    to authenticated;
grant execute on function public.current_user_is_artist()
    to authenticated;
grant execute on function public.get_artist_public_profiles()
    to anon, authenticated;


-- Profiles: self access and full admin access.
create policy profiles_select_own
on public.profiles
for select
to authenticated
using (id = auth.uid());

create policy profiles_select_admin
on public.profiles
for select
to authenticated
using (public.current_user_is_admin());

create policy profiles_update_own
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy profiles_update_admin
on public.profiles
for update
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());


-- Tracks: published catalog, owner workspace, artist workflow, admin moderation.
create policy tracks_select_published
on public.tracks
for select
to anon, authenticated
using (status = 'published'::public.track_status);

create policy tracks_select_own
on public.tracks
for select
to authenticated
using (owner_id = auth.uid());

create policy tracks_select_admin
on public.tracks
for select
to authenticated
using (public.current_user_is_admin());

create policy tracks_insert_artist
on public.tracks
for insert
to authenticated
with check (
    public.current_user_is_artist()
    and owner_id = auth.uid()
    and status in (
        'draft'::public.track_status,
        'pending'::public.track_status
    )
);

create policy tracks_insert_admin
on public.tracks
for insert
to authenticated
with check (public.current_user_is_admin());

create policy tracks_update_artist
on public.tracks
for update
to authenticated
using (
    public.current_user_is_artist()
    and owner_id = auth.uid()
    and status in (
        'draft'::public.track_status,
        'pending'::public.track_status
    )
)
with check (
    public.current_user_is_artist()
    and owner_id = auth.uid()
    and status in (
        'draft'::public.track_status,
        'pending'::public.track_status
    )
);

create policy tracks_update_admin
on public.tracks
for update
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

create policy tracks_delete_artist
on public.tracks
for delete
to authenticated
using (
    public.current_user_is_artist()
    and owner_id = auth.uid()
    and status in (
        'draft'::public.track_status,
        'pending'::public.track_status,
        'rejected'::public.track_status
    )
);

create policy tracks_delete_admin
on public.tracks
for delete
to authenticated
using (public.current_user_is_admin());

commit;
