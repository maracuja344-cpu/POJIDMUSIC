create table if not exists public.albums (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (btrim(title) <> ''),
  description text,
  cover_path text not null check (cover_path !~* '^[[:space:]]*([a-z][a-z0-9+.-]*:|//)'),
  release_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tracks add column if not exists album_id uuid references public.albums(id) on delete set null;
alter table public.tracks add column if not exists album_position smallint;

alter table public.tracks drop constraint if exists tracks_album_position_check;
alter table public.tracks add constraint tracks_album_position_check check (album_position is null or album_position > 0);

alter table public.tracks drop constraint if exists tracks_album_consistency_check;
alter table public.tracks add constraint tracks_album_consistency_check check (
  (album_id is null and album_position is null)
  or
  (album_id is not null and album_position is not null and release_type = 'album_track'::release_type)
);

create index if not exists albums_owner_id_idx on public.albums(owner_id);
create index if not exists tracks_album_id_position_idx on public.tracks(album_id, album_position);

alter table public.albums enable row level security;

drop policy if exists albums_select_owner on public.albums;
create policy albums_select_owner on public.albums for select using (owner_id = auth.uid());
drop policy if exists albums_select_admin on public.albums;
create policy albums_select_admin on public.albums for select using (public.current_user_is_admin());
drop policy if exists albums_select_published on public.albums;
create policy albums_select_published on public.albums for select using (
  exists (select 1 from public.tracks t where t.album_id = albums.id and t.status = 'published'::track_status)
);
drop policy if exists albums_insert_artist on public.albums;
create policy albums_insert_artist on public.albums for insert with check (public.current_user_is_artist() and owner_id = auth.uid());
drop policy if exists albums_insert_admin on public.albums;
create policy albums_insert_admin on public.albums for insert with check (public.current_user_is_admin());
drop policy if exists albums_update_owner on public.albums;
create policy albums_update_owner on public.albums for update using ((owner_id = auth.uid() and public.current_user_is_artist()) or public.current_user_is_admin()) with check ((owner_id = auth.uid() and public.current_user_is_artist()) or public.current_user_is_admin());
drop policy if exists albums_delete_owner on public.albums;
create policy albums_delete_owner on public.albums for delete using ((owner_id = auth.uid() and public.current_user_is_artist()) or public.current_user_is_admin());

grant select, insert, update, delete on public.albums to authenticated;
