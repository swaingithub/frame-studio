# Frame Studio

A **local-first, privacy-first** photo & video editing workspace that runs
entirely in your browser — no backend, no accounts, no uploads. Your media,
edits, and projects live in your browser's own storage (IndexedDB + OPFS).

> Placeholder name. Built in public, phase by phase. Current status: **Phase 1 (scaffold, shell,
> media library, projects) + Phase 2 (photo editor) done; Phase 4 (video core) and Phase 5
> (sequence-based video editing with split / speed / transitions / titles / music) built and
> verified end-to-end.**

## Quick start

```bash
npm install
npm run dev      # → http://localhost:5173
```

Pick **Try a sample project** on the welcome screen to get three generated
photos **and a short sample video** to explore with — no files needed.

All other commands:

| Command           | What it does                          |
| ----------------- | ------------------------------------- |
| `npm run dev`     | Vite dev server with HMR              |
| `npm run build`   | Typecheck + production bundle         |
| `npm run preview` | Serve the production build            |
| `npm test`        | Vitest unit tests (logic + storage)   |
| `npm run lint`    | ESLint                                |
| `npm run typecheck` | `tsc --noEmit` (zero-error policy)  |

## Feature roadmap

| Phase | Scope | Status |
| ----- | ----- | ------ |
| 1 | Scaffold, UI shell, media library, IndexedDB storage, project system | ✅ Done |
| 2 | Photo editor core — WebGL pipeline, sliders & one-click Looks, crop, export, undo/redo | ✅ Done |
| 3 | Photo advanced — **curves** ✅ (interactive master curve editor) · **HSL** ✅ (8-band hue/sat/lum mixer) · **batch** ✅ (apply grade to all photos, crops preserved) · **shape masks** ✅ (linear/circle/rect/mirror/heart/star with position, size, rotation, feather, invert — masked grading shared with video) · **text overlays** ✅ (draggable text layers with size/opacity/rotation/colour, identical preview & export) | ✅ Done |
| 4 | Video core — filmstrip, live graded preview (same pipeline), trim, volume → WebM clip export | ✅ Done |
| 5 | Video advanced — **sequence timeline** (split, reorder, duplicate), speed 0.25×–4×, dissolve/fade transitions, titles, music with audio ducking, whole-sequence export | ✅ Done |
| 5.5 | Video pro — **keyframe camera & overlay tracks** (zoom/pan/position with smooth auto-curve), **speed ramping** (rest ease inside a clip), text & image/video overlay layers with per-property keyframes, layer ordering | ✅ Done |
| 5.6 | Video pro — **chroma key (green screen)** with color presets, similarity / edge smoothness / de-spill, alpha compositing through preview and export | ✅ Done |
| 5.7 | Video — **overlay text animations** (Pop, Zoom, slide, typewriter intros; fade/slide outros) available in both Basic and Pro, rendered through the shared stage/export path | ✅ Done |
| 5.8 | Video pro — **shape masks** (linear, circle, rectangle, mirror, heart, star) with position, size, rotation, feather and invert, alpha-composited through preview and export | ✅ Done |
| 5.9 | Video — **built-in CC0 music library** (9 original offline tracks across chill, upbeat, ambient, cinematic, hip-hop, corporate, horror and retro, with mood filters, preview and one-click add), plus a reproducible synthesis script and license manifest | ✅ Done |
| 5.10 | Video — **canvas & aspect ratio** (Original, 16:9, 9:16, 1:1, 4:5, 4:3, 2.35:1) with color or blurred-clip letterbox fill, shared by preview and export | ✅ Done |
| 5.11 | Video — **stability & responsiveness pass**: frame loop survives bad frames, edits no longer restart the clock, memoized timeline, 20 fps inspector updates, accurate paused-seek repaints, export watchdog and audio-node cleanup | ✅ Done |
| 5.12 | **Responsive & touch pass**: overlay drawers / bottom inspector below 1180 px, compact header, touch-sized timeline handles and always-visible clip actions, phone-sized preview budget (video and photo), MP4 export fallback for Safari, installable PWA manifest + offline service worker | ✅ Done |
| 5.13 | Video — **transition library**: 15 transitions (dissolve, 4 slides, 4 wipes, circle, zoom, blur, fade to black/white) with adjustable length, overlap layout shared by preview/export, paused-scrub partner loading, timeline badges | ✅ Done |
| 6 | AI features — **auto-captions** (Whisper speech-to-text fully in-browser: opt-in one-time model download, then offline; language picker, captions as editable text overlays) · **background removal** (MediaPipe selfie segmentation, person cutout per clip and per photo, rendered through preview & export as transparent PNG) · **beat-sync** (local tempo analysis of the music, timeline beat grid, one-click "Sync cuts to beats") · **WebCodecs export** (real MP4 H.264+AAC via VideoEncoder/AudioEncoder + mp4-muxer, MediaRecorder fallback) · **stickers** (offline emoji library, inserted as animated text overlays) | Done |
| 6.1 | Video — **voiceover** (generate speech from pasted text with Kokoro TTS — on-device (~92 MB download once), added to the voice track and plays in export; all local) · **voiceover captions** (transcribe a voiceover to timeline captions with Whisper — shares the auto-captions model) · **fixes**: CSP now allows the Hugging Face + jsDelivr CDNs for AI model downloads (which also fixes the opt-in Whisper/MediaPipe downloads) | ✅ Done |
| 6.1 | Photo — **meme generator** (meme PNG from a library photo + top/bottom captions, via the Library **Meme** tool) · **combine images** (stitch 2+ library photos — row/column/grid) · **poster maker** (title/subtitle/tagline lines on a photo, sizes + live preview) · **video converter** (re-encode any local video to MP4 H.264 or WebM VP9 at original or reduced resolution — WebCodecs, runs fully in-browser) · **design**: accent shifted to CapCut's cyan/teal (`#01E0F8` / `#40DAF5`) with on-accent text that passes AA; **fixes**: 1080p H.264 export now uses Level 4.0 (`avc1.640028`) instead of Level 3.1, which couldn't encode 1920×1080; CSP allows the MediaPipe model + scripts (GCS/jsDelivr) | ✅ Done |
| 7 | **Product hardening** — photo **tone curves** (interactive master curve) & **8-band HSL mixer** in the shared GL/Canvas pipeline · **batch grade** ("Apply grade to all photos", crops preserved) · **CI** (GitHub Actions: typecheck → lint → tests → build → Playwright E2E) · **E2E smoke suite** (boot, CSP integrity, privacy: no unexpected cross-origin traffic) · **security headers** (CSP that keeps AI model opt-ins the only cross-origin fetches, `X-Frame-Options`, `Permissions-Policy`) · **WCAG AA contrast pass** (new on-accent/on-danger tokens, audited in `docs/A11Y.md`) | ✅ Done |

