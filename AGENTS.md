# BUMM.

BUMM is a local beat studio for children aged 6 to 9, with the interface aimed
at age 9. It uses TypeScript, Vite, Tailwind and Web Audio. Bun runs the tools
and unit tests. GitHub Pages serves the static build.

The interface is German. Children combine synthesized Hip-Hop and Techno loops,
arrange song parts, record vocals and export their songs.

## What makes BUMM special?

These are the promises the product is built on. Keep them intact.

### 1. The music stays on the device

There are no accounts, analytics, network sound downloads or server database
connections. Fonts ship with the app. The app synthesizes its loops locally.
Recordings stay on the device unless the user downloads and shares a file.
Do not add outside services without discussing the product change first.

### 2. Light enough for a phone

Keep JavaScript, assets and audio work small. Weigh every dependency you add.
Avoid continuously repainting animations, including pulse, shimmer, blur and
spinners. They cost battery and frames.

### 3. Simple enough for a child

Keep controls obvious, touch targets usable and German copy short. A wide
screen gives the same studio more room. Judge a UI change on the phone first.
Do not add configuration switches to compensate for confusing behavior.

### 4. A recording must survive an edit

Metadata lives in localStorage and recorded audio lives in IndexedDB. Project
files contain both. Keep undo, persistence, import, export and playback aligned.
Voice clips have their own time positions and playback windows. Moving or
shortening beats must not move or trim vocals. Shortening a voice clip keeps
the full recording, so extending it can restore available audio.

### 5. Audio behavior must agree

The speaker slider changes listening volume. Channel and voice sliders change
the saved mix and exported song. Never send microphone audio through the
speakers during recording. Preserve the timing rules shared by playback and
WAV export.

## A note from Klaus

I like ambitious ideas, simple systems, and software that feels obvious. Do not
keep complexity because it is already there. Do not add machinery because it
looks architecturally impressive. Understand the real constraint, then fight for
the smallest model that makes the correct behavior unsurprising.

Channel both "measure twice, cut once" and YAGNI. Fight scope creep. Propose a
bold idea when it truly helps, and say so plainly instead of building it behind
my back.

A question is read-only. If I ask how hard something is, why something happens,
or whether something should be done, answer it and offer the change. Do not
start editing.

Match the ceremony to the task. One agent in one pass beats a panel for
ordinary work.

The rest of this file helps you find your way and make changes well. Treat it as
good defaults, not as scripture. My preferences in the moment beat anything
written here.

## A small glossary

Use this language in code, in the UI and when talking to me.

- **you** means the agent reading this file and changing BUMM.
- **we, us, maintainers** mean Klaus and the people building BUMM.
- **project** means the saved studio state for one genre.
- **song part** means one arranged section of the song.
- **take** means one recorded vocal performance stored as audio in IndexedDB.
- **voice clip** means a take placed at a time position on the independent
  voice track. Its playback window does not depend on a song part.
- **project file** means a `.bumm` bundle with metadata and lossless audio.
- **WAV export** means the stereo audio file containing beats and vocals.

## The three ways to hurt yourself

1. **Taking an occupied port, or killing by pattern.** Port 4176 is the default
   development and preview port. Leave Klaus's running server alone. Browser
   tests use 4177. Use another free port for your own server with `--strictPort`.
   Never use `pkill -f`, `pgrep | kill`, or kill by name or worktree path.
   Kill only a PID you captured at spawn.
2. **Writing over local projects or recordings.** Browser storage contains real
   work. Use isolated test storage. Remove only records your own run created.
   Never clear Klaus's localStorage or IndexedDB. Old takes can still belong
   to undo history, so do not treat unreferenced audio as disposable.
3. **Publishing without permission.** A successful push to `main` deploys through
   `.github/workflows/pages.yml`. The workflow also supports a bootstrap commit
   through `PAGES_BOOTSTRAP_SHA`. Do not push to a deployment trigger, change
   hosting settings, or touch the live site without explicit instructions.
   State exactly what you will touch before work near these systems.

## Hit every surface

Before you call a behavior change done, check the applicable paths.

- **Playback and export.** Timing, part length, mix levels and vocals must agree
  between live playback and the exported WAV.
- **Saved and restored state.** Check persistence, undo, project import and
  export. Preserve supported older project formats when changing storage.
- **Both genres.** Hip-Hop and Techno have separate projects. Check both when
  changing shared controls or state.
- **Reverse states.** Check cancellation, undo and recovery where relevant.
  Cancelling a recording must preserve the previous take.
- **Recording lifecycle.** Check start, stop, cancellation, permission failure
  and hidden-page behavior. Release resources created by the operation.
- **Phone and desktop.** Check both layouts, phone first. Build several distinct
  static mocks before a substantial UI, layout or copy change. Write them to
  local HTML files in a tmp folder and wait for Klaus's selection.
- **Language.** Keep user-facing copy German and use consistent names.
- **Docs.** Update `README.md` in the same pull request when behavior, storage,
  commands, ports or hosting changes. This file holds the permanent rules.

## Dev servers

- `bun install` installs dependencies. Use `bun install --frozen-lockfile` when
  verifying the committed dependency set.
