begin;

-- Hosted Supabase Dashboard SQL Editor executes through the postgres role.
-- Abort instead of installing a trust check for an unexpected executor.
do $$
begin
    if current_user <> 'postgres'::name then
        raise exception
            'This migration must be applied through the Supabase SQL Editor as postgres'
            using errcode = '42501';
    end if;
end;
$$;


-- Keep all existing protected fields immutable. A profile admin may change
-- roles through the authenticated API, while the trusted SQL Editor role
-- may perform the same operation directly.
create or replace function public.protect_profile_privileged_fields()
returns trigger
language plpgsql
security invoker
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
       and not (
           public.current_user_is_admin()
           or current_user = 'postgres'::name
       ) then
        raise exception 'Only an admin can change profile roles';
    end if;

    return new;
end;
$$;


-- Trusted helper for role assignment from the SQL Editor.
-- app_role typing limits new_role to the existing enum values.
create function public.set_profile_role(
    target_user_id uuid,
    new_role public.app_role
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if target_user_id is null then
        raise exception 'target_user_id is required'
            using errcode = '22004';
    end if;

    if new_role is null then
        raise exception 'new_role is required'
            using errcode = '22004';
    end if;

    update public.profiles
    set role = new_role
    where id = target_user_id;

    if not found then
        raise exception 'Profile not found for user id %', target_user_id
            using errcode = 'P0002';
    end if;
end;
$$;

revoke all on function public.set_profile_role(
    uuid,
    public.app_role
) from public, anon, authenticated, service_role;

grant execute on function public.set_profile_role(
    uuid,
    public.app_role
) to postgres;

commit;
