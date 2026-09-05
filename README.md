# BUMM.

A local beat studio for children aged 6 to 9, with the interface aimed at age 9. Built from the selected loop-pad design. German interface, touch controls, Hip-Hop and Techno soundsets.

```sh
bun install
bun run dev
```

Open http://127.0.0.1:4176. `bun run build` checks TypeScript and builds the static app. `bun test` checks the song model and audio rendering.

The app plays original synthesized loops, switches sounds at bar boundaries, saves mixes as song parts, and exports stereo WAV files. Song parts can be edited, copied, reordered, renamed and removed. Changes can be undone. Each genre has a separate project. Local storage keeps both projects; project JSON files can be saved and loaded on another device.

The speaker slider changes listening volume. Channel sliders are part of the saved mix and the exported song. Playback stops when the page is hidden. Tempo changes require stopped playback. There are no accounts, analytics, network sound downloads or database connections.

## Structure

- `src/music/`: typed project format, sound catalog, deterministic PCM synthesis and WAV rendering. No DOM or Web Audio dependencies.
- `src/audio/`: worker rendering and the Web Audio playback adapter. The audio clock schedules loop changes.
- `src/main.ts` and `src/style.css`: interface, file handling and local persistence. Tailwind and bundled Barlow fonts.

The music layer is reusable in another shell. A native audio adapter and real iPhone/iPad testing are still required before claiming native support. Microphone recording and vocal tracks are the next design step and are not yet implemented.

All sound patterns and synthesis code in this project are original. No third-party samples are included. Fonts are distributed by Fontsource under their package licenses.
