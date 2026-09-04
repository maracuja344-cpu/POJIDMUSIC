begin;

create or replace function public.replace_managed_track_audio(
    target_track_id uuid,
    new_audio_path text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    track_row public.tracks%rowtype;
begin
    select * into track_row
    from public.tracks
    where id = target_track_id
    for update;

    if track_row.id is null then
        raise exception 'Track not found.';
    end if;
    if track_row.owner_id <> auth.uid() and not public.current_user_is_admin() then
        raise exception 'Not allowed to edit this track.';
    end if;
    if track_row.owner_id = auth.uid() and not (public.current_user_is_artist() or public.current_user_is_admin()) then
        raise exception 'Artist account role is required.';
    end if;
    if new_audio_path !~ ('^' || track_row.owner_id::text || '/[0-9a-f-]+\.(mp3|wav|flac)$') then
        raise exception 'Invalid audio object path.';
    end if;
    if not exists (
        select 1
        from storage.objects
        where bucket_id = 'track-audio'
          and name = new_audio_path
          and (owner_id = auth.uid()::text or public.current_user_is_admin())
    ) then
        raise exception 'Uploaded track audio object was not found.';
    end if;

    update public.tracks
    set audio_path = new_audio_path
    where id = target_track_id;

    return track_row.audio_path;
end;
$$;

grant execute on function public.replace_managed_track_audio(uuid, text) to authenticated;

commit;
