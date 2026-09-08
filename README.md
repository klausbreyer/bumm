# BUMM.

A local beat studio for children aged 6 to 9, with the interface aimed at age 9. Built from the selected loop-pad design. German interface, touch controls, Hip-Hop and Techno soundsets.

Website: [klausbreyer.github.io/bumm](https://klausbreyer.github.io/bumm/).

```sh
make start
```

`make start` installs dependencies and opens http://127.0.0.1:4176 in your
browser. Stop the server with Ctrl+C. Use `make start PORT=4181` for another
port, or `make start OPEN=` to leave the browser closed. An occupied port stops
startup with an error. `bun run dev` starts the server without installing
dependencies or opening the browser.

`bun run build` checks TypeScript and builds the static app. `bun run test`
checks the song model and audio rendering.

`bun run test:browser` builds the app and tests a local production build at
`http://127.0.0.1:4177/bumm/`, in laptop and phone viewports. It covers the song
view, beat editing, independent vocals, seeking, undo, persistence and WAV
export. Recording tests use generated audio, not a physical microphone.
Playwright's Chromium must be installed. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE`
to use an existing Chromium binary. `PLAYWRIGHT_BASE_URL` selects an existing
server instead of starting the local preview.

## Hosting

GitHub Pages uses the [Actions deployment workflow](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) in `.github/workflows/pages.yml`. Pushes and pull requests run unit tests and browser tests. A successful push to `main` publishes the tested `dist` artifact. The build uses the `/bumm/` base path for scripts, styles, fonts and audio workers; local development stays at `/`.

For the initial release before the first PR is merged, `PAGES_BOOTSTRAP_SHA` can authorize one exact commit for deployment. Remove this repository variable after that release. The `github-pages` environment restricts deployment branches.

## Using the studio

The studio opens with **Dein Song**. Beats appear in order above an independent
voice track. Select a beat to change its sounds, name, length or position in the
editor below the timeline. Beats can be copied or removed. **Beat anhängen**
adds a beat with the current mix. **Fertig** closes the editor.

**Song anhören** plays the arrangement. A white line shows the current position
across both tracks. While stopped, use the ruler to choose a playback or
recording position. The arrow beside the clock returns to the start. The
**Beat anhören** button in the editor previews its mix in a loop.

Choose whether you wear headphones before recording. **Nein** is the default:
backing audio and count-in clicks stay silent, while the count and playhead
remain visible. With **Ja**, the beat and count-in play through your selected
audio output. This choice does not change the saved mix or WAV export.
Microphone audio never plays through the speakers during recording.

Press **Aufnahme starten**, grant microphone access and wait for four count-in
beats. Sing or rap, then press **Aufnahme beenden**. Each recording can last up
to two minutes. It can cross beat boundaries, continue past the beats or stand
alone without beats. A project can contain eight recordings. Each clip has its
own time position. Moving, copying, shortening or deleting beats leaves vocals
in place.

Select an existing recording and press **Neu aufnehmen** to replace it.
**Abbrechen** preserves the previous take. **Neue Aufnahme** clears the selection
so the next recording creates a separate clip at the cursor. Overlapping clips
play together. In **Stimme & Beat mischen**, adjust volume, position, playback
length and timing, or remove a recording. Changes can be undone. Shortening a
voice clip preserves its full audio, including in saved project files.

Recordings use mono PCM in IndexedDB. Metadata lives under `bumm.studio.v3`.
Existing v1 and v2 projects migrate on load. Older part-bound vocals retain
their original start times, playback windows, volume and timing adjustment.
Their full recorded audio remains available. Each genre has a separate project.

**Sichern** downloads a `.bumm` file with metadata and lossless audio. **Laden**
also accepts older project files. **Song herunterladen** exports beats and
vocals as stereo WAV. Recordings never leave the device unless the user
downloads and shares a file. Old takes remain in storage for undo.

The speaker slider changes listening volume. Channel and voice sliders change
the saved mix and exported song. Playback stops and an active recording is
cancelled when the page is hidden. Tempo stays locked while vocals exist.

Recording requires HTTPS or localhost, microphone support and AudioWorklet.
Timing uses the audio clock. With headphones, latency compensation includes
input and output estimates. Without headphones, it uses the input estimate.
Each take can be adjusted by up to 250 ms in either direction. These estimates
do not replace tests with real hardware, especially wireless audio devices.
Real iPhone/iPad microphone behavior has not yet been verified. There are no
accounts, analytics, network sound downloads or server database connections.

## Structure

- `src/music/`: typed project format, sound catalog, deterministic PCM synthesis, recording windows, vocal timing and WAV rendering. No DOM or Web Audio dependencies.
- `src/audio/`: worker rendering, Web Audio playback, microphone capture and the recording worklet.
- `src/storage/`: IndexedDB audio storage, versioned project bundles and imports.
- `src/ui/`, `src/main.ts` and `src/style.css`: touch interface, recording workflow and persistence. Tailwind and bundled Barlow fonts.

The music layer is reusable in another shell. A native audio adapter and real iPhone/iPad testing are still required before claiming native support.

All sound patterns and synthesis code in this project are original. No third-party samples are included. Fonts are distributed by Fontsource under their package licenses.
