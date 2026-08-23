begin;

do $phase2_test$
declare
    first_user uuid := '10000000-0000-4000-8000-000000000001';
    second_user uuid := '10000000-0000-4000-8000-000000000002';
    first_artist uuid;
    repeated_artist uuid;
    first_role public.app_role;
    second_role public.app_role;
begin
    insert into auth.users (
        id,
        email,
        raw_user_meta_data,
        created_at,
        updated_at
    ) values (
        first_user,
        'phase2-first@example.invalid',
        '{"display_name":"Phase Two Unique Artist","account_type":"artist"}'::jsonb,
        now(),
        now()
    );

    select role into first_role from public.profiles where id = first_user;
    if first_role is distinct from 'listener'::public.app_role then
        raise exception 'New auth user did not start as listener.';
    end if;

    perform set_config('request.jwt.claim.sub', first_user::text, true);
    select artist_id
    into first_artist
    from public.activate_current_user_as_artist();

    if first_artist is null
       or not exists (
            select 1
            from public.profiles as profile
            join public.artists as artist
              on artist.linked_profile_id = profile.id
            where profile.id = first_user
              and profile.role = 'artist'::public.app_role
              and artist.id = first_artist
       ) then
        raise exception 'Atomic artist activation failed.';
    end if;

    select artist_id
    into repeated_artist
    from public.activate_current_user_as_artist();

    if repeated_artist is distinct from first_artist then
        raise exception 'Repeated activation was not idempotent.';
    end if;

    insert into auth.users (
        id,
        email,
        raw_user_meta_data,
        created_at,
        updated_at
    ) values (
        second_user,
        'phase2-second@example.invalid',
        '{"display_name":"Phase Two Unique Artist","account_type":"artist"}'::jsonb,
        now(),
        now()
    );

    perform set_config('request.jwt.claim.sub', second_user::text, true);

    begin
        perform public.activate_current_user_as_artist();
        raise exception 'Expected artist-name conflict was not raised.';
    exception
        when unique_violation then null;
    end;

    select role into second_role from public.profiles where id = second_user;
    if second_role is distinct from 'listener'::public.app_role or exists (
        select 1
        from public.artists
        where linked_profile_id = second_user
    ) then
        raise exception 'Conflict left a partial artist account.';
    end if;
end;
$phase2_test$;

rollback;
