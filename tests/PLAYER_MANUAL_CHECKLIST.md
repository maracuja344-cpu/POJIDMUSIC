# Player manual scenario checklist

Run against the commit recorded in `PLAYER_BEHAVIOR.md`. Use at least three playable
tracks plus an artist/search source with two tracks. Record browser, viewport, install
mode, source queue, modes, starting track, result, and console/network errors.

## Basic playback

- [ ] Select first track: mini-player activates, correct metadata appears, one audio plays.
- [ ] Pause and resume from mini-player.
- [ ] Pause and resume from fullscreen player.
- [ ] Select another track during playback; confirm the old track stops and new one starts.
- [ ] Select the current playing card; confirm it pauses. Select again; confirm resume.
- [ ] Confirm all duplicate cards for the current catalog ID mirror current/playing state.

## Next and ended

- [ ] Start playback, switch to another browser tab, and confirm at least three natural transitions continue without returning to POJIDMUSIC.
- [ ] While POJIDMUSIC remains in the background, use manual Next and confirm the selected track starts.
- [ ] Repeat the background transition with Repeat One, Shuffle, Repeat All, and the final track of a finite source queue.
- [ ] Minimize the browser and repeat multiple natural transitions; where supported, repeat with the screen locked/Media Session controls.
- [ ] In DevTools diagnostics, confirm each transition reaches `ended -> loadstart -> loadedmetadata/canplay -> play() resolved -> play -> playing`, with no rejected `play()`.

- [ ] Next through Home/catalog with shuffle off and Repeat Off/All/One.
- [ ] Next through Search and Artist Profile queues.
- [ ] Under Repeat One, manual Next advances rather than restarting current.
- [ ] Let a track end naturally under Repeat One; confirm restart from zero.
- [ ] Reach each finite source boundary under Repeat Off; observe global autoplay fallback.
- [ ] Reach a finite source boundary under Repeat All; confirm first source item wraps.
- [ ] Repeat the boundary checks with shuffle enabled and queues of one and two tracks.

## Previous, history, and shuffle

- [ ] Press Previous immediately after the first selection; confirm no action.
- [ ] Play three tracks, then use Previous twice and Next twice; confirm history traversal.
- [ ] Enable shuffle before first playback and run several Next operations.
- [ ] Enable shuffle during playback; verify no repeat before candidate exhaustion.
- [ ] Use Previous in shuffle, then Next; confirm forward history.
- [ ] Disable shuffle after going backward, then Next; record whether forward history wins.
- [ ] Reload after building history; confirm Previous uses restored history.
- [ ] Repeat Previous checks under all repeat modes.

## Navigation and DOM independence

- [ ] While playing, go Home -> Artist Profile -> Search -> Profile -> Home.
- [ ] At every step verify audio continuity, current metadata, card mirrors, fullscreen,
  queue source, and that only one audio stream is audible.
- [ ] Note that current routing may redirect Profile/My Tracks to Artist or Home.
- [ ] Start a track, navigate where its card is absent, invoke Next and Previous, return,
  and confirm the matching card resynchronizes.

## Catalog refresh and persistence

- [ ] Refresh an unchanged catalog while playing; confirm track/time/audio continue.
- [ ] Add a track and refresh; record whether the active queue gains it.
- [ ] Hide/delete a non-current track; confirm current playback continues and queue reconciles.
- [ ] Hide/delete the current track; confirm player clears and fullscreen closes.
- [ ] Reload while paused after seeking; verify track, approximate position, volume,
  repeat, shuffle, source queue/index, and history restore.
- [ ] Confirm reload does not resume playback and fullscreen restores closed.

## Platforms

- [ ] Desktop browser.
- [ ] Mobile viewport/device.
- [ ] Installed standalone PWA.
