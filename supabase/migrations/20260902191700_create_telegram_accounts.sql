begin;

create table public.telegram_accounts (
    telegram_user_id bigint primary key,
    user_id uuid not null unique
        references auth.users(id) on delete cascade,
    username text,
    display_name text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint telegram_accounts_user_id_positive
        check (telegram_user_id > 0),
    constraint telegram_accounts_user_id_safe_integer
        check (telegram_user_id <= 9007199254740991),
    constraint telegram_accounts_username_not_blank
        check (username is null or btrim(username) <> ''),
    constraint telegram_accounts_display_name_not_blank
        check (display_name is null or btrim(display_name) <> '')
);

create trigger telegram_accounts_90_set_updated_at
before update on public.telegram_accounts
for each row
execute function public.set_updated_at();

alter table public.telegram_accounts enable row level security;

-- This mapping is a server-only authentication boundary. No client policies
-- are intentionally defined; the Edge Function uses a server secret key.
revoke all on table public.telegram_accounts from public, anon, authenticated;
grant select, insert, update, delete on table public.telegram_accounts
    to service_role;

commit;
