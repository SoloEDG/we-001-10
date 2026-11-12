#!/usr/bin/env python3
"""Procedurally render the local sound library as WAV files.

Everything is synthesized offline from oscillators and deterministic noise so
the repository ships a working, royalty-free sound set with no network
dependency. Run from the repository root:

    python3 scripts/generate-audio.py

Files land in public/audio/ and are served verbatim by Vite/nginx.
"""
from __future__ import annotations

import math
import random
import struct
import wave
from pathlib import Path

SR = 44100
OUT = Path(__file__).resolve().parent.parent / "public" / "audio"
OUT.mkdir(parents=True, exist_ok=True)


def rms_norm(samples: list[float], peak: float = 0.92) -> list[float]:
    peak_value = max((abs(v) for v in samples), default=0.0)
    if peak_value == 0:
        return samples
    return [v * (peak / peak_value) for v in samples]


def fade(samples: list[float], attack: float = 0.004, release: float = 0.03) -> list[float]:
    n = len(samples)
    a = min(n, int(attack * SR))
    r = min(n, int(release * SR))
    for i in range(a):
        samples[i] *= i / a
    for i in range(r):
        samples[n - 1 - i] *= i / r
    return samples


def write(name: str, samples: list[float]) -> None:
    pcm = b"".join(
        struct.pack("<h", int(max(-1.0, min(1.0, v)) * 32767)) for v in samples
    )
    with wave.open(str(OUT / f"{name}.wav"), "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(SR)
        f.writeframes(pcm)


def noise(n: int, rng: random.Random) -> list[float]:
    return [rng.uniform(-1, 1) for _ in range(n)]


def lowpass(x: list[float], cutoff: float) -> list[float]:
    a = 1.0 - math.exp(-2.0 * math.pi * cutoff / SR)
    y = 0.0
    out = []
    for v in x:
        y += a * (v - y)
        out.append(y)
    return out


def highpass(x: list[float], cutoff: float) -> list[float]:
    lp = lowpass(x, cutoff)
    return [v - l for v, l in zip(x, lp)]


def tremolo(x: list[float], rate: float, depth: float) -> list[float]:
    return [
        v * (1.0 - depth + depth * (0.5 + 0.5 * math.sin(2 * math.pi * rate * i / SR)))
        for i, v in enumerate(x)
    ]


def exp_env(n: int, attack: float, tau: float) -> list[float]:
    a = max(1, int(attack * SR))
    return [
        (i / a) if i < a else math.exp(-(i - a) / (tau * SR)) for i in range(n)
    ]


def tone(freq: float, n: int, tau: float, attack: float = 0.01, harmonics=((1, 1.0),)) -> list[float]:
    env = exp_env(n, attack, tau)
    out = []
    for i in range(n):
        t = i / SR
        out.append(sum(amp * math.sin(2 * math.pi * freq * h * t) for h, amp in harmonics) * env[i])
    return out


def mix(*tracks: tuple[list[float], float]) -> list[float]:
    n = max(len(t) for t, _ in tracks)
    out = [0.0] * n
    for t, g in tracks:
        for i, v in enumerate(t):
            out[i] += v * g
    return out


def add(x: list[float], y: list[float], at: int, gain: float = 1.0) -> list[float]:
    n = max(len(x), at + len(y))
    out = x + [0.0] * (n - len(x))
    for i, v in enumerate(y):
        out[at + i] += v * gain
    return out


def thud(rng: random.Random, dur: float, cutoff: float, body: float) -> list[float]:
    n = int(dur * SR)
    raw = lowpass(noise(n, rng), cutoff)
    env = exp_env(n, 0.004, dur * 0.45)
    out = [raw[i] * env[i] * 0.8 for i in range(n)]
    t = tone(body, n, dur * 0.6, harmonics=((1, 1.0), (1.98, 0.28)))
    return mix((out, 1.0), (t, 0.55))


def step_plain(rng):
    return fade(rms_norm(thud(rng, 0.24, 1400, 115)), 0.03)


def step_forest(rng):
    n = int(0.34 * SR)
    crunch = highpass(noise(n, rng), 900)
    grains = [1.0] * n
    for _ in range(26):
        pos = rng.randrange(n)
        size = rng.randrange(40, 220)
        g = rng.uniform(0.25, 1.0)
        for i in range(min(size, n - pos)):
            grains[pos + i] *= 1.0 + g * math.exp(-i / (size * 0.35))
    crunch = [c * g for c, g in zip(crunch, grains)]
    crunch = lowpass(crunch, 6500)
    crunch = [c * e for c, e in zip(crunch, exp_env(n, 0.003, 0.13))]
    body = thud(rng, 0.2, 900, 95)
    return fade(rms_norm(add(crunch, body, 0, 0.35)), 0.03)


def step_water(rng):
    n = int(0.55 * SR)
    splash = highpass(noise(n, rng), 500)
    splash = lowpass(splash, 7500)
    e = exp_env(n, 0.02, 0.18)
    splash = [s * e for s, e in zip(splash, e)]
    wob = tone(240, n, 0.18, harmonics=((1, 0.5), (2.3, 0.2)))
    wob = tremolo(wob, 34, 0.7)
    return fade(rms_norm(mix((splash, 1.0), (wob, 0.32))), 0.04)


def step_ridge(rng):
    n = int(0.2 * SR)
    click = lowpass(highpass(noise(n, rng), 2200), 9000)
    click = [c * e for c, e in zip(click, exp_env(n, 0.001, 0.025))]
    stone = tone(390, n, 0.07, harmonics=((1, 0.7), (2.71, 0.3), (4.2, 0.12)))
    return fade(rms_norm(mix((click, 1.0), (stone, 0.5))), 0.01)


def step_wall(rng):
    n = int(0.42 * SR)
    rumble = lowpass(noise(n, rng), 280)
    rumble = [r * e for r, e in zip(rumble, exp_env(n, 0.004, 0.2))]
    debris = lowpass(highpass(noise(n, rng), 1600), 8000)
    debris = [d * e for d, e in zip(debris, exp_env(n, 0.002, 0.035))]
    return fade(rms_norm(mix((rumble, 1.0), (debris, 0.4))), 0.03)


def cast_guard(rng):
    n = int(0.8 * SR)
    ring = mix(
        (tone(196, n, 0.28, harmonics=((1, .65), (2.01, .3), (3.02, .16), (5.4, .07))), 1.0),
        (tone(294, n, 0.22, harmonics=((1, .5), (1.5, .2))), 0.5),
        (thud(rng, 0.2, 900, 70), 0.7),
    )
    return fade(rms_norm(ring), 0.01, 0.12)


def cast_ranger(rng):
    n = int(0.55 * SR)
    twang = []
    for i in range(n):
        t = i / SR
        env = math.exp(-t / 0.09)
        freq = 330 * (1.0 + 0.012 * math.exp(-t / 0.05))
        twang.append((math.sin(2 * math.pi * freq * t) + 0.45 * math.sin(4 * math.pi * freq * t)) * env)
    release = highpass(noise(n, rng), 1500)
    release = [r * math.exp(-i / (0.08 * SR)) for i, r in enumerate(release)]
    return fade(rms_norm(mix((twang, 1.0), (release, 0.28))), 0.005, 0.08)


def cast_mage(rng):
    n = int(1.05 * SR)
    shimmer = [0.0] * n
    for k, freq in enumerate((523.25, 659.25, 783.99, 1046.5)):
        at = int((0.04 + k * 0.05) * SR)
        shimmer = add(shimmer, tone(freq, n - at, 0.5, harmonics=((1, .6), (2.02, .2))), at, 0.45)
    air = highpass(noise(n, rng), 2400)
    air = [a * math.sin(math.pi * i / n) * 0.25 for i, a in enumerate(air)]
    return fade(rms_norm(mix((shimmer, 1.0), (air, 0.45))), 0.01, 0.16)


def cast_medic(rng):
    n = int(1.0 * SR)
    bell = mix(
        (tone(392.0, n, 0.45, harmonics=((1, .6), (2.4, .25), (3.8, .1))), 1.0),
        (tone(587.33, n, 0.35, harmonics=((1, .45), (2.01, .14))), 0.6),
    )
    air = lowpass(highpass(noise(n, rng), 3000), 9000)
    air = [a * math.exp(-i / (0.3 * SR)) * 0.1 for i, a in enumerate(air)]
    return fade(rms_norm(mix((bell, 1.0), (air, 1.0))), 0.012, 0.2)


def impact_metal(rng):
    n = int(0.3 * SR)
    clang = highpass(noise(n, rng), 2000)
    clang = [c * e for c, e in zip(clang, exp_env(n, 0.001, 0.02))]
    ring = tone(820, n, 0.07, harmonics=((1, .5), (2.83, .35), (4.1, .18), (6.7, .1)))
    return fade(rms_norm(mix((clang, 1.0), (ring, 0.7))), 0.004)


def impact_flesh(rng):
    n = int(0.24 * SR)
    slap = lowpass(noise(n, rng), 700)
    slap = [s * e for s, e in zip(slap, exp_env(n, 0.002, 0.045))]
    return fade(rms_norm(mix((slap, 1.0), (tone(75, n, 0.05), 0.5))), 0.004)


def heal(rng):
    n = int(0.9 * SR)
    out = [0.0] * n
    for k, freq in enumerate((659.25, 830.6, 987.77)):
        at = int(k * 0.06 * SR)
        out = add(out, tone(freq, n - at, 0.3, harmonics=((1, .6), (2.01, .2))), at, 0.42)
    return fade(rms_norm(out), 0.01, 0.15)


def status_burn(rng):
    n = int(0.7 * SR)
    crackle = highpass(noise(n, rng), 1100)
    grains = [0.15] * n
    for _ in range(34):
        pos = rng.randrange(n)
        size = rng.randrange(20, 120)
        g = rng.uniform(0.4, 1.0)
        for i in range(min(size, n - pos)):
            grains[pos + i] += g * math.exp(-i / (size * 0.3))
    crackle = [c * g for c, g in zip(crackle, grains)]
    crackle = lowpass(crackle, 8000)
    e = exp_env(n, 0.01, 0.18)
    crackle = [c * e for c, e in zip(crackle, e)]
    return fade(rms_norm(crackle), 0.01)


def status_slow(rng):
    n = int(0.9 * SR)
    out = []
    for i in range(n):
        t = i / SR
        freq = 420 * math.exp(-t / 0.55) + 110
        env = math.sin(math.pi * min(1.0, t / 0.75)) * 0.85
        out.append((math.sin(2 * math.pi * freq * t) + 0.3 * math.sin(4 * math.pi * freq * t)) * env)
    return fade(rms_norm(out), 0.02, 0.12)


def status_guard(rng):
    n = int(0.8 * SR)
    out = [0.0] * n
    for k, freq in enumerate((440, 554.37, 659.25)):
        at = int(k * 0.045 * SR)
        out = add(out, tone(freq, n - at, 0.28, harmonics=((1, .55), (2.0, .18))), at, 0.4)
    return fade(rms_norm(out), 0.01, 0.14)


def terrain_paint(rng):
    n = int(0.45 * SR)
    swoosh = lowpass(highpass(noise(n, rng), 350), 4200)
    e = exp_env(n, 0.08, 0.15)
    swoosh = [s * e for s, e in zip(swoosh, e)]
    return fade(rms_norm(swoosh), 0.03)


def turn(rng):
    n = int(0.9 * SR)
    out = [0.0] * n
    for k, freq in enumerate((392, 523.25)):
        at = int(k * 0.16 * SR)
        out = add(out, tone(freq, n - at, 0.3, harmonics=((1, .55), (2.01, .16))), at, 0.45)
    return fade(rms_norm(out), 0.01, 0.16)


def victory(rng):
    n = int(2.3 * SR)
    out = [0.0] * n
    for k, freq in enumerate((261.63, 329.63, 392.0, 523.25, 659.25)):
        at = int(k * 0.13 * SR)
        out = add(out, tone(freq, n - at, 0.55, harmonics=((1, .5), (2.0, .16))), at, 0.32)
    bass = tone(130.81, n, 0.8, harmonics=((1, .55), (2, .2)))
    return fade(rms_norm(mix((out, 1.0), (bass, 0.5))), 0.015, 0.5)


SOUNDS = {
    "step-plain": step_plain,
    "step-forest": step_forest,
    "step-water": step_water,
    "step-ridge": step_ridge,
    "step-wall": step_wall,
    "cast-guard": cast_guard,
    "cast-ranger": cast_ranger,
    "cast-mage": cast_mage,
    "cast-medic": cast_medic,
    "impact-metal": impact_metal,
    "impact-flesh": impact_flesh,
    "heal": heal,
    "status-burn": status_burn,
    "status-slow": status_slow,
    "status-guard": status_guard,
    "terrain-paint": terrain_paint,
    "turn": turn,
    "victory": victory,
}

for name, render in SOUNDS.items():
    rng = random.Random(f"ashen-crossing:{name}")
    samples = render(rng)
    write(name, samples)
    print(f"rendered {name}.wav ({len(samples) / SR:.2f}s)")
print(f"done: {len(SOUNDS)} files in {OUT}")