## Architecture overview

```
src/
├─ core/                   Framework-free core: pure & testable
│  ├─ db/schema.ts         Dexie database + data model (assets, projects, blobs)
│  ├─ db/blobStore.ts      Blob storage with IndexedDB ⇄ OPFS routing
│  ├─ opfs.ts              Origin Private File System helpers
│  ├─ detection.ts         Capability detection (WebGL2, WebCodecs, OPFS…)
│  ├─ render/              The one render pipeline (shader, geometry, WebGL2
│  │                       backend + Canvas 2D fallback, histogram, aspect fit)
│  ├─ adjustments/         Adjustment registry (params, defaults) + shared
│  │                       Looks: presets & Auto enhance (pure)
│  ├─ projectAssets.ts     Asset-lookup helpers (pure)
│  └─ format.ts            Human formatting (bytes, durations, dates)
├─ features/
│  ├─ library/             Import pipeline, metadata probes, filters, grid UI
│  ├─ photo/               Photo editor store, EditHistory, inspector
│  ├─ video/               Video editor: sequence model (clips, transitions,
│  │                       titles, voiceovers, music + pure layout/split
│  │                       math), store, sequence stage engine, WebCodecs
│  │                       export (MP4 H.264 / WebM VP9, precise frames),
│  │                       Kokoro TTS voiceover generator (voiceover.ts),
│  │                       voiceover captions (voiceoverCaptions.ts)
│  ├─ projects/            Project model (pure), autosaving store, dialogs
│  └─ workspace/           App shell, panels, photo/video workspaces
├─ workers/
│  └─ thumbnail.worker.ts  Off-main-thread thumbnail generation
├─ ui/                     Design system: theme, buttons, dialogs, toasts…
├─ lib/                    cn(), hooks, thumbnail client
└─ test/                   Vitest setup (fake-indexeddb)

public/music/              Bundled CC0 tracks (original synthesis) + manifest
scripts/generate-music.py  Reproducible generator for the bundled tracks
```

