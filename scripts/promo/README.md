# The promo video

How the video on codingfleet.com/download/ (and the home page) and the README's
`docs/demo.gif` are made, so they can be made again after the app changes.

The app in the video is the real one: its window, its tools, its approvals,
its diffs and Undo. Commands really run in three small demo projects, so their
output (the benchmark, `tsc`, the phone screenshot) is real. Only the model is
scripted: `mock-api.cjs` stands in for the CodingFleet API and plays the turns
in `turns.cjs`. Nothing touches your account, your sessions or your credits.

## Make it

```bash
node scripts/promo/take.mjs 1-screenshot-fix --record takes/1-screenshot-fix.mp4
node scripts/promo/take.mjs 2-perf-hunt --record takes/2-perf-hunt.mp4
node scripts/promo/take.mjs 3-fleet-migration --record takes/3-fleet-migration.mp4
node scripts/promo/take.mjs 4-settings --record takes/4-settings.mp4
python scripts/promo/render.py takes video.mp4
```

The website's copy is a lighter encode of it, with no sound; it goes in the
codingfleet repo as `assistant/static/videos/desktop-demo.mp4`, with a poster
frame beside it:

```bash
ffmpeg -i video.mp4 -an -c:v libx264 -preset slow -crf 27 -tune stillimage -pix_fmt yuv420p -movflags +faststart desktop-demo.mp4
ffmpeg -ss 2.4 -i desktop-demo.mp4 -frames:v 1 -vf scale=1280:-1 -q:v 3 desktop-demo-poster.jpg
```

`render.py` runs `edit.py` in eight parallel parts and joins them (a few
minutes); `edit.py` alone renders the same cut in one process.

The effects follow one cue sheet, `edit.timeline()`: when each chapter
appears, the payoffs (before/after, p99, 59 errors to 0), the steer, Undo, each
sub-agent starting, each theme switch. `edit.py` puts its effects on those
cues (a push-in and a glow on impacts, light sweeps on reveals, the counters,
the sub-agent chips, the backdrop breathing on each bar). Moments inside a take
are listed in `TAKE_CUES` (seconds of the take). The video has no sound.

The README's GIF is chapters 1 to 3 at 1.5× speed, from a render whose backdrop
does not breathe (a moving backdrop makes every GIF frame new, and the file 50%
bigger):

```bash
python scripts/promo/render.py takes gif-source.mp4 --still-backdrop
ffmpeg -ss 2.9 -to 71.0 -i gif-source.mp4 -vf "setpts=PTS/1.5,fps=10,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" docs/demo.gif
```

Each take resets the demo projects in `C:\dev` (`setup-projects.mjs`), starts
the app with an empty profile, plays the scene and records the window at 30 fps.
A window appears on screen while it runs; leave it alone until it closes. The
clipboard is used for the pasted screenshot and put back afterwards.

`--shots DIR` instead of `--record` takes a picture at each moment of the
scene, which is quicker for checking a change. `edit.py ... --preview` renders
the cut at half size.

The edit's timings are in seconds of each take. A new take runs a little
faster or slower, so check the `.marks.json` written next to it and move the
times in `edit.py` if a moment shifted. The p99 numbers in the captions come
from the benchmark in the take: update them if they changed.

## The parts

| File | What it does |
|---|---|
| `app.cjs` | Starts the app with its own profile, the mock API, and a control server on port 47800 |
| `mock-api.cjs`, `turns.cjs` | The scripted model, and the sessions in the sidebar |
| `drive.mjs`, `ctl.mjs` | A visible cursor, clicks, typing and waits, sent to the app |
| `scenes/*.mjs` | What happens in each scene |
| `projects/` | The demo projects' sources |
| `edit.py`, `render.py` | Framing, camera moves, pacing, captions, effects, intro and outro (needs Pillow and numpy) |
