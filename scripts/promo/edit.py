"""The promo video's edit: the recorded takes (take.mjs) framed, zoomed,
paced and captioned, with an intro and an outro.

    python scripts/promo/edit.py TAKES_DIR OUT.mp4 [--preview] [--only N]

TAKES_DIR holds 1-screenshot-fix.mp4 ... 4-settings.mp4 from take.mjs.
--preview renders at half size and 15 fps, for checking the cut quickly.
Times in the timeline are in seconds of the take (its own clock); the edit
works out how long each part lasts on screen from its speed.
"""
import math
import os
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
ASSETS = os.path.join(HERE, 'assets')

PREVIEW = '--preview' in sys.argv
# --still-backdrop: no breathing glow, for the GIF (a moving backdrop makes every frame new).
STILL = '--still-backdrop' in sys.argv
ONLY = sys.argv[sys.argv.index('--only') + 1] if '--only' in sys.argv else None
# --part i/n renders the i-th of n equal frame ranges (render.py joins them).
PART = tuple(int(v) for v in sys.argv[sys.argv.index('--part') + 1].split('/')) if '--part' in sys.argv else (0, 1)
K = 0.5 if PREVIEW else 1.0            # everything is laid out at 1920x1080, then scaled by K
W, H = int(1920 * K), int(1080 * K)
FPS = 15 if PREVIEW else 30
SRC_W, SRC_H = 1922, 1082               # the takes' frame size
VIEW = (160, 150, 1600, 900)            # where the app sits on the canvas (x, y, w, h)
RADIUS = 18
CROSSFADE = 0.5
APP_BG = (15, 16, 20)

INK = (240, 240, 247)
MUTED = (150, 152, 172)
ACCENT = (165, 155, 255)
GREEN = (74, 222, 128)
RED = (248, 113, 113)


def s(v):
    return int(round(v * K))


# ── Fonts ────────────────────────────────────────────────────────────────
def font(size, weight='Semibold Display'):
    f = ImageFont.truetype('C:/Windows/Fonts/SegUIVar.ttf', s(size))
    f.set_variation_by_name(weight)
    return f


# ── Static layers ────────────────────────────────────────────────────────
def background():
    """Near-black with two soft glows: the brand's violet, and a cool blue."""
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    base = np.zeros((H, W, 3), np.float32) + np.array([9, 9, 15], np.float32)

    def glow(cx, cy, r, color, strength):
        d = np.sqrt((x - s(cx)) ** 2 + (y - s(cy)) ** 2) / s(r)
        a = np.clip(1 - d, 0, 1) ** 2.2 * strength
        return a[..., None] * np.array(color, np.float32)

    base += glow(250, -80, 1100, (124, 108, 255), 0.42)
    base += glow(1750, 1150, 1000, (56, 120, 255), 0.22)
    base += glow(960, 1080, 700, (124, 108, 255), 0.10)
    # A little grain, so the gradients do not band.
    rng = np.random.default_rng(7)
    base += rng.normal(0, 1.4, base.shape)
    return np.clip(base, 0, 255).astype(np.uint8)


def rounded_mask(w, h, r, scale=4):
    big = Image.new('L', (w * scale, h * scale), 0)
    ImageDraw.Draw(big).rounded_rectangle((0, 0, w * scale - 1, h * scale - 1), r * scale, fill=255)
    return big.resize((w, h), Image.LANCZOS)


def frame_layers():
    """The shadow under the app, and the thin light edge around it."""
    x, y, w, h = [s(v) for v in VIEW]
    shadow = Image.new('L', (W, H), 0)
    ImageDraw.Draw(shadow).rounded_rectangle((x, y + s(24), x + w, y + h + s(24)), s(RADIUS), fill=255)
    shadow = shadow.filter(ImageFilter.GaussianBlur(s(46)))
    edge = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(edge).rounded_rectangle((x - 1, y - 1, x + w, y + h), s(RADIUS) + 1, outline=(255, 255, 255, 34), width=1)
    return np.asarray(shadow, np.float32)[..., None] / 255 * 0.65, edge