Key principles:

- **Non-destructive by design** — originals are stored immutable; edits are
  plain serializable docs (`photoEdits`, the video sequence with per-clip
  `edit` docs) applied by a pure render pipeline.
- **One data model** — the media library is global; projects reference assets.
- **One grading engine** — photos and videos run through the same shader;
  presets and Auto enhance live once in `core/adjustments/presets.ts`.
- **Storage routing** — files ≤160 MB go to IndexedDB blobs; larger files go to
  OPFS when available. Thumbnails are tiny WebPs generated in a worker.
- **Degrade gracefully** — missing WebGL2 falls back to Canvas 2D (geometry
  exact, color approximate); missing OPFS is never fatal.
- **Responsive by default** — the three-column editor is used from 1180 px up;
  narrower windows get a full-width stage with the library and inspector as
  overlay drawers (the inspector becomes a bottom sheet on phones). Touch
  targets grow on coarse pointers and the preview render budget drops on
  small screens. Production builds are installable and cache the app shell for
  offline use.

### Bundled music

`public/music/` contains nine original tracks synthesized by
`scripts/generate-music.py` (numpy only — no samples, no downloads). They are
dedicated to the public domain under **CC0 1.0**, so they can be shipped and
used commercially without attribution. The app reads `musicLibrary.json`,
previews files locally and copies a track into the user's project only when
chosen; nothing is streamed. Regenerate the set with:

```bash
python3 scripts/generate-music.py
```

The script rewrites both `public/music/manifest.json` and
`src/features/video/musicLibrary.json`; `public/music/LICENSE.txt` records the
license.

## How to use (the 10-second tour)

1. **Open Frame Studio** → *Try a sample project*.
2. **Photos**: click a photo → pick a Look (`Auto`, `Vivid`, `B&W`, …) or drag
   sliders → hit **Export**. Compare with the original via the eye button.
   Cut the background out of any photo with **Remove background**, and make
   memes, posters, or combine photos in the **Library** (**Meme**,
   **Combine**, **Poster**).
