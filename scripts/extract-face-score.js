#!/usr/bin/env node
/**
 * Extract the face-performance score from a Renoise .xrns project.
 *
 * Reads the melody track's note columns — pitch, velocity (volume column),
 * panning, note delay, and the unison/octave double in column 2 — plus the
 * melody instrument's LFO modulators (the sine pitch LFO is the violins'
 * vibrato), and writes src/timing/midnightSun.json for the lobby's singing
 * receptionist. Accents and downbeats are preserved from the existing file.
 *
 * Usage: node scripts/extract-face-score.js [path/to/song.xrns]
 */
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const XRNS = process.argv[2] ||
  '/home/bingster/renoise-web/home/My Songs/Midnight_Sun_Orchestra_Wall.xrns'
const OUT = path.join(__dirname, '..', 'src', 'timing', 'midnightSun.json')

// ---- minimal zip reader (stored or deflated entries) ----------------------
const readZipEntry = (buf, wanted) => {
  // walk backwards to the end-of-central-directory record
  let eocd = -1
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('not a zip')
  let off = buf.readUInt32LE(eocd + 16)
  const count = buf.readUInt16LE(eocd + 10)
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('bad central dir')
    const method = buf.readUInt16LE(off + 10)
    const csize = buf.readUInt32LE(off + 20)
    const nameLen = buf.readUInt16LE(off + 28)
    const extraLen = buf.readUInt16LE(off + 30)
    const commentLen = buf.readUInt16LE(off + 32)
    const local = buf.readUInt32LE(off + 42)
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen)
    if (name === wanted) {
      const lNameLen = buf.readUInt16LE(local + 26)
      const lExtraLen = buf.readUInt16LE(local + 28)
      const start = local + 30 + lNameLen + lExtraLen
      const raw = buf.subarray(start, start + csize)
      return method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw)
    }
    off += 46 + nameLen + extraLen + commentLen
  }
  throw new Error(wanted + ' not in zip')
}

const xml = readZipEntry(fs.readFileSync(XRNS), 'Song.xml').toString('utf8')

// ---- song globals ---------------------------------------------------------
const tag = (src, name) => {
  const m = src.match(new RegExp('<' + name + '>([^<]*)</' + name + '>'))
  return m ? m[1] : null
}
const bpm = parseFloat(tag(xml, 'BeatsPerMin'))
const lpb = parseInt(tag(xml, 'LinesPerBeat'), 10)
const lineDur = 60 / bpm / lpb

// ---- pattern sequence and pool -------------------------------------------
const seqSection = xml.match(/<PatternSequence>[\s\S]*?<\/PatternSequence>/)[0]
const sequence = [...seqSection.matchAll(/<Pattern>(\d+)<\/Pattern>/g)]
  .map((m) => parseInt(m[1], 10))
const poolSection = xml.match(/<PatternPool[\s\S]*?<\/PatternPool>/)[0]
const patterns = [...poolSection.matchAll(/<Pattern>[\s\S]*?<\/Pattern>(?=\s*(?:<Pattern>|<\/Patterns>))/g)]
  .map((m) => m[0])

// ---- melody notes: track 0, both note columns -----------------------------
const NOTE_RE = /^([A-G])(#?)-?(\d)$/
const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
const toMidi = (s) => {
  const m = s.match(NOTE_RE)
  if (!m) return null
  return SEMI[m[1]] + (m[2] ? 1 : 0) + parseInt(m[3], 10) * 12 // Renoise: C-4 = 48
}
const hex = (s, dflt) => (s == null ? dflt : parseInt(s, 16))

const events = [[], []] // per note column: {line, midi|'OFF', vel, pan, delay}
let lineBase = 0
for (const pi of sequence) {
  const pat = patterns[pi]
  const nLines = parseInt(tag(pat, 'NumberOfLines'), 10)
  const track0 = pat.match(/<PatternTrack[\s\S]*?<\/PatternTrack>/)[0]
  for (const lm of track0.matchAll(/<Line index="(\d+)">([\s\S]*?)<\/Line>/g)) {
    const line = lineBase + parseInt(lm[1], 10)
    const ncSection = lm[2].match(/<NoteColumns>([\s\S]*?)<\/NoteColumns>/)
    if (!ncSection) continue
    const cols = [...ncSection[1].matchAll(/<NoteColumn\s*\/>|<NoteColumn>([\s\S]*?)<\/NoteColumn>/g)]
    cols.forEach((cm, ci) => {
      if (ci > 1 || !cm[1]) return
      const note = tag(cm[1], 'Note')
      if (!note || note === '---') return
      events[ci].push({
        line,
        midi: note === 'OFF' ? 'OFF' : toMidi(note),
        vel: hex(tag(cm[1], 'Volume'), 0x80) / 0x80,
        pan: (hex(tag(cm[1], 'Panning'), 0x40) - 0x40) / 0x40,
        delay: hex(tag(cm[1], 'Delay'), 0) / 256,
      })
    })
  }
  lineBase += nLines
}
const totalLines = lineBase

// note-on list with durations (until the column's next event or song end)
const toNotes = (evs) => {
  const out = []
  for (let i = 0; i < evs.length; i++) {
    const e = evs[i]
    if (e.midi === 'OFF' || e.midi == null) continue
    const endLine = i + 1 < evs.length ? evs[i + 1].line : totalLines
    const start = (e.line + e.delay) * lineDur
    const dur = (endLine - e.line - e.delay) * lineDur
    out.push([
      +start.toFixed(3), +dur.toFixed(3), e.midi,
      +e.vel.toFixed(3), +e.pan.toFixed(2),
    ])
  }
  return out
}
const melody = toNotes(events[0])
const doubles = toNotes(events[1])

// ---- melody instrument vibrato (sine pitch LFO) ---------------------------
// The violins carry a Sin pitch LFO (vibrato) and a Random cutoff LFO
// (timbral shimmer); note their presence and normalized rates for the
// face module to interpret.
const lfos = [...xml.matchAll(/<SampleLfoModulationDevice[\s\S]*?<\/SampleLfoModulationDevice>/g)]
const findLfo = (target, mode) => lfos.find((m) =>
  m[0].includes('<Target>' + target + '</Target>') && m[0].includes('<Mode>' + mode + '</Mode>'))
const pitchLfo = findLfo('Pitch', 'Sin')
const cutoffLfo = findLfo('Cutoff', 'Random')
const lfoFreq = (m) => {
  if (!m) return null
  const f = m[0].match(/<Frequency>[\s\S]*?<Value>([\d.]+)<\/Value>/)
  return f ? parseFloat(f[1]) : null
}

const prev = JSON.parse(fs.readFileSync(OUT, 'utf8'))
const score = {
  song: prev.song,
  bpm,
  beatPeriod: +(60 / bpm).toFixed(5),
  duration: +(totalLines * lineDur).toFixed(3),
  accents: prev.accents,
  downbeats: prev.downbeats,
  melody,
  doubles,
  vibrato: {
    present: !!pitchLfo,
    rate: lfoFreq(pitchLfo),   // normalized Renoise LFO frequency
    shimmer: lfoFreq(cutoffLfo), // Random cutoff LFO, if any
  },
}
fs.writeFileSync(OUT, JSON.stringify(score))
console.log('wrote', OUT, 'melody:', melody.length, 'doubles:', doubles.length,
  'duration:', score.duration, 'vibrato:', JSON.stringify(score.vibrato))
