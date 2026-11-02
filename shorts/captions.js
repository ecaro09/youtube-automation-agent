/**
 * Caption timing + ASS subtitle generation for vertical shorts.
 *
 * Timing is estimated per scene: each scene's narration is split into short
 * word groups, and the scene's measured audio duration is shared between the
 * groups in proportion to their character length. No speech-to-text needed.
 */

function splitWords(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean);
}

function chunkWords(words, maxWords) {
  const chunks = [];
  for (let i = 0; i < words.length; i += maxWords) {
    chunks.push(words.slice(i, i + maxWords).join(' '));
  }
  return chunks;
}

/**
 * @param {Array<{narration: string, start: number, duration: number}>} scenes
 * @param {{maxWords?: number}} [opts]
 * @returns {Array<{start: number, end: number, text: string}>}
 */
function buildCaptionChunks(scenes, { maxWords = 3 } = {}) {
  const out = [];
  for (const scene of scenes) {
    const chunks = chunkWords(splitWords(scene.narration), maxWords);
    if (!chunks.length || !(scene.duration > 0)) continue;
    const weights = chunks.map((c) => c.length + 1);
    const total = weights.reduce((a, b) => a + b, 0);
    let t = scene.start;
    chunks.forEach((text, i) => {
      const isLast = i === chunks.length - 1;
      const end = isLast ? scene.start + scene.duration : t + (scene.duration * weights[i]) / total;
      out.push({ start: round(t), end: round(end), text });
      t = end;
    });
  }
  return out;
}

function round(n) {
  return Math.round(n * 1000) / 1000;
}

function formatAssTime(seconds) {
  const cs = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  const pad = (n) => String(n).padStart(2, '0');
  return `${h}:${pad(m)}:${pad(s)}.${pad(c)}`;
}

function escapeAssText(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\r?\n/g, '\\N');
}

/**
 * Bold, centred, outlined captions sized for 1080x1920.
 */
function toASS(chunks, { width = 1080, height = 1920, fontName = 'DejaVu Sans', fontSize = 92, uppercase = true } = {}) {
  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // Colours are &HAABBGGRR. White text, black outline, alignment 5 = middle-centre.
    `Style: Caption,${fontName},${fontSize},&H00FFFFFF,&H0000FFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,7,3,5,80,80,0,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'
  ];
  const events = chunks.map((c) => {
    const text = escapeAssText(uppercase ? c.text.toUpperCase() : c.text);
    // Small pop-in: start at 80% scale, grow to 100% over 120ms.
    return `Dialogue: 0,${formatAssTime(c.start)},${formatAssTime(c.end)},Caption,,0,0,0,,{\\fscx80\\fscy80\\t(0,120,\\fscx100\\fscy100)}${text}`;
  });
  return [...header, ...events, ''].join('\n');
}

function formatSrtTime(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(r, 3)}`;
}

/** Sentence-level SRT (one entry per scene) for uploading to YouTube. */
function toSRT(scenes) {
  return scenes
    .filter((s) => s.duration > 0 && String(s.narration || '').trim())
    .map((s, i) => `${i + 1}\n${formatSrtTime(s.start)} --> ${formatSrtTime(s.start + s.duration)}\n${s.narration.trim()}\n`)
    .join('\n');
}

module.exports = { buildCaptionChunks, toASS, toSRT, formatAssTime, formatSrtTime, escapeAssText };
