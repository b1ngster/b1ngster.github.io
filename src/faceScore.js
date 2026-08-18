/**
 * faceScore — turns a Renoise performance score into face channels.
 *
 * The score (see scripts/extract-face-score.js) carries what the tracker
 * actually recorded: per-note velocity from the volume column, stereo pan,
 * note-delay micro-timing, a second note column that doubles the melody
 * (71 of the doubles sit an octave below — chest notes), and the melody
 * instrument's modulators (a Sin pitch LFO = the violins' vibrato, and a
 * Random cutoff LFO = timbral shimmer). Each of those becomes a facial
 * gesture:
 *
 *   velocity        → how wide the mouth opens on that note
 *   legato gaps     → glide: no jaw re-attack, vowels crossfade
 *   pitch class     → vowel (vis_open "ah" / vis_spread "ee" / vis_pucker "oo")
 *   octave double   → chest voice: extra jaw, vowel rounds toward "ah"
 *   upward leaps    → a brow flick at the attack
 *   pitch LFO       → vibrato: jaw tremor on sustained notes after an onset
 *   cutoff LFO      → slow deterministic drift in the resting expression
 *   pan spread      → head lean, alternating per phrase
 *   phrase gaps     → breaths: lips close briefly, blinks land in the rests
 *   accents         → smile + raised brows (the groove's backbone)
 *
 * Pure data-in/data-out: no three.js, no randomness (noise is hashed from
 * time so replays are identical). The caller owns smoothing and bones.
 */

const VOWELS = ['vis_open', 'vis_spread', 'vis_pucker']

// deterministic value noise in [-1, 1] — same t, same wobble, every loop
const noise = (k) => {
  const s = Math.sin(k * 127.1 + 311.7) * 43758.5453
  return (s - Math.floor(s)) * 2 - 1
}
const smoothNoise = (t) => {
  const k = Math.floor(t)
  const f = t - k
  const u = f * f * (3 - 2 * f)
  return noise(k) * (1 - u) + noise(k + 1) * u
}

// short attack/decay pulse around each event time, like Scene's groove
const pulse = (times, t, width, sharpness) => {
  let env = 0
  for (const at of times) {
    const d = t - at
    if (d >= 0 && d < width) env = Math.max(env, Math.exp(-d * sharpness * 4))
    else if (d < 0 && d > -0.06) env = Math.max(env, 1 + d / 0.06)
  }
  return env
}

