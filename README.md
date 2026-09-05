# BUMM.

A local beat studio for children aged 6 to 9, with the interface aimed at age 9. Built from the selected loop-pad design. German interface, touch controls, Hip-Hop and Techno soundsets.

```sh
bun install
bun run dev
```

Open http://127.0.0.1:4176. `bun run build` checks TypeScript and builds the static app. `bun test` checks the song model and audio rendering.

The app plays original synthesized loops, switches sounds at bar boundaries, saves mixes as song parts, and exports stereo WAV files. Song parts can be edited, copied, reordered, renamed and removed. Changes can be undone. Each genre has a separate project.

In **Mein Song**, select a part and press **Aufnehmen**. Grant microphone access, wait for four count-in beats, then sing or rap along. Recording stops at the part boundary or when **Aufnahme beenden** is pressed. **Abbrechen** discards the attempt and preserves the previous take. A waveform shows where the recorded voice belongs. Copying and moving parts includes their vocals. Replacing or removing a take can be undone.

Audio is recorded as mono PCM through an AudioWorklet and stored in IndexedDB. Metadata is stored under `bumm.studio.v2`; existing v1 projects migrate on load. **Projekt sichern** downloads a `.bumm` file containing the metadata and lossless audio. **Projekt laden** also accepts older beat-only JSON files. WAV export mixes beats and vocals into one stereo file. Recordings never leave the device unless the user downloads and shares a file. Old takes remain in the local audio store so undo can restore them.

The speaker slider changes listening volume. Channel and voice sliders change the saved mix and exported song. Playback stops and an active recording is cancelled when the page is hidden. Tempo is locked while the project contains vocals; the length of a recorded part is also fixed. Remove the part's recording to change its length. Microphone audio is never played through the speakers during recording. Use headphones to keep the backing track out of the microphone.

Recording requires HTTPS or localhost and a browser with microphone and AudioWorklet support. The recorder uses the audio clock and compensates for device latency estimates. Per-take timing can be adjusted by up to 250 ms in either direction. These estimates do not replace testing with real hardware, especially wireless audio devices. Real iPhone/iPad microphone behavior has not yet been verified. There are no accounts, analytics, network sound downloads or server database connections.

## Structure

- `src/music/`: typed project format, sound catalog, deterministic PCM synthesis, recording windows, vocal timing and WAV rendering. No DOM or Web Audio dependencies.
- `src/audio/`: worker rendering, Web Audio playback, microphone capture and the recording worklet.
- `src/storage/`: IndexedDB audio storage, versioned project bundles and imports.
- `src/ui/`, `src/main.ts` and `src/style.css`: touch interface, recording workflow and persistence. Tailwind and bundled Barlow fonts.

The music layer is reusable in another shell. A native audio adapter and real iPhone/iPad testing are still required before claiming native support.

All sound patterns and synthesis code in this project are original. No third-party samples are included. Fonts are distributed by Fontsource under their package licenses.