- `make start` installs dependencies, starts Vite at `http://127.0.0.1:4176`
  and opens the browser. That port is Klaus's. For agent checks, use a free
  port with `make start PORT=<port> OPEN=` and leave the browser closed unless
  authorized. `bun run dev` starts only Vite.
- `bun run build` checks TypeScript and creates the static build in `dist/`.
- `bun run preview` serves that build on port 4176.
- Development uses `/`. Builds and previews use `/bumm/`, including workers,
  fonts and other assets. Keep both paths working.
- Browser tests build the app and start a separate preview server on port 4177.
  `PLAYWRIGHT_BASE_URL` selects an existing server. Never point tests at the
  live site without explicit instructions.
- Use installed CLIs first. Ask before installing missing tools or using a
  browser, including browser automation.
- Stop what you started, by the PID you tracked.

## Test data

- Use representative synthetic projects and recordings in isolated test storage.
  Include vocals and older project formats when the change affects them.
- Never use personal recordings or microphone input without permission.
- Use generated audio to test recording and export behavior where possible.
- Never overwrite a user's project file to test import or export.

## Verifying

- **Write the failing test first** for a behavior change that needs a test.
- Test music, recording and storage behavior with unit tests under `tests/`.
  Test user workflows through Playwright under `tests/browser/` when browser
  automation is authorized.
- Wait for the relevant UI and audio state before acting in a browser test.
  Do not replace readiness checks with arbitrary delays.
- A test that creates state outside its own scope clears it. This includes
  storage, workers, audio contexts, microphone streams and application globals.
- Before a pull request with code changes, run `bun run test` and
  `bun run build`. Run `bun run test:browser` when authorized. CI runs unit
  tests and browser tests, and the browser command includes the build.
- Treat a CI-only failure as a possible ordering or timing race. Investigate
  state contamination and reproduce suspected timing races under CPU load.
  Rerunning proves nothing.
- Finish a UI change with visual checks at phone and desktop sizes when browser
  use is authorized. State any checks you could not run.
- Do not claim microphone or native support from simulated tests alone.
  `README.md` records the current hardware verification limits.

## Pull requests

- For implementation work, create a branch from `main` in a worktree named
  `../worktrees/<repo-folder-name>-<slug>`. Never commit on `main`.
  Use EnterWorktree or an equivalent session mechanism when available.
  Otherwise set the worktree as the working directory for every command.
- Keep at most ten registered worktrees. Never force a removal or remove a
  dirty or unintegrated worktree. Ask if you cannot reduce the count safely.
- Use `feature/<slug>` for a user-facing capability, a change across several
  modules, or work that will need more than two commits. Use a short branch name
  for anything smaller.
- Branch names, commits and pull request text are English. Add no agent
  co-author or generation trailer to commits.
- Pull the latest `main`, then rebase the branch onto it before opening a PR.
- Open a normal pull request, never a draft. Follow the repository's title
  conventions. Describe the problem briefly, then explain the solution.
  End the description with the model and harness that did the work.
  Include before and after images for UI changes when available.
- Aim for one pull request per conversation. Keep its requirements together
  and avoid unrelated work.
- Verify review findings against the source. Fix real findings with focused
  tests where useful. Never commit temporary review probes.
- When monitoring a pull request, poll checks and comments newer than the last
  push. Fix valid findings and dismiss false positives with a written reason.
  Stay quiet when nothing is new. Stop when the review bots are green on the
  latest commit.
- Merge only with explicit authorization. Remember that merging to `main`
  triggers deployment after checks pass.

## Where code lives

- `src/music/` holds the typed project format, sound catalog, deterministic PCM
  synthesis, recording windows, vocal timing and WAV rendering. Keep this layer
  free of DOM and Web Audio dependencies.
- `src/audio/` holds worker rendering, Web Audio playback, microphone capture
  and the recording worklet.
- `src/storage/` holds IndexedDB audio storage, versioned project bundles and
  imports.
- `src/ui/`, `src/main.ts` and `src/style.css` hold the touch interface,
  recording workflow and UI persistence wiring.
- `tests/*.test.ts` holds unit tests. `tests/browser/` holds Playwright tests.
- `vite.config.ts`, `playwright.config.ts`, `package.json` and
  `.github/workflows/pages.yml` define build, test and hosting behavior.

## Taste

- Keep it simple. Channel YAGNI unless told otherwise.
- Type safety where it earns its place, not everywhere.
- Comments explain how a thing is used and what is not obvious, not every line.
  A comment moves when its code moves.
- Complexity belongs at the edges: audio adapters, browser storage and file
  imports. The music model stays plain and the UI stays dumb.
- Write focused tests that protect real behavior. No endless smoke tests, and no
  regression test for a feature that is gone.
- Be careful with anything destructive that Klaus did not ask for.

## Prose

- Apply `ste-writing` to English pull request text, documentation, error
  messages and UI copy. Strict mode for procedures and errors, flavored mode
  everywhere else.
- Never use an em dash. Use a comma, a colon, parentheses or two sentences.
- Keep it short. A sentence a reader has to read twice is a sentence to rewrite.