export const createSinger = (score) => {
  const melody = score.melody || []
  const doubles = score.doubles || []
  const duration = score.duration || 1
  const accents = score.accents || []

  // Renoise's LFO frequency sliders are normalized; map them into musical
  // ranges — the 0.507 pitch LFO lands on a 5.1Hz singer's vibrato.
  const vib = score.vibrato || {}
  const vibRate = vib.present ? 0.5 + (vib.rate || 0.5) * 9 : 0
  const shimmerRate = 0.3 + (vib.shimmer || 0.4) * 2

  // ---- precompute per-note articulation from the tracker columns ---------
  const vels = melody.map((n) => n[3] ?? 0.6)
  const vMin = Math.min(...vels)
  const vMax = Math.max(...vels)
  const vSpan = Math.max(1e-6, vMax - vMin)
  const notes = melody.map((n, i) => {
    const [start, dur, pitch] = n
    const prev = melody[i - 1]
    const gap = prev ? start - (prev[0] + prev[1]) : Infinity
    const dbl = doubles[i]
    return {
      start,
      dur,
      vowel: VOWELS[pitch % VOWELS.length],
      vel: (vels[i] - vMin) / vSpan, // 0..1 within the song's own dynamics
      legato: gap < 0.045, // butted against the previous note: glide, not attack
      leap: prev && prev[2] != null ? pitch - prev[2] : 0,
      chest: !!dbl && pitch - dbl[2] === 12, // octave-below double
      width: dbl ? Math.abs((n[4] ?? 0) - (dbl[4] ?? 0)) : 0, // stereo spread
    }
  })

  // ---- phrases: rests longer than a breath get breaths and blinks --------
  const breaths = []
  const blinks = []
  let phraseOfNote = new Array(notes.length).fill(0)
  let phrase = 0
  let lastBlink = -10
  for (let i = 1; i < notes.length; i++) {
    const gap = notes[i].start - (notes[i - 1].start + notes[i - 1].dur)
    if (gap > 0.45) {
      phrase++
      breaths.push(notes[i].start - Math.min(0.35, gap * 0.6))
      blinks.push(notes[i - 1].start + notes[i - 1].dur + gap * 0.4)
      lastBlink = blinks[blinks.length - 1]
    } else if (notes[i].start - lastBlink > 5.5) {
      blinks.push(notes[i].start + 0.05) // long phrase: blink on a note change
      lastBlink = notes[i].start
    }
    phraseOfNote[i] = phrase
  }

  // mutable performance state — one singer per character
  const st = { idx: 0, lastT: 0, vibPhase: 0, open: 0 }
  const out = {
    vis_open: 0, vis_spread: 0, vis_pucker: 0, vis_press: 0,
    exp_smile: 0, exp_soft: 0, exp_brows_up: 0, exp_blink: 0,
    jaw: 0, tilt: 0,
  }

  const sample = (elapsed, dt) => {
    const t = elapsed % duration
    if (t < st.lastT) st.idx = 0
    st.lastT = t
    while (
      st.idx < notes.length &&
      notes[st.idx].start + notes[st.idx].dur < t - 0.05
    ) st.idx++
    const n = notes[st.idx]
    const active = n && t >= n.start - 0.03 && t <= n.start + n.dur

    // ---- openness: velocity-scaled envelope; legato carries, never re-bites
    let open = 0
    if (active) {
      const attack = n.legato ? 1 : Math.min(1, (t - n.start + 0.03) / 0.06)
      const release = Math.min(1, Math.max(0, (n.start + n.dur - t) / 0.09))
      open = Math.min(1.05,
        attack * (0.35 + 0.65 * release) * (0.7 + 0.6 * n.vel))
    }

    // ---- vibrato: the violins' Sin pitch LFO, on held notes only ---------
    st.vibPhase += dt * vibRate * Math.PI * 2
    let vibr = 0
    if (active && vibRate && n.dur > 0.42) {
      const held = t - n.start
      const grow = Math.min(1, Math.max(0, (held - 0.26) / 0.3))
      vibr = Math.sin(st.vibPhase) * grow * (0.5 + 0.5 * n.vel)
    }

    // ---- the rest of the face ---------------------------------------------
    const accentEnv = pulse(accents, t, 0.55, 2.2)
    const browFlick = active && !n.legato && n.leap >= 5
      ? Math.max(0, 1 - (t - n.start) / 0.4) : 0
    const breathEnv = pulse(breaths, t, 0.3, 4)
    const shimmer = smoothNoise(t * shimmerRate)
    let blink = 0
    for (const bt of blinks) {
      const d = t - bt
      if (d >= 0 && d < 0.12) { blink = Math.sin((d / 0.12) * Math.PI); break }
    }

    const vowelGain = open * (1 + vibr * 0.08)
    out.vis_open = (n && n.vowel === 'vis_open' ? vowelGain : 0) +
      (active && n.chest ? open * 0.15 : 0)
    out.vis_spread = n && n.vowel === 'vis_spread' ? vowelGain * 0.9 : 0
    out.vis_pucker = n && n.vowel === 'vis_pucker' ? vowelGain * 0.9 : 0
    out.vis_press = breathEnv * 0.5 // lips together on the in-breath
    out.exp_soft = 0.35 + shimmer * 0.05 // resting warmth, drifting like the cutoff LFO
    out.exp_smile = accentEnv * 0.6
    out.exp_brows_up = Math.max(
      accentEnv > 0.85 ? (accentEnv - 0.85) * 3 : 0,
      browFlick * 0.35,
    )
    out.exp_blink = blink

    // chest notes drop the jaw further; vibrato rides on top
    out.jaw = Math.min(0.34,
      open * (n && n.chest ? 0.36 : 0.3) + vibr * 0.03 * open)

    // stereo spread leans the head, swapping sides each phrase
    const lean = n ? n.width * (phraseOfNote[st.idx] % 2 ? 1 : -1) : 0
    out.tilt = lean * 0.09 * (0.4 + 0.6 * open) + vibr * 0.008

    return out
  }

  return { sample, duration }
}
