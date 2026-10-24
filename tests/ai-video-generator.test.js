const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { AIVideoGenerator } = require('../utils/ai-video-generator');

const scriptsDir = path.join(__dirname, '..', 'data', 'scripts');
const generator = new AIVideoGenerator({});

function loadScript(id) {
  return JSON.parse(fs.readFileSync(path.join(scriptsDir, `${id}_script.json`), 'utf8'));
}

function narrationSeconds(id) {
  const tts = fs.readFileSync(path.join(scriptsDir, `${id}_script_tts.txt`), 'utf8');
  const words = tts.split(/\s+/).filter(Boolean).length;
  return (words / 150) * 60;
}

test('slideshow is long enough to hold the whole narration', () => {
  for (const id of ['1755090595569', '1755091093395']) {
    const duration = generator.calculateScriptDuration(loadScript(id));
    // ffmpeg -shortest cuts the voiceover at the end of the visuals, so the
    // visuals must cover the narrated text (TTS adds section headings, allow 15%).
    assert.ok(
      duration >= narrationSeconds(id) * 0.85,
      `${id}: video ${duration}s shorter than narration ${Math.round(narrationSeconds(id))}s`
    );
  }
});

test('sections with array content show their lines on screen', () => {
  const script = loadScript('1755091093395');
  const deepDive = script.mainContent.sections.find(s => Array.isArray(s.content));
  const html = generator.formatSectionContent(deepDive);
  assert.ok(!html.includes('Content coming soon'), html);
  assert.ok(html.includes(deepDive.content[0]), html);
  assert.ok(!html.includes('[Detailed explanation'), 'stage directions must not be shown');
});

test('slides advance per scene, not every frame', () => {
  const script = loadScript('1755091093395');
  const fps = 30;
  const duration = generator.calculateScriptDuration(script);
  const changes = generator.getSlideChangeFrames(script, duration * fps);
  // title + 6 sections + subscribe = 8 slides -> 7 changes
  assert.strictEqual(changes.length, script.mainContent.sections.length + 1);
  for (let i = 1; i < changes.length; i++) {
    assert.ok(changes[i] - changes[i - 1] >= fps, 'each scene should last at least 1s');
  }
});
