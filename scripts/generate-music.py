#!/usr/bin/env python3
"""
Generates the bundled Frame Studio music library.

Every track is synthesized from scratch with numpy (no samples, no external
downloads) and dedicated to the public domain under CC0 1.0. Run from the
project root:

    python3 scripts/generate-music.py

Outputs 16-bit WAVs to a temp folder, then converts them to AAC (.m4a) with
macOS `afconvert` into `public/music/`, and writes `manifest.json`.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import wave

import numpy as np

SR = 44100
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "public", "music")

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def midi_hz(n: float) -> float:
    return 440.0 * 2.0 ** ((n - 69.0) / 12.0)


def t_axis(n: int) -> np.ndarray:
    return np.arange(n, dtype=np.float64) / SR


def exp_env(n: int, attack: float, decay: float) -> np.ndarray:
    t = t_axis(n)
    a = np.clip(t / max(attack, 1e-4), 0.0, 1.0)
    return (a * np.exp(-t / max(decay, 1e-4))).astype(np.float32)


def fft_lowpass(x: np.ndarray, cutoff: float, order: int = 2) -> np.ndarray:
    if len(x) == 0:
        return x
    spec = np.fft.rfft(x)
    freqs = np.fft.rfftfreq(len(x), 1.0 / SR)
    return np.fft.irfft(spec / (1.0 + (freqs / max(cutoff, 1.0)) ** order), n=len(x)).astype(np.float32)


def fft_highpass(x: np.ndarray, cutoff: float, order: int = 2) -> np.ndarray:
    if len(x) == 0:
        return x
    spec = np.fft.rfft(x)
    freqs = np.fft.rfftfreq(len(x), 1.0 / SR)
    ratio = (freqs / max(cutoff, 1.0)) ** order
    return np.fft.irfft(spec * (ratio / (1.0 + ratio)), n=len(x)).astype(np.float32)


def add(buf: np.ndarray, sig: np.ndarray, start: float, gain: float = 1.0, pan: float = 0.0) -> None:
    """Mixes a mono signal into a stereo buffer at `start` seconds."""
    i = int(start * SR)
    if i >= len(buf) or len(sig) == 0:
        return
    n = min(len(sig), len(buf) - i)
    if n <= 0:
        return
    p = max(-1.0, min(1.0, pan))
    left = np.sqrt(0.5 * (1.0 - p))
    right = np.sqrt(0.5 * (1.0 + p))
    buf[i : i + n, 0] += sig[:n] * gain * left
    buf[i : i + n, 1] += sig[:n] * gain * right


def reverb(x: np.ndarray, mix: float = 0.18, decay: float = 0.42) -> np.ndarray:
    """Cheap feedback-delay ambience, mono in / mono out."""
    if len(x) == 0 or mix <= 0:
        return x
    out = x.copy()
    taps = [(0.031, 1.0), (0.047, 0.82), (0.071, 0.66), (0.097, 0.54), (0.131, 0.44)]
    for delay, g in taps:
        n = int(delay * SR)
        if n >= len(x):
            continue
        y = np.zeros_like(x)
        y[n:] = x[:-n] * (g * decay)
        out += y
    return (x * (1.0 - mix) + out * mix).astype(np.float32)


# ---------------------------------------------------------------------------
# Instruments
# ---------------------------------------------------------------------------


def pad(freq: float, dur: float, cutoff: float = 1600.0, wide: bool = True) -> np.ndarray:
    n = int(dur * SR)
    t = t_axis(n)
    sig = np.zeros(n)
    detunes = (-7.0, 0.0, 7.0) if wide else (0.0,)
    for cents in detunes:
        f = freq * 2.0 ** (cents / 1200.0)
        for h in range(1, 7):
            if f * h > SR * 0.45:
                break
            sig += np.sin(2.0 * np.pi * f * h * t + h * 0.6) / (h ** 1.7)
    env = np.minimum(1.0, t / 0.55) * np.minimum(1.0, np.maximum(0.0, (dur - t)) / 0.45)
    return (fft_lowpass(sig.astype(np.float32), cutoff) * env).astype(np.float32)


def electric_piano(freq: float, dur: float) -> np.ndarray:
    n = int(dur * SR)
    t = t_axis(n)
    mod = 1.6 * np.sin(2.0 * np.pi * freq * 2.0 * t) * np.exp(-t / 0.35)
    body = np.sin(2.0 * np.pi * freq * t + mod)
    body += 0.22 * np.sin(2.0 * np.pi * freq * 2.0 * t) * np.exp(-t / 0.5)
    body += 0.12 * np.sin(2.0 * np.pi * freq * 4.0 * t) * np.exp(-t / 0.25)
    return (body * exp_env(n, 0.006, 0.9)).astype(np.float32)


def pluck(freq: float, dur: float, bright: float = 1.0) -> np.ndarray:
    n = int(dur * SR)
    t = t_axis(n)
    sig = np.sin(2.0 * np.pi * freq * t)
    sig += 0.35 * bright * np.sin(2.0 * np.pi * freq * 2.0 * t)
    sig += 0.18 * bright * np.sin(2.0 * np.pi * freq * 3.0 * t)
    sig += 0.09 * bright * np.sin(2.0 * np.pi * freq * 5.0 * t)
    return (sig * exp_env(n, 0.004, 0.55)).astype(np.float32)


def soft_piano(freq: float, dur: float) -> np.ndarray:
    n = int(dur * SR)
    t = t_axis(n)
    sig = np.sin(2.0 * np.pi * freq * t) * np.exp(-t / 1.6)
    sig += 0.30 * np.sin(2.0 * np.pi * freq * 2.0 * t) * np.exp(-t / 0.9)
    sig += 0.10 * np.sin(2.0 * np.pi * freq * 3.0 * t) * np.exp(-t / 0.45)
    return (sig * exp_env(n, 0.008, 3.0)).astype(np.float32)


def bass(freq: float, dur: float) -> np.ndarray:
    n = int(dur * SR)
    t = t_axis(n)
    sig = np.sin(2.0 * np.pi * freq * t)
    sig += 0.22 * np.sin(2.0 * np.pi * freq * 2.0 * t)
    sig += 0.08 * np.sin(2.0 * np.pi * freq * 3.0 * t)
    return (fft_lowpass(sig.astype(np.float32), 420.0) * exp_env(n, 0.01, 0.55)).astype(np.float32)


def saw_stab(freq: float, dur: float) -> np.ndarray:
    n = int(dur * SR)
    t = t_axis(n)
    sig = np.zeros(n)
    for h in range(1, 9):
        if freq * h > SR * 0.45:
            break
        sig += np.sin(2.0 * np.pi * freq * h * t) / h
    return (fft_lowpass(sig.astype(np.float32), 2400.0) * exp_env(n, 0.005, 0.28)).astype(np.float32)


def kick(dur: float = 0.36) -> np.ndarray:
    n = int(dur * SR)
    t = t_axis(n)
    freq = np.linspace(135.0, 46.0, n)
    phase = 2.0 * np.pi * np.cumsum(freq) / SR
    body = np.sin(phase) * np.exp(-t / 0.12)
    click = np.sin(2.0 * np.pi * 1800.0 * t) * np.exp(-t / 0.006) * 0.25
    return (body + click).astype(np.float32)


def snare(dur: float = 0.22) -> np.ndarray:
    n = int(dur * SR)
    t = t_axis(n)
    rng = np.random.default_rng(7)
    noise = fft_highpass(rng.standard_normal(n).astype(np.float32), 1400.0)
    tone = 0.45 * np.sin(2.0 * np.pi * 185.0 * t)
    return ((noise * 0.8 + tone) * np.exp(-t / 0.075)).astype(np.float32)


def hat(dur: float = 0.07, open_hat: bool = False) -> np.ndarray:
    n = int(dur * SR)
    t = t_axis(n)
    rng = np.random.default_rng(11)
    noise = fft_highpass(rng.standard_normal(n).astype(np.float32), 6500.0, order=3)
    return (noise * np.exp(-t / (0.16 if open_hat else 0.03)) * 0.5).astype(np.float32)


def clap(dur: float = 0.18) -> np.ndarray:
    n = int(dur * SR)
    t = t_axis(n)
    rng = np.random.default_rng(23)
    noise = fft_highpass(rng.standard_normal(n).astype(np.float32), 900.0)
    flutter = np.zeros(n)
    for off in (0.0, 0.012, 0.024):
        i = int(off * SR)
        flutter[i:] += np.exp(-(t[: n - i]) / 0.035)
    return (noise * flutter * 0.5).astype(np.float32)


def noise_bed(dur: float, cutoff: float = 900.0, gain: float = 0.012) -> np.ndarray:
    n = int(dur * SR)
    rng = np.random.default_rng(5)
    noise = fft_lowpass(rng.standard_normal(n).astype(np.float32), cutoff, order=2)
    t = t_axis(n)
    swell = 0.6 + 0.4 * np.sin(2.0 * np.pi * t / max(dur, 0.1))
    return (noise * swell * gain).astype(np.float32)


def creak(dur: float = 0.9) -> np.ndarray:
    """A short metallic scrape for the horror bed."""
    n = int(dur * SR)
    t = t_axis(n)
    rng = np.random.default_rng(31)
    noise = fft_highpass(rng.standard_normal(n).astype(np.float32), 1100.0, order=2)
    wobble = 0.55 + 0.45 * np.sin(2.0 * np.pi * 6.5 * t)
    return (noise * exp_env(n, 0.02, 0.35) * wobble * 0.35).astype(np.float32)


def heartbeat() -> np.ndarray:
    """Two low thumps — the classic horror pulse."""
    n = int(0.55 * SR)
    out = np.zeros(n, dtype=np.float32)
    for offset, gain in ((0.0, 1.0), (0.22, 0.68)):
        i = int(offset * SR)
        m = n - i
        t = t_axis(m)
        thump = np.sin(2.0 * np.pi * 42.0 * t) * np.exp(-t / 0.11)
        thump += 0.4 * np.sin(2.0 * np.pi * 63.0 * t) * np.exp(-t / 0.07)
        out[i:] += (thump * gain).astype(np.float32)
    return out


# ---------------------------------------------------------------------------
# Track builders
# ---------------------------------------------------------------------------


def night_drive(bpm: float = 84.0, bars: int = 16) -> tuple[np.ndarray, float]:
    beat = 60.0 / bpm
    bar = beat * 4.0
    total = bar * bars
    buf = np.zeros((int(total * SR), 2), dtype=np.float32)

    chords = [
        [57, 60, 64, 67, 71],  # Am9
        [53, 57, 60, 64, 67],  # Fmaj9
        [48, 52, 55, 59],      # Cmaj7
        [55, 59, 62, 64],      # G6
    ]
    roots = [45, 41, 36, 43]
    bar_per_chord = bars // len(chords)

    for ci, (chord, root) in enumerate(zip(chords, roots)):
        start_bar = ci * bar_per_chord
        section = bar * bar_per_chord
        amp = 0.085
        for note in chord:
            add(buf, pad(midi_hz(note), section + 1.2, cutoff=1450.0), start_bar * bar, amp, pan=0.0)
        # Electric-piano comping on the "and" of 1 and 3.
        for b in range(bar_per_chord):
            t0 = (start_bar + b) * bar
            for offset, vel in ((0.0, 0.5), (2.0, 0.42)):
                for j, note in enumerate(chord[1:4]):
                    add(buf, electric_piano(midi_hz(note), 1.9), t0 + offset * beat, 0.09 * vel, pan=-0.25 + j * 0.25)
        # Bass pulse
        for b in range(bar_per_chord * 2):
            t0 = (start_bar * bar) + b * (bar / 2.0)
            note = root if b % 2 == 0 else root + 12
            add(buf, bass(midi_hz(note), beat * 1.1), t0, 0.24, pan=0.0)

    # Drums: soft lo-fi kit.
    for b in range(bars):
        t0 = b * bar
        add(buf, kick(), t0, 0.42)
        add(buf, kick(), t0 + 2.0 * beat, 0.34)
        add(buf, snare(), t0 + 1.0 * beat, 0.26, pan=0.06)
        add(buf, snare(), t0 + 3.0 * beat, 0.26, pan=0.06)
        for eighth in range(8):
            t1 = t0 + eighth * beat / 2.0
            add(buf, hat(open_hat=(eighth == 7)), t1, 0.10 if eighth % 2 == 0 else 0.07, pan=-0.15)

    add(buf, noise_bed(total, cutoff=700.0, gain=0.02), 0.0, 1.0)
    return buf, total


def sunrise(bpm: float = 100.0, bars: int = 16) -> tuple[np.ndarray, float]:
    beat = 60.0 / bpm
    bar = beat * 4.0
    total = bar * bars
    buf = np.zeros((int(total * SR), 2), dtype=np.float32)

    chords = [
        [48, 55, 64, 67, 72],  # C
        [55, 59, 62, 67, 71],  # G
        [57, 60, 64, 69, 72],  # Am
        [53, 57, 60, 65, 69],  # F
    ]
    roots = [36, 43, 45, 41]
    per = bars // len(chords)

    for ci, (chord, root) in enumerate(zip(chords, roots)):
        start_bar = ci * per
        section = bar * per
        for note in chord:
            add(buf, pad(midi_hz(note), section + 1.0, cutoff=2300.0), start_bar * bar, 0.065, pan=0.0)
        # 16th-note arpeggio, two octaves up.
        for b in range(per):
            t0 = (start_bar + b) * bar
            pattern = [0, 2, 1, 3, 2, 4, 3, 1]
            for s in range(16):
                note = chord[pattern[s % len(pattern)]] + 12
                add(buf, pluck(midi_hz(note), 0.5, bright=1.2), t0 + s * beat / 4.0, 0.055, pan=-0.3 + 0.6 * (s % 4) / 3.0)
        for b in range(per * 2):
            t0 = start_bar * bar + b * (bar / 2.0)
            add(buf, bass(midi_hz(root + (12 if b % 2 else 0)), beat), t0, 0.19)

    for b in range(bars):
        t0 = b * bar
        for q in range(4):
            add(buf, kick(), t0 + q * beat, 0.33)
        add(buf, clap(), t0 + beat, 0.24)
        add(buf, clap(), t0 + 3.0 * beat, 0.24)
        for eighth in range(8):
            add(buf, hat(open_hat=(eighth == 3 or eighth == 7)), t0 + eighth * beat / 2.0, 0.085, pan=0.2)

    return buf, total


def deep_focus(bpm: float = 60.0, bars: int = 8) -> tuple[np.ndarray, float]:
    beat = 60.0 / bpm
    bar = beat * 4.0
    total = bar * bars
    buf = np.zeros((int(total * SR), 2), dtype=np.float32)

    chords = [
        [50, 57, 62, 64, 69],  # Dm(add9)
        [46, 53, 58, 62, 65],  # Bb
        [41, 48, 53, 57, 60],  # F
        [48, 55, 60, 62, 67],  # C
    ]
    per = max(1, bars // len(chords))

    for ci, chord in enumerate(chords):
        start_bar = ci * per
        section = bar * per
        for note in chord:
            add(buf, pad(midi_hz(note), section + 2.0, cutoff=900.0), start_bar * bar, 0.085, pan=0.0)
        # Slow bell motif.
        for b in range(per):
            t0 = (start_bar + b) * bar
            note = chord[(b + 2) % len(chord)] + 12
            add(buf, electric_piano(midi_hz(note), 3.2), t0 + beat * 1.5, 0.055, pan=0.3)
            add(buf, electric_piano(midi_hz(note + 7), 3.0), t0 + beat * 3.25, 0.035, pan=-0.3)
        for b in range(per * 2):
            t0 = start_bar * bar + b * (bar / 2.0)
            add(buf, bass(midi_hz(chord[0] - 12), beat * 1.6), t0, 0.20)

    add(buf, noise_bed(total, cutoff=520.0, gain=0.03), 0.0, 1.0)
    return buf, total


def action_cuts(bpm: float = 128.0, bars: int = 16) -> tuple[np.ndarray, float]:
    beat = 60.0 / bpm
    bar = beat * 4.0
    total = bar * bars
    buf = np.zeros((int(total * SR), 2), dtype=np.float32)

    chords = [
        [52, 55, 59],  # Em
        [48, 52, 55],  # C
        [43, 47, 50],  # G
        [50, 54, 57],  # D
    ]
    roots = [40, 36, 31, 38]
    per = bars // len(chords)
    ostinato = [0, 0, 12, 0, 7, 0, 12, 7]

    for ci, (chord, root) in enumerate(zip(chords, roots)):
        start_bar = ci * per
        start_t = start_bar * bar
        section = bar * per
        # Staccato string pulse on every beat.
        for b in range(per * 4):
            t0 = start_t + b * beat
            for note in chord:
                add(buf, saw_stab(midi_hz(note), beat * 0.9), t0, 0.055, pan=0.0)
        # Driving 8th-note bass.
        for b in range(per * 8):
            t0 = start_t + b * beat / 2.0
            note = root + ostinato[b % len(ostinato)]
            add(buf, bass(midi_hz(note), beat * 0.55), t0, 0.22, pan=0.0)
        # High pulse for tension.
        for b in range(per * 4):
            t0 = start_t + b * beat + beat * 0.5
            add(buf, pluck(midi_hz(chord[2] + 24), 0.25, bright=1.0), t0, 0.035, pan=0.35)

    for b in range(bars):
        t0 = b * bar
        for q in range(4):
            add(buf, kick(), t0 + q * beat, 0.38)
        add(buf, snare(), t0 + beat, 0.28)
        add(buf, snare(), t0 + 3.0 * beat, 0.28)
        for s in range(16):
            add(buf, hat(), t0 + s * beat / 4.0, 0.07 if s % 4 else 0.11, pan=-0.2)

    return buf, total


def soft_keys(bpm: float = 72.0, bars: int = 8) -> tuple[np.ndarray, float]:
    beat = 60.0 / bpm
    bar = beat * 4.0
    total = bar * bars
    buf = np.zeros((int(total * SR), 2), dtype=np.float32)

    chords = [
        [53, 57, 60, 64],  # Fmaj7
        [50, 53, 57, 60],  # Dm7
        [46, 50, 53, 57],  # Bbmaj7
        [48, 52, 55, 59],  # Cmaj7
    ]
    melody = [72, 69, 65, 67, 72, 76, 74, 67]
    per = bars // len(chords)

    for ci, chord in enumerate(chords):
        start_bar = ci * per
        start_t = start_bar * bar
        section = bar * per
        for note in chord:
            add(buf, pad(midi_hz(note), section + 1.4, cutoff=1200.0), start_t, 0.07, pan=0.0)
        # Rolling piano arpeggio.
        for b in range(per):
            t0 = start_t + b * bar
            order = [0, 2, 1, 3, 2, 1, 3, 2]
            for eighth in range(8):
                note = chord[order[eighth]] + (12 if eighth % 4 == 2 else 0)
                add(buf, soft_piano(midi_hz(note), 2.4), t0 + eighth * beat / 2.0, 0.10, pan=-0.2 + 0.15 * (eighth % 3))
            add(buf, bass(midi_hz(chord[0] - 12), beat * 2.2), t0, 0.16)
        for b in range(per):
            t0 = start_t + b * bar
            note = melody[(ci * per + b) % len(melody)]
            add(buf, soft_piano(midi_hz(note), 2.8), t0 + beat * 1.5, 0.09, pan=0.25)

    for b in range(bars):
        t0 = b * bar
        for eighth in range(8):
            t1 = t0 + eighth * beat / 2.0
            add(buf, hat(), t1, 0.03 if eighth % 2 else 0.045, pan=0.25)

    return buf, total


def street_pulse(bpm: float = 88.0, bars: int = 16) -> tuple[np.ndarray, float]:
    beat = 60.0 / bpm
    bar = beat * 4.0
    total = bar * bars
    buf = np.zeros((int(total * SR), 2), dtype=np.float32)
    swing = 0.07 * beat

    chords = [
        [48, 51, 55, 58, 62],  # Cm9
        [44, 48, 51, 55],      # Abmaj7
        [41, 44, 48, 51, 55],  # Fm9
        [43, 47, 50, 53],      # G7
    ]
    roots = [36, 32, 29, 31]
    per = bars // len(chords)

    for ci, (chord, root) in enumerate(zip(chords, roots)):
        start_bar = ci * per
        start_t = start_bar * bar
        section = bar * per
        for note in chord:
            add(buf, pad(midi_hz(note), section + 1.0, cutoff=1300.0), start_t, 0.05, pan=0.0)
        for b in range(per):
            t0 = start_t + b * bar
            for offset, vel in ((0.0, 1.0), (2.5, 0.72)):
                for j, note in enumerate(chord[1:4]):
                    add(buf, electric_piano(midi_hz(note), 1.7), t0 + offset * beat, 0.075 * vel, pan=-0.25 + j * 0.25)
            add(buf, pluck(midi_hz(chord[(b + 2) % len(chord)] + 12), 0.9, bright=0.7), t0 + beat * 3.0, 0.045, pan=0.3)
            add(buf, bass(midi_hz(root), beat * 0.9), t0, 0.26)
            add(buf, bass(midi_hz(root + 7), beat * 0.5), t0 + beat * 2.5, 0.16)

    for b in range(bars):
        t0 = b * bar
        add(buf, kick(), t0, 0.46)
        add(buf, kick(), t0 + beat * 1.75, 0.34)
        add(buf, kick(), t0 + beat * 2.5, 0.28)
        add(buf, snare(), t0 + beat, 0.30, pan=0.06)
        add(buf, snare(), t0 + beat * 3.0, 0.32, pan=0.06)
        for eighth in range(8):
            t1 = t0 + eighth * beat / 2.0 + (swing if eighth % 2 else 0.0)
            add(buf, hat(open_hat=(eighth == 7)), t1, 0.085 if eighth % 2 == 0 else 0.055, pan=-0.2)

    add(buf, noise_bed(total, cutoff=800.0, gain=0.018), 0.0, 1.0)
    return buf, total


def bright_horizon(bpm: float = 110.0, bars: int = 16) -> tuple[np.ndarray, float]:
    beat = 60.0 / bpm
    bar = beat * 4.0
    total = bar * bars
    buf = np.zeros((int(total * SR), 2), dtype=np.float32)

    chords = [
        [50, 54, 57, 62],  # D
        [45, 49, 52, 57],  # A
        [47, 50, 54, 59],  # Bm
        [43, 47, 50, 55],  # G
    ]
    roots = [38, 45, 47, 43]
    melody = [74, 73, 71, 69, 74, 78, 76, 71]
    per = bars // len(chords)

    for ci, (chord, root) in enumerate(zip(chords, roots)):
        start_bar = ci * per
        start_t = start_bar * bar
        section = bar * per
        for note in chord:
            add(buf, pad(midi_hz(note), section + 1.0, cutoff=2500.0), start_t, 0.052, pan=0.0)
        for b in range(per):
            t0 = start_t + b * bar
            order = [0, 1, 2, 3, 2, 1, 3, 2]
            for eighth in range(8):
                note = chord[order[eighth]] + 12
                add(buf, pluck(midi_hz(note), 0.6, bright=1.1), t0 + eighth * beat / 2.0, 0.045, pan=-0.3 + 0.2 * (eighth % 3))
            for j, note in enumerate(chord):
                add(buf, electric_piano(midi_hz(note), 1.4), t0 + beat * (0.0 if j % 2 == 0 else 2.0), 0.05, pan=-0.15 + j * 0.1)
            add(buf, bass(midi_hz(root), beat * 1.4), t0, 0.19)
            add(buf, bass(midi_hz(root + 12), beat), t0 + beat * 2.0, 0.12)
            add(buf, soft_piano(midi_hz(melody[(ci * per + b) % len(melody)]), 2.0), t0 + beat * 1.5, 0.055, pan=0.25)

    for b in range(bars):
        t0 = b * bar
        for q in range(4):
            add(buf, kick(), t0 + q * beat, 0.30)
        add(buf, clap(), t0 + beat, 0.22)
        add(buf, clap(), t0 + 3.0 * beat, 0.22)
        for eighth in range(8):
            add(buf, hat(open_hat=(eighth == 7)), t0 + eighth * beat / 2.0, 0.06 if eighth % 2 else 0.04, pan=0.25)

    return buf, total


def hollow_hall(bpm: float = 50.0, bars: int = 8) -> tuple[np.ndarray, float]:
    beat = 60.0 / bpm
    bar = beat * 4.0
    total = bar * bars
    buf = np.zeros((int(total * SR), 2), dtype=np.float32)

    chords = [
        [38, 50, 53, 56],  # Dm cluster
        [34, 46, 50, 53],  # Bb
        [31, 43, 46, 50],  # Gm
        [33, 45, 48, 52],  # A
    ]
    per = bars // len(chords)

    for ci, chord in enumerate(chords):
        start_bar = ci * per
        start_t = start_bar * bar
        section = bar * per
        for note in chord:
            add(buf, pad(midi_hz(note), section + 2.6, cutoff=650.0), start_t, 0.085, pan=0.0)
        add(buf, pad(midi_hz(chord[0] - 12), section + 2.6, cutoff=320.0), start_t, 0.13, pan=0.0)
        add(buf, pad(midi_hz(chord[2] + 7), section + 1.2, cutoff=1500.0), start_t, 0.028, pan=0.35)

    for b in range(bars):
        t0 = b * bar
        add(buf, heartbeat(), t0, 0.55)
        add(buf, heartbeat(), t0 + beat * 2.4, 0.34)
        if b % 3 == 1:
            add(buf, creak(1.3), t0 + beat * 1.2, 0.45, pan=-0.45)
        if b % 4 == 2:
            add(buf, creak(0.8), t0 + beat * 3.1, 0.32, pan=0.5)
        if b % 2 == 0:
            note = 62 + (b % 3) * 2
            add(buf, electric_piano(midi_hz(note), 3.6), t0 + beat * 1.5, 0.045, pan=0.25)

    add(buf, noise_bed(total, cutoff=420.0, gain=0.035), 0.0, 1.0)
    return buf, total


def neon_arcade(bpm: float = 118.0, bars: int = 16) -> tuple[np.ndarray, float]:
    beat = 60.0 / bpm
    bar = beat * 4.0
    total = bar * bars
    buf = np.zeros((int(total * SR), 2), dtype=np.float32)

    chords = [
        [57, 60, 64, 69],  # Am
        [53, 57, 60, 65],  # F
        [48, 52, 55, 60],  # C
        [55, 59, 62, 67],  # G
    ]
    roots = [33, 29, 36, 31]
    per = bars // len(chords)

    for ci, (chord, root) in enumerate(zip(chords, roots)):
        start_bar = ci * per
        start_t = start_bar * bar
        section = bar * per
        for note in chord:
            add(buf, pad(midi_hz(note), section + 0.8, cutoff=2600.0), start_t, 0.048, pan=0.0)
        for b in range(per):
            t0 = start_t + b * bar
            # Analog 8th-note bass.
            pattern = [0, 0, 12, 0, 7, 0, 12, 7]
            for eighth in range(8):
                note = root + pattern[eighth]
                add(buf, saw_stab(midi_hz(note), beat * 0.5), t0 + eighth * beat / 2.0, 0.13, pan=0.0)
            # 16th-note arpeggio.
            arp = [0, 2, 1, 3, 2, 1, 3, 2]
            for sixteenth in range(16):
                note = chord[arp[sixteenth % len(arp)]] + 12
                add(buf, pluck(midi_hz(note), 0.32, bright=1.4), t0 + sixteenth * beat / 4.0, 0.035, pan=-0.25 + 0.4 * (sixteenth % 4) / 3.0)
            # Lead motif.
            lead = [chord[3] + 12, chord[2] + 12, chord[1] + 12, chord[3] + 12]
            add(buf, saw_stab(midi_hz(lead[b % len(lead)]), beat * 0.9), t0 + beat * 3.0, 0.055, pan=0.3)

    for b in range(bars):
        t0 = b * bar
        for q in range(4):
            add(buf, kick(), t0 + q * beat, 0.36)
        add(buf, snare(), t0 + beat, 0.30)
        add(buf, snare(), t0 + 3.0 * beat, 0.30)
        for eighth in range(8):
            add(buf, hat(open_hat=(eighth == 7)), t0 + eighth * beat / 2.0, 0.055 if eighth % 2 else 0.035, pan=0.2)

    return buf, total


# ---------------------------------------------------------------------------
# Rendering / encoding
# ---------------------------------------------------------------------------

TRACKS = [
    {
        "id": "night-drive",
        "title": "Night Drive",
        "artist": "Frame Studio Originals",
        "file": "night-drive.m4a",
        "bpm": 84,
        "mood": ["Chill", "Lo-fi"],
        "build": night_drive,
    },
    {
        "id": "sunrise",
        "title": "Sunrise",
        "artist": "Frame Studio Originals",
        "file": "sunrise.m4a",
        "bpm": 100,
        "mood": ["Upbeat", "Uplifting"],
        "build": sunrise,
    },
    {
        "id": "deep-focus",
        "title": "Deep Focus",
        "artist": "Frame Studio Originals",
        "file": "deep-focus.m4a",
        "bpm": 60,
        "mood": ["Ambient", "Calm"],
        "build": deep_focus,
    },
    {
        "id": "action-cuts",
        "title": "Action Cuts",
        "artist": "Frame Studio Originals",
        "file": "action-cuts.m4a",
        "bpm": 128,
        "mood": ["Cinematic", "Tense"],
        "build": action_cuts,
    },
    {
        "id": "soft-keys",
        "title": "Soft Keys",
        "artist": "Frame Studio Originals",
        "file": "soft-keys.m4a",
        "bpm": 72,
        "mood": ["Gentle", "Piano"],
        "build": soft_keys,
    },
    {
        "id": "street-pulse",
        "title": "Street Pulse",
        "artist": "Frame Studio Originals",
        "file": "street-pulse.m4a",
        "bpm": 88,
        "mood": ["Hip-hop", "Boom-bap"],
        "build": street_pulse,
    },
    {
        "id": "bright-horizon",
        "title": "Bright Horizon",
        "artist": "Frame Studio Originals",
        "file": "bright-horizon.m4a",
        "bpm": 110,
        "mood": ["Corporate", "Inspiring"],
        "build": bright_horizon,
    },
    {
        "id": "hollow-hall",
        "title": "Hollow Hall",
        "artist": "Frame Studio Originals",
        "file": "hollow-hall.m4a",
        "bpm": 50,
        "mood": ["Horror", "Suspense"],
        "build": hollow_hall,
    },
    {
        "id": "neon-arcade",
        "title": "Neon Arcade",
        "artist": "Frame Studio Originals",
        "file": "neon-arcade.m4a",
        "bpm": 118,
        "mood": ["Retro", "Synthwave"],
        "build": neon_arcade,
    },
]


def finish(buf: np.ndarray) -> np.ndarray:
    # Gentle bus compression + soft clip, then peak-normalize to -1 dBFS.
    wet = np.stack([reverb(buf[:, 0], 0.16, 0.4), reverb(buf[:, 1], 0.16, 0.4)], axis=1)
    stereo = buf * 0.74 + wet * 0.26
    stereo = np.tanh(stereo * 1.15)
    peak = float(np.max(np.abs(stereo))) or 1.0
    stereo *= 0.891 / peak
    # Click-free loop edges.
    fade = int(0.012 * SR)
    if len(stereo) > fade * 2:
        ramp = np.linspace(0.0, 1.0, fade, dtype=np.float32)[:, None]
        stereo[:fade] *= ramp
        stereo[-fade:] *= ramp[::-1]
    return stereo.astype(np.float32)


def write_wav(path: str, stereo: np.ndarray) -> None:
    pcm = np.clip(stereo * 32767.0, -32768, 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def encode(src: str, dst: str) -> None:
    subprocess.run(
        ["afconvert", src, dst, "-f", "m4af", "-d", "aac", "-b", "128000"],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix="frame-music-")
    manifest = {
        "version": 1,
        "license": "CC0-1.0",
        "licenseUrl": "https://creativecommons.org/publicdomain/zero/1.0/",
        "attribution": "Frame Studio Originals — original synthesis, dedicated to the public domain.",
        "tracks": [],
    }
    try:
        for spec in TRACKS:
            buf, duration = spec["build"]()
            stereo = finish(buf)
            wav = os.path.join(tmp, spec["id"] + ".wav")
            write_wav(wav, stereo)
            dst = os.path.join(OUT_DIR, spec["file"])
            encode(wav, dst)
            rms = float(np.sqrt(np.mean(stereo.astype(np.float64) ** 2)))
            print(f"{spec['title']:<12} {duration:6.2f}s  peak={np.max(np.abs(stereo)):.2f}  rms={rms:.3f}  {os.path.getsize(dst)//1024} KB")
            manifest["tracks"].append(
                {
                    "id": spec["id"],
                    "title": spec["title"],
                    "artist": spec["artist"],
                    "file": spec["file"],
                    "duration": round(float(duration), 2),
                    "bpm": spec["bpm"],
                    "mood": spec["mood"],
                    "license": "CC0-1.0",
                    "source": "Original synthesis",
                }
            )
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    with open(os.path.join(OUT_DIR, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
        f.write("\n")
    src_manifest = os.path.join(ROOT, "src", "features", "video", "musicLibrary.json")
    with open(src_manifest, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
        f.write("\n")
    print(f"Wrote {len(manifest['tracks'])} tracks to public/music/")


if __name__ == "__main__":
    main()
