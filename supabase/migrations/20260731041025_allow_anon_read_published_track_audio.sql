begin;

drop policy if exists track_audio_select_published_anon
on storage.objects;

create policy track_audio_select_published_anon
on storage.objects
for select
to anon
using (
    bucket_id = 'track-audio'
    and exists (
        select 1
        from public.tracks as track
        where track.status = 'published'::public.track_status
          and track.audio_path = storage.objects.name
    )
);

commit;
