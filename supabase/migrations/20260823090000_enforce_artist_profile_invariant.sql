begin;

-- Creates a brand-new Artist entity for one profile. Future onboarding never
-- claims an existing artist by name: a collision aborts the surrounding
-- transaction and leaves the account role unchanged.
create function public.provision_artist_for_profile(
    target_profile_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    clean_name text;
    normalized text;
    linked_artist_id uuid;
    conflicting_artist_id uuid;
begin
    if target_profile_id is null then
        raise exception 'target_profile_id is required'
            using errcode = '22004';
    end if;

    select nullif(
        regexp_replace(btrim(profile.display_name), '[[:space:]]+', ' ', 'g'),
        ''
    )
    into clean_name
    from public.profiles as profile
    where profile.id = target_profile_id
    for update;

    if not found then
        raise exception 'Profile not found for user id %', target_profile_id
            using errcode = 'P0002';
    end if;

    select artist.id
    into linked_artist_id
    from public.artists as artist
    where artist.linked_profile_id = target_profile_id;

    if linked_artist_id is not null then
        return linked_artist_id;
    end if;

    if clean_name is null or char_length(clean_name) > 200 then
        raise exception 'Artist profile requires a unique display name of 1 to 200 characters.'
            using errcode = '23514';
    end if;

    normalized := public.normalize_artist_name(clean_name);

    select artist.id
    into conflicting_artist_id
    from public.artists as artist
    where artist.normalized_name = normalized
    for update;

    if conflicting_artist_id is not null then
        raise exception 'Artist name is already reserved. Choose another name or request a reviewed link.'
            using errcode = '23505';
    end if;

    insert into public.artists (
        display_name,
        normalized_name,
        slug,
        linked_profile_id
    )
    values (
        clean_name,
        normalized,
        public.artist_slug_for_name(clean_name),
        target_profile_id
    )
    returning id into linked_artist_id;

    return linked_artist_id;
end;
$$;

revoke all on function public.provision_artist_for_profile(uuid)
from public, anon, authenticated, service_role;


-- Exact-name linking is deliberately limited to the two production records
-- confirmed by the Phase 1 audit. Ambiguous or already claimed names are not
-- modified. On clean/new environments this statement is a no-op.
with eligible_profiles as (
    select
        profile.id as profile_id,
        public.normalize_artist_name(profile.display_name) as normalized_name
    from public.profiles as profile
    where profile.role = 'artist'::public.app_role
      and nullif(btrim(profile.display_name), '') is not null
      and public.normalize_artist_name(profile.display_name) in ('zhorik', 'lufy')
      and not exists (
          select 1
          from public.artists as linked_artist
          where linked_artist.linked_profile_id = profile.id
      )
),
unambiguous_profiles as (
    select candidate.profile_id, candidate.normalized_name
    from eligible_profiles as candidate
    where 1 = (
        select count(*)
        from eligible_profiles as duplicate
        where duplicate.normalized_name = candidate.normalized_name
    )
)
update public.artists as artist
set linked_profile_id = candidate.profile_id
from unambiguous_profiles as candidate
where artist.normalized_name = candidate.normalized_name
  and artist.linked_profile_id is null;


-- Any future transition to role=artist provisions the Artist entity inside
-- the same database transaction. A conflict raises and rolls back the role
-- change, so role=artist cannot be committed without a linked Artist row.
create function public.enforce_artist_profile_invariant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if new.role = 'artist'::public.app_role then
        perform public.provision_artist_for_profile(new.id);
    end if;

    return new;
end;
$$;

revoke all on function public.enforce_artist_profile_invariant()
from public, anon, authenticated, service_role;

create trigger profiles_95_ensure_artist_link
after insert or update of role on public.profiles
for each row
execute function public.enforce_artist_profile_invariant();


-- Self-service artist onboarding is an intentionally exposed, narrowly
-- scoped privileged operation. It accepts no user id or role and can update
-- only auth.uid(). Client metadata may decide whether the UI calls this RPC,
-- but it never grants authorization inside the database.
create function public.activate_current_user_as_artist()
returns table (
    artist_id uuid,
    artist_slug text,
    artist_display_name text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    caller_id uuid := auth.uid();
    account_role public.app_role;
begin
    if caller_id is null then
        raise exception 'Authentication is required.'
            using errcode = '42501';
    end if;

    select profile.role
    into account_role
    from public.profiles as profile
    where profile.id = caller_id
    for update;

    if not found then
        raise exception 'Profile not found for the current user.'
            using errcode = 'P0002';
    end if;

    if account_role not in (
        'listener'::public.app_role,
        'artist'::public.app_role
    ) then
        raise exception 'This account role cannot use artist onboarding.'
            using errcode = '42501';
    end if;

    update public.profiles
    set role = 'artist'::public.app_role
    where id = caller_id;

    return query
    select artist.id, artist.slug, artist.display_name
    from public.artists as artist
    where artist.linked_profile_id = caller_id;

    if not found then
        raise exception 'Artist profile invariant was not established.';
    end if;
end;
$$;

revoke all on function public.activate_current_user_as_artist()
from public, anon, authenticated, service_role;

grant execute on function public.activate_current_user_as_artist()
to authenticated;


-- Fail deployment instead of accepting any legacy role=artist row that the
-- reviewed backfill did not resolve.
do $$
begin
    if exists (
        select 1
        from public.profiles as profile
        where profile.role = 'artist'::public.app_role
          and not exists (
              select 1
              from public.artists as artist
              where artist.linked_profile_id = profile.id
          )
    ) then
        raise exception 'Unlinked artist-role profiles remain after reviewed backfill.';
    end if;
end;
$$;

commit;