3. **Videos**: switch to **Video Editor** → build a sequence: add clips from
   the library, **split at the playhead** (scissors), trim by dragging a clip's
   edges, **drag clips left/right to reorder** them, and duplicate/delete with
   the strip buttons. Ramp **speed**, set a **transition** (dissolve, slides,
   wipes, circle, zoom, blur, fades — with an adjustable length) and a
   **title**, drop **music** under it — one undo covers everything. Hit
   **Auto captions** in the inspector to transcribe the clip's speech
   on-device (Whisper runs in a worker; the small model downloads once, with a
   clear note, then it's fully offline) and tweak the resulting text overlays
   like any other. **Background removal** cuts the subject out of any clip
   with a one-time ~250 KB segmentation model — toggle it in the inspector,
   no green screen needed (it detects people). Drop in **music** and hit
   **Detect beats** to get a timeline beat grid — then **Sync cuts** retrims
   every cut to land on a beat.
   **Export video** plays once and saves the whole sequence as a real
   **`.mp4` (H.264 + AAC, WebCodecs)** where the browser supports it —
   precise frame encoding with hardware encoders — and falls back to
   MediaRecorder (`.webm`, or `.mp4` on Safari) otherwise. Titles included.
   Or **Convert**: pick a library video, choose MP4 H.264 or WebM VP9 at the
   original or a smaller resolution and convert — done in your browser.
   And **Voiceover**: paste text in the inspector, pick a Kokoro voice,
   **Generate** — the WAV lands on the voice track and plays in export.
    And **Voiceover captions**: pick a voiceover, **Transcribe a voiceover…**
    — Whisper turns the generated speech into captions on the timeline.
   On phones, open the **Library** and **Inspector** from the header buttons;
   the inspector appears as a bottom sheet and both close with the backdrop or
   <kbd>Esc</kbd>.
4. **Layers & motion (video)**: the **Overlays** row adds text, **stickers**
   (offline emoji picker — smileys, hearts, film claps and more, inserted at
   2.4× text size) or an image/video layer above the timeline; select it to
   edit text, position, scale, opacity and timing. **Animation** chips give
   every layer a CapCut-style
   intro (**Pop**, **Zoom**, **Slide**, **Typewriter**) and outro (**Fade**,
   **Slide**) — available in Basic and Pro. Click a **◇ keyframe diamond** next
   to a slider to freeze its value at the playhead — move the playhead, change
   the value, and Frame Studio auto-animates between the two (same for the
   clip's **Camera** zoom/pan). **Speed ramp** chips ease a clip in/out without
   changing its length.
5. **Green screen (video, Pro)**: select a clip shot against a solid screen →
   **Chroma key** → switch it on and pick the backdrop color (green / blue /
   magenta / …). **Similarity** controls how much of the screen drops away,
   **Smoothness** softens edges, **De-spill** removes color fringe on hair and
   shoulders. Keyed pixels are transparent, so a **dissolve** onto the next
   clip lets your subject appear over it.
6. **Music library (video, Basic + Pro)**: open **Music → Library** to preview
   nine original tracks and add one with a single click. They are bundled with
   the app, work offline and are licensed **CC0 1.0** (no attribution needed).
   Imported audio files still appear in the same track picker.
7. **Mask (video, Pro)**: select a clip → **Mask** → pick a shape (**Linear**,
   **Circle**, **Rectangle**, **Mirror**, **Heart**, **Star**) then drag
   **X/Y/Width/Height**, **Rotation** and **Feather** for soft edges, or
   **Invert** to keep everything outside the shape. Masked pixels become
   transparent, so a clip below (or a dissolve) shows through.
8. **Canvas & aspect (video, Basic + Pro)**: open **Canvas** in the inspector
   (available with or without a selected clip) → pick a frame shape (**Original**,
   **16:9**, **9:16**, **1:1**, **4:5**, **4:3**, **2.35:1**). Clips are fitted
   inside the fixed frame; the surrounding space is filled with **Color Fill**
   (swatches or a custom color) or **Blurred Clip** (the current shot as a
   soft backdrop). The setting is saved with the project and the exported
   `.webm` uses the same output size — e.g. 720×1280 for 9:16, 1280×544 for
   2.35:1.
9. Everything autosaves; nothing ever leaves the device.

## Keyboard shortcuts

| Shortcut | Action |
| -------- | ------ |
| `⌘/Ctrl + I` | Import files |
| `Space` (video) | Play / pause the sequence |
| `⌘/Ctrl + Z` / `⇧⌘Z` | Undo / redo the current edit |
| `\` (hold) | Compare with the original |
| Double-click a slider label | Reset that adjustment |

## Browser support

| Browser | Status | Notes |
| ------- | ------ | ----- |
| Chrome / Edge 111+ | ✅ Full | WebGL2, WebCodecs, OPFS all available |
| Firefox 121+ | ✅ Good | OPFS available; WebGL2 ok; WebCodecs gaining |
| Safari 16.4+ | ⚠️ Partial | OPFS 16.4+ limited; HEIC decodes natively; video export falls back to MP4/H.264 (WebM recording is unsupported) |
| Any browser without WebGL2 | ✅ Works | Canvas 2D fallback (Phase 2+ pipelines) |

## Responsive layout & install

| Viewport | Layout |
| -------- | ------ |
| ≥ 1180 px | Inline three-column editor with resizable library/inspector |
| 768–1179 px | Full-width stage; library and inspector slide in as side drawers |
| < 768 px | Same, with the inspector as a bottom sheet and a compact header |

Touch devices get larger trim handles/toolbar buttons, always-visible clip
actions, and a 960 px preview budget (instead of 1280 px) to keep playback
smooth. Run `npm run build && npm run preview` and open the result over
localhost/HTTPS to install the app; the service worker caches only the app
shell (media stays in IndexedDB/OPFS).

## Privacy & network

The app makes **no network requests with user media** — there is no upload
code path. The only network touches are the local dev server itself and (from
Phase 6) opt-in downloads for AI models, clearly labelled before download.

## Development conventions

- TypeScript `strict`, `noUnusedLocals`, `verbatimModuleSyntax`.
- Pure logic lives in `core/` (or pure `model` files) and is unit-testable.
- Zustand stores hold UI state; Dexie is the source of truth for data, and
  `useLiveQuery` keeps components reactive without duplicating state.
- Object URLs are always revoked (`useObjectUrl`), textures/URLs capped —
  memory hygiene utilities land with the Phase 2 render pipeline.

## License

MIT — see [LICENSE](./LICENSE). The app is free to use and modify.

The bundled music library is **CC0 1.0** (no attribution needed) — details in
[`public/music/LICENSE.txt`](./public/music/LICENSE.txt).