BG = background()
SHADOW, EDGE = frame_layers()
MASK = rounded_mask(s(VIEW[2]), s(VIEW[3]), s(RADIUS))
BASE = (BG.astype(np.float32) * (1 - SHADOW)).astype(np.uint8)


def over(canvas, layer, xy=(0, 0), alpha=1.0):
    """Alpha-composites an RGBA PIL layer onto an RGB PIL canvas."""
    if alpha <= 0:
        return
    if alpha < 1:
        a = layer.getchannel('A').point(lambda v: int(v * alpha))
        layer = layer.copy()
        layer.putalpha(a)
    canvas.paste(layer, xy, layer)


# ── Text ─────────────────────────────────────────────────────────────────
def text_layer(lines, width=1920, height=None, align='left'):
    """lines: [(text, font, color, (x, y))] in 1920-space. Returns RGBA."""
    img = Image.new('RGBA', (s(width), s(height or 1080)), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for text, f, color, (x, y), *rest in lines:
        anchor = rest[0] if rest else 'la'
        spacing = rest[1] if len(rest) > 1 else 0
        if spacing:
            # Letter-spaced small caps line.
            cx = s(x)
            for ch in text:
                d.text((cx, s(y)), ch, font=f, fill=color, anchor='ls')
                cx += d.textlength(ch, font=f) + s(spacing)
        else:
            d.text((s(x), s(y)), text, font=f, fill=color, anchor=anchor)
    return img


def pill(text, f, color=INK, fill=(255, 255, 255, 18), border=(255, 255, 255, 40), dot=None):
    d = ImageDraw.Draw(Image.new('RGBA', (1, 1)))
    tw = d.textlength(text, font=f)
    pad = s(16)
    dot_w = s(18) if dot else 0
    w, h = int(tw + pad * 2 + dot_w), s(40)
    img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    dd = ImageDraw.Draw(img)
    dd.rounded_rectangle((0, 0, w - 1, h - 1), h // 2, fill=fill, outline=border)
    if dot:
        dd.ellipse((pad, h // 2 - s(4), pad + s(8), h // 2 + s(4)), fill=dot)
    dd.text((pad + dot_w, h // 2), text, font=f, fill=color, anchor='lm')
    return img


F_EYEBROW = font(15, 'Bold Text')
F_HEAD = font(40, 'Semibold Display')
F_PILL = font(17, 'Semibold Text')


def caption(eyebrow, headline):
    return text_layer([
        (eyebrow.upper(), F_EYEBROW, ACCENT, (VIEW[0] + 2, 62), 'ls', 2.2),
        (headline, F_HEAD, INK, (VIEW[0], 118), 'ls'),
    ], height=150)


# ── Reading the takes ────────────────────────────────────────────────────
class Take:
    """Frames of a take, by time, read forward through one ffmpeg pipe."""

    def __init__(self, path):
        self.path = path
        self.proc = None
        self.index = -1
        self.frame = None
        self.fps = 30

    def _open(self, t):
        if self.proc:
            self.proc.kill()
        self.start = max(0.0, t - 0.05)
        self.proc = subprocess.Popen(
            ['ffmpeg', '-loglevel', 'error', '-ss', f'{self.start:.3f}', '-i', self.path,
             '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, bufsize=SRC_W * SRC_H * 3 * 2)
        self.index = int(round(self.start * self.fps)) - 1
        self.frame = None

    def at(self, t):
        want = int(round(t * self.fps))
        if self.proc is None or want < self.index or want - self.index > 90:
            self._open(t)
        while self.index < want or self.frame is None:
            raw = self.proc.stdout.read(SRC_W * SRC_H * 3)
            if len(raw) < SRC_W * SRC_H * 3:
                break  # the end of the take: keep its last frame
            self.frame = raw
            self.index += 1
        return Image.frombuffer('RGB', (SRC_W, SRC_H), self.frame, 'raw', 'RGB', 0, 1)


# ── Timing ───────────────────────────────────────────────────────────────
def time_map(pieces, ramp=0.25):
    """pieces: [(src_from, src_to, speed)]. Returns (out_duration, out->src, src->out).
    Speed changes are eased over `ramp` seconds of the take."""
    s0, s1 = pieces[0][0], pieces[-1][1]
    src = np.arange(s0, s1, 0.002)
    # Filled with the last speed first: arange can add one sample past the last piece.
    speed = np.full_like(src, pieces[-1][2])
    for a, b, v in pieces:
        speed[(src >= a) & (src < b)] = v
    # Ease between pieces: a moving average over the ramp.
    n = max(1, int(ramp / 0.002))
    kernel = np.ones(n) / n
    speed = np.convolve(np.pad(speed, (n // 2, n - n // 2 - 1), mode='edge'), kernel, mode='valid')
    out = np.concatenate([[0], np.cumsum(0.002 / speed)])[:-1]
    duration = out[-1]
    return duration, (lambda t: float(np.interp(t, out, src))), (lambda t: float(np.interp(t, src, out)))


def ease(t):
    t = min(1.0, max(0.0, t))
    return t * t * (3 - 2 * t)


def ease_out(t):
    t = min(1.0, max(0.0, t))
    return 1 - (1 - t) ** 3


# ── Sections ─────────────────────────────────────────────────────────────
class Chapter:
    """One take, paced (pieces), filmed (camera keys), captioned."""

    def __init__(self, take, eyebrow, pill_text, pieces, camera, captions, pill_dot=GREEN):
        self.take = Take(take)
        self.duration, self.to_src, self.to_out = time_map(pieces)
        # Keys and captions are given in take time; on screen they run in edit time.
        self.camera = [(self.to_out(t), cx, cy, z) for t, cx, cy, z in camera]
        self.eyebrow = eyebrow
        self.captions = [(self.to_out(a), self.to_out(b) if b is not None else self.duration,
                          text if callable(text) else caption(eyebrow, text))
                         for a, b, text in captions]
        self.pill = pill(pill_text, F_PILL, dot=pill_dot) if pill_text else None
        self.punches = []  # edit times of the hits in this chapter (timeline() fills it)
        self._live = {}

    def punch(self, t):
        """A small push-in on a hit: up fast, back slowly."""
        out = 0.0
        for h, strength in self.punches:
            d = t - h
            if 0 <= d < 1.2:
                out = max(out, strength * min(1, d / 0.07) * math.exp(-d / 0.32))
        return out

    def caption_at(self, layer, t, a):
        if not callable(layer):
            return layer
        text = layer(t - a)
        if text not in self._live:
            self._live = {text: caption(self.eyebrow, text)}
        return self._live[text]

    def cam(self, t):
        keys = self.camera
        if t <= keys[0][0]:
            return keys[0][1:]
        for (t0, *a), (t1, *b) in zip(keys, keys[1:]):
            if t0 <= t <= t1:
                k = ease((t - t0) / max(1e-6, t1 - t0))
                return [u + (v - u) * k for u, v in zip(a, b)]
        return keys[-1][1:]

    def render(self, t):
        frame = self.take.at(self.to_src(t))
        cx, cy, z = self.cam(t)
        z *= 1 + 0.035 * self.punch(t)
        bw, bh = SRC_W / z, SRC_H / z
        x0 = min(max(cx - bw / 2, 0), SRC_W - bw)
        y0 = min(max(cy - bh / 2, 0), SRC_H - bh)
        view = frame.resize((s(VIEW[2]), s(VIEW[3])), Image.LANCZOS, box=(x0, y0, x0 + bw, y0 + bh))
        canvas = Image.fromarray(BASE)
        canvas.paste(view, (s(VIEW[0]), s(VIEW[1])), MASK)
        over(canvas, EDGE)
        for a, b, layer in self.captions:
            fade_in = ease_out((t - a) / 0.4)
            fade_out = 1 - ease((t - (b - 0.25)) / 0.25) if b < self.duration - 0.01 else 1
            alpha = min(fade_in, fade_out)
            if alpha > 0 and a - 0.01 <= t <= b:
                over(canvas, self.caption_at(layer, t, a), (0, s(10 * (1 - fade_in))), alpha)
        if self.pill:
            over(canvas, self.pill, (s(VIEW[0] + VIEW[2]) - self.pill.width, s(86)), ease_out(t / 0.5))
        return canvas


class Card:
    """A designed full-canvas moment: draw(canvas, t, duration)."""

    def __init__(self, duration, draw):
        self.duration = duration
        self.draw = draw

    def render(self, t):
        canvas = Image.fromarray(BG)
        self.draw(canvas, t, self.duration)
        return canvas


LOGO = Image.open(os.path.join(REPO, 'build', 'icon.png')).convert('RGBA')


def logo(size):
    """The app icon as a rounded tile (the file is a full square)."""
    img = LOGO.resize((s(size), s(size)), Image.LANCZOS)
    img.putalpha(rounded_mask(s(size), s(size), int(s(size) * 0.23)))
    return img


def intro(canvas, t, d):
    a = ease_out(t / 0.7)
    lg = logo(132)
    over(canvas, lg, (s(960) - lg.width // 2, s(300 + 16 * (1 - a))), a)
    b = ease_out((t - 0.35) / 0.7)
    over(canvas, text_layer([('CodingFleet Desktop', font(76, 'Bold Display'), INK, (960, 548 + 12 * (1 - b)), 'ms')]), alpha=b)
    c = ease_out((t - 0.8) / 0.7)
    over(canvas, text_layer([('The AI coding agent that works on your real code,', font(30, 'Regular Display'), MUTED, (960, 622 + 10 * (1 - c)), 'ms'),
                             ('on your computer, and asks before it changes anything.', font(30, 'Regular Display'), MUTED, (960, 664 + 10 * (1 - c)), 'ms')]), alpha=c)


def phone(path, height):
    img = Image.open(path).convert('RGB')
    w = int(img.width * height / img.height)
    img = img.resize((w, height), Image.LANCZOS)
    pad = s(10)
    shell = Image.new('RGBA', (w + pad * 2, height + pad * 2), (0, 0, 0, 0))
    ImageDraw.Draw(shell).rounded_rectangle((0, 0, shell.width - 1, shell.height - 1), s(42), fill=(28, 29, 38, 255), outline=(255, 255, 255, 46), width=max(1, s(2)))
    shell.paste(img, (pad, pad), rounded_mask(w, height, s(32)))
    return shell


PHONE_H = s(700)
BEFORE = phone(os.path.join(ASSETS, 'wayfare-broken.png'), PHONE_H)
AFTER = phone(os.path.join(ASSETS, 'wayfare-fixed.png'), PHONE_H)


def before_after(canvas, t, d):
    over(canvas, caption('01 · See it, fix it', 'Before and after, checked by the agent itself.'), alpha=ease_out(t / 0.4))
    cx = 960
    for i, (img, label, color) in enumerate([(BEFORE, 'Your screenshot', RED), (AFTER, "The agent's own check", GREEN)]):
        k = ease_out((t - 0.15 - i * 0.35) / 0.6)
        x = s(cx + (-1 if i == 0 else 1) * 250) - img.width // 2
        y = s(222 + 30 * (1 - k))
        over(canvas, img, (x, y), k)
        tag = pill(label, F_PILL, dot=color)
        over(canvas, tag, (x + img.width // 2 - tag.width // 2, s(180 + 30 * (1 - k))), k)
    k = ease_out((t - 0.9) / 0.5)
    arrow = text_layer([('→', font(64, 'Semibold Display'), (255, 255, 255, 200), (960, 600), 'mm')])
    over(canvas, arrow, alpha=k)


def outro(canvas, t, d):
    a = ease_out(t / 0.6)
    lg = logo(112)
    over(canvas, lg, (s(960) - lg.width // 2, s(250 + 14 * (1 - a))), a)
    b = ease_out((t - 0.25) / 0.6)
    over(canvas, text_layer([('Your code. Your computer. Your call.', font(64, 'Bold Display'), INK, (960, 478 + 12 * (1 - b)), 'ms')]), alpha=b)
    c = ease_out((t - 0.6) / 0.6)
    over(canvas, text_layer([('CodingFleet Desktop · free for Windows, macOS and Linux', font(30, 'Regular Display'), MUTED, (960, 550 + 10 * (1 - c)), 'ms')]), alpha=c)
    e = ease_out((t - 1.0) / 0.6)
    url = pill('codingfleet.com', font(26, 'Semibold Text'), color=INK, fill=(124, 108, 255, 70), border=(165, 155, 255, 140))
    over(canvas, url, (s(960) - url.width // 2, s(610 + 10 * (1 - e))), e)


def counter(template, start, end, seconds=0.9):
    """A caption whose number runs from start to end as it appears."""
    def text(dt):
        v = round(start + (end - start) * ease_out(dt / seconds))
        return template.format(f'{v:,}')
    return text


# ── The cut ──────────────────────────────────────────────────────────────
def build(takes):
    take = lambda name: os.path.join(takes, f'{name}.mp4')
    ch1 = Chapter(
        take('1-screenshot-fix'), '01 · See it, fix it', 'DeepSeek V4.1 Flash · Unlimited',
        pieces=[(0.4, 5.3, 2.4), (5.3, 13.4, 4.5), (13.4, 19.7, 3.2), (19.7, 21.6, 0.9),
                (21.6, 27.0, 2.6), (27.0, 32.6, 4.0), (32.6, 37.4, 2.2), (37.4, 40.0, 1.0)],
        camera=[(0.4, 961, 541, 1.0), (4.0, 961, 541, 1.0), (5.2, 1100, 760, 1.25), (12.6, 1100, 760, 1.25),
                (13.8, 961, 541, 1.0), (19.2, 961, 541, 1.0), (20.0, 1150, 560, 1.38), (21.6, 1150, 560, 1.38),
                (22.8, 961, 541, 1.0), (36.4, 961, 541, 1.0), (37.6, 880, 420, 1.45), (40.6, 880, 420, 1.5)],
        captions=[(0.4, 13.4, 'Paste a screenshot of what is broken.'),
                  (13.4, 21.8, 'Every change waits for your OK.'),
                  (21.8, 32.6, 'It runs the dev server in the background…'),
                  (32.6, None, '…and checks its own fix on a phone screen.')])
    ch2 = Chapter(
        take('2-perf-hunt'), '02 · Hunt down a slowdown', 'GPT-6 Luna · Unlimited',
        pieces=[(0.4, 7.8, 3.2), (7.8, 11.4, 1.5), (11.4, 23.9, 4.8), (23.9, 29.6, 2.6),
                (29.6, 39.4, 5.0), (39.4, 41.6, 1.0), (41.6, 48.4, 3.2), (48.4, 51.2, 2.2),
                (51.2, 53.9, 1.1), (53.9, 59.6, 3.8), (59.6, 63.0, 1.0), (63.0, 66.0, 3.0), (66.0, 68.8, 1.25)],
        camera=[(0.4, 961, 541, 1.0), (7.6, 961, 541, 1.0), (8.4, 1120, 790, 1.6), (11.2, 1120, 790, 1.6),
                (12.2, 961, 541, 1.0), (39.0, 961, 541, 1.0), (39.8, 1160, 430, 1.42), (41.6, 1160, 430, 1.42),
                (42.6, 961, 541, 1.0), (50.6, 961, 541, 1.0), (51.6, 1160, 420, 1.3), (53.9, 1160, 430, 1.3),
                (54.8, 961, 541, 1.0), (59.4, 961, 541, 1.0), (60.2, 1160, 590, 1.45), (63.4, 1160, 590, 1.45),
                (64.4, 1160, 650, 1.3), (69.6, 1160, 680, 1.36)],
        captions=[(0.4, 23.9, 'Pick any model for the job.'),
                  (23.9, 41.6, 'It measures before it changes anything.'),
                  (41.6, 51.0, 'Steer it while it works.'),
                  (51.0, 59.6, 'Read the exact diff, then allow it.'),
                  (59.6, 64.0, counter('p99: 3,152 ms → {} ms.', 3152, 36)),
                  (64.0, None, 'Changed your mind? Undo the whole run.')])
    ch3 = Chapter(
        take('3-fleet-migration'), '03 · A fleet of sub-agents', 'Claude Haiku 5.5 · lead agent',
        pieces=[(0.4, 10.6, 4.2), (10.6, 12.8, 1.1), (12.8, 20.5, 4.5), (20.5, 26.8, 3.2),
                (26.8, 29.4, 1.1), (29.4, 41.4, 2.0), (41.4, 50.3, 4.5), (50.3, 54.2, 3.0), (54.2, 57.6, 1.0)],
        camera=[(0.4, 961, 541, 1.0), (10.4, 961, 541, 1.0), (11.0, 1180, 820, 1.6), (12.8, 1180, 820, 1.6),
                (13.6, 961, 541, 1.0), (26.4, 961, 541, 1.0), (27.4, 1160, 380, 1.42), (29.4, 1160, 380, 1.42),
                (30.6, 1440, 420, 1.35), (41.0, 1440, 420, 1.35), (42.0, 961, 541, 1.0), (54.0, 961, 541, 1.0),
                (55.0, 1000, 450, 1.42), (58.0, 1000, 450, 1.48)],
        captions=[(0.4, 20.5, 'A big, mechanical job? Let it run on Auto-approve.'),
                  (20.5, 29.6, 'It finds 59 type errors across 12 files.'),
                  (29.6, 50.3, 'Four sub-agents, four low-cost models, in parallel.'),
                  (50.3, None, counter('59 type errors → {}, under strict.', 59, 0))])
    ch4 = Chapter(
        take('4-settings'), '04 · Make it yours', None,
        pieces=[(0.4, 4.0, 3.2), (4.0, 10.6, 2.2), (10.6, 19.6, 1.6)],
        camera=[(0.4, 961, 541, 1.0), (3.8, 961, 541, 1.0), (4.6, 1250, 600, 1.18), (10.4, 1250, 600, 1.18),
                (11.2, 1150, 560, 1.08), (19.6, 1150, 560, 1.1)],
        captions=[(0.4, 10.6, '13 built-in MCP connectors, plus your own.'),
                  (10.6, None, 'Dark, Light or Hacker.')])
    return [Card(3.2, intro), ch1, Card(3.4, before_after), ch2, ch3, ch4, Card(4.6, outro)]


# ── Cues: what happens when, for the effects on the finished frame ────────
# Moments inside the takes (seconds of the take), by section index. Kinds:
# hit (an impact), reveal (a light sweep), tick (a click), whoosh, undo,
# agent (a sub-agent starts), theme (a theme switch).
TAKE_CUES = {
    1: [('approval', 18.6, 'tick'), ('allow', 21.0, 'tick'), ('check', 36.7, 'reveal')],
    3: [('model', 11.0, 'tick'), ('steer', 48.2, 'whoosh'), ('allow2', 54.25, 'tick'),
        ('p99', 59.6, 'hit'), ('undo', 66.8, 'undo')],
    4: [('auto', 12.35, 'tick'), ('baseline', 27.5, 'reveal'), ('agent1', 30.6, 'agent'),
        ('agent2', 30.95, 'agent'), ('agent3', 31.3, 'agent'), ('agent4', 31.65, 'agent'), ('zero', 50.3, 'hit')],
    5: [('mcp', 4.6, 'tick'), ('theme1', 12.16, 'theme'), ('theme2', 14.89, 'theme'), ('theme3', 17.64, 'theme')],
}
# Moments in the designed cards, in seconds from the card's start.
CARD_CUES = {
    0: [('logo', 0.05, 'swell'), ('title', 0.4, 'chime')],
    2: [('before', 0.15, 'hit'), ('after', 0.5, 'reveal')],
    6: [('url', 1.0, 'chime')],
}
SECTION_NAMES = ['intro', 'ch1', 'ba', 'ch2', 'ch3', 'ch4', 'outro']
# The sections with a beat, and how strong it is.
GROOVES = {'ch1': 'A', 'ch2': 'B', 'ch3': 'C', 'ch4': 'light'}
TARGET_BEAT = 60 / 108


def timeline(takes):
    """The sections, where each starts, how long it all is, and the cues."""
    sections = build(takes)
    starts, t = [], 0.0
    for i, sec in enumerate(sections):
        starts.append(t)
        t += sec.duration - (CROSSFADE if i < len(sections) - 1 else 0)
    total = t
    # A section is on screen from the middle of the crossfade that brings it in.
    shown = [0.0] + [st + CROSSFADE / 2 for st in starts[1:]]
    cues = []
    for i, name in enumerate(SECTION_NAMES):
        if i > 0:
            cues.append((name, shown[i], 'drop' if name == 'ba' else 'hit'))
        for cue, at, kind in TAKE_CUES.get(i, []):
            cues.append((cue, starts[i] + sections[i].to_out(at), kind))
        for cue, at, kind in CARD_CUES.get(i, []):
            cues.append((cue, starts[i] + at, kind))
    cues.sort(key=lambda c: c[1])
    # The beat: each groove section gets a whole number of bars, its first
    # downbeat where it appears and its last bar ending where the next one does.
    grid = []
    for i, name in enumerate(SECTION_NAMES):
        if name not in GROOVES:
            continue
        a, b = shown[i], shown[i + 1]
        bars = max(1, round((b - a) / (4 * TARGET_BEAT)))
        grid.append({'name': name, 'style': GROOVES[name], 'start': a, 'end': b,
                     'beat': (b - a) / (bars * 4), 'bars': bars})
    shown_sections = [(SECTION_NAMES[i], shown[i], shown[i + 1] if i + 1 < len(shown) else total)
                      for i in range(len(sections))]
    # Hits push the camera in, in the chapter they fall in.
    for name, at, kind in cues:
        if kind == 'hit':
            for i, sec in enumerate(sections):
                if isinstance(sec, Chapter) and starts[i] <= at < starts[i] + sec.duration:
                    sec.punches.append((at - starts[i], 1.0 if name in ('p99', 'zero') else 0.6))
    return sections, starts, total, {'cues': cues, 'grid': grid, 'sections': shown_sections, 'total': total}


# ── Effects on the finished frame ──────────────────────────────────────────
def _radial(cx, cy, r, color):
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    d = np.sqrt((x - s(cx)) ** 2 + (y - s(cy)) ** 2) / s(r)
    return (np.clip(1 - d, 0, 1) ** 2)[..., None] * np.array(color, np.float32)


BLOOM = _radial(960, 560, 1150, (150, 135, 255))
VIEW_MASK = np.zeros((H, W), np.float32)
VIEW_MASK[s(VIEW[1]):s(VIEW[1]) + s(VIEW[3]), s(VIEW[0]):s(VIEW[0]) + s(VIEW[2])] = np.asarray(MASK, np.float32) / 255
OUTSIDE = (1 - VIEW_MASK)[..., None]
BREATH = _radial(250, -80, 1100, (124, 108, 255)) * 0.35 * OUTSIDE
_YY, _XX = np.mgrid[0:H, 0:W].astype(np.float32)
SWEEP_AXIS = _XX + _YY * 0.45
TINTS = {'theme1': _radial(960, 560, 1150, (90, 255, 140)),
         'theme2': _radial(960, 560, 1150, (255, 255, 255)),
         'theme3': _radial(960, 560, 1150, (150, 135, 255))}
AGENT_CHIPS = [('GPT-6 Luna', 'src/billing'), ('Claude Haiku 5.5', 'src/auth'),
               ('DeepSeek V4.1 Flash', 'src/notify'), ('GLM 5.3 Flash', 'src/utils')]
_chips = {}


def chip(i):
    if i not in _chips:
        model, folder = AGENT_CHIPS[i]
        _chips[i] = pill(f'{model}  ·  {folder}', font(16, 'Semibold Text'), fill=(22, 23, 33, 235),
                         border=(165, 155, 255, 120), dot=GREEN)
    return _chips[i]


def effects(img, t, sheet):
    cues = sheet['cues']
    light = None

    def add(layer, alpha):
        nonlocal light
        if alpha > 0.003:
            light = layer * alpha if light is None else light + layer * alpha

    # The backdrop breathes with the bar.
    for g in ([] if STILL else sheet['grid']):
        if g['start'] <= t < g['end']:
            since = (t - g['start']) % (4 * g['beat'])
            add(BREATH, (0.55 if g['style'] != 'light' else 0.3) * math.exp(-since / 0.45))
    for name, at, kind in cues:
        d = t - at
        if d < 0 or d > 1.6:
            continue
        rise = min(1, d / 0.05)
        if kind == 'hit':
            strong = name in ('p99', 'zero', 'before')
            add(BLOOM, (0.20 if strong else 0.12) * rise * math.exp(-d / 0.35))
        elif kind == 'theme':
            add(TINTS[name], 0.10 * rise * math.exp(-d / 0.3))
        if name in ('check', 'after', 'baseline', 'p99', 'zero') and d < 0.9:
            # A soft band of light crossing the app.
            pos = (-300 + 2900 * ease(d / 0.9)) * K
            band = np.exp(-((SWEEP_AXIS - pos) / s(110)) ** 2) * VIEW_MASK
            add(band[..., None] * np.array([255, 255, 255], np.float32), 0.10)
    if light is not None:
        img = Image.fromarray(np.clip(np.asarray(img, np.float32) + light, 0, 255).astype(np.uint8))
    # The four sub-agents, named as they start.
    agents = [at for name, at, kind in cues if kind == 'agent']
    zero = next((at for name, at, kind in cues if name == 'zero'), None)
    if agents and zero and agents[0] - 0.1 <= t <= zero + 1.6:
        chips = [chip(i) for i in range(4)]
        gap = s(12)
        x = s(960) - (sum(c.width for c in chips) + gap * 3) // 2
        out = 1 - ease((t - (zero + 1.0)) / 0.5)
        for i, c in enumerate(chips):
            k = ease_out((t - agents[i]) / 0.35)
            if k > 0:
                over(img, c, (x, s(VIEW[1] + VIEW[3] - 70 + 14 * (1 - k))), k * out)
            x += c.width + gap
    return img


def main():
    takes, out = sys.argv[1], sys.argv[2]
    sections, starts, total, sheet = timeline(takes)
    if ONLY is not None:
        sections, starts = [sections[int(ONLY)]], [0.0]
        total = sections[0].duration
    print(f'{total:.1f}s: ' + ', '.join(f'{sec.duration:.1f}' for sec in sections), flush=True)

    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    enc = subprocess.Popen(
        ['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}',
         '-r', str(FPS), '-i', '-', '-c:v', 'libx264', '-preset', 'veryfast' if PREVIEW else 'slow',
         '-crf', '23' if PREVIEW else '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out],
        stdin=subprocess.PIPE)
    frames = int(math.ceil(total * FPS))
    first, last = frames * PART[0] // PART[1], frames * (PART[0] + 1) // PART[1]
    for n in range(first, last):
        t = n / FPS
        live = [(i, t - starts[i]) for i, sec in enumerate(sections) if -1e-9 <= t - starts[i] < sec.duration]
        imgs = []
        for i, local in live:
            imgs.append((i, sections[i].render(local), local))
        if len(imgs) == 1:
            img = imgs[0][1]
        else:
            # Crossfade: the later section fades in over the earlier one.
            (_, a, _), (j, b, local_b) = imgs[0], imgs[-1]
            img = Image.blend(a, b, ease(local_b / CROSSFADE))
        if ONLY is None:
            img = effects(img, t, sheet)
        enc.stdin.write(img.tobytes())
        if n % (FPS * 5) == 0:
            print(f'  {t:5.1f}s', flush=True)
    enc.stdin.close()
    enc.wait()
    print(f'wrote {out}')


if __name__ == '__main__':
    main()
