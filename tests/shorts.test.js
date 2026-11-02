const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');

const { buildCaptionChunks, toASS, toSRT, formatAssTime, formatSrtTime } = require('../shorts/captions');
const { normalizeScript, targetSceneCount } = require('../shorts/script');
const { buildMetadata } = require('../shorts/publish');
const { ShortsPipeline } = require('../shorts/pipeline');
const { createShortsRouter } = require('../shorts/server');
const { probeDuration } = require('../shorts/ffmpeg');

test('caption chunks cover each scene exactly, in order', () => {
  const scenes = [
    { narration: 'one two three four five', start: 0, duration: 2 },
    { narration: 'six seven', start: 2, duration: 1.5 }
  ];
  const chunks = buildCaptionChunks(scenes, { maxWords: 3 });
  assert.deepStrictEqual(chunks.map((c) => c.text), ['one two three', 'four five', 'six seven']);
  assert.strictEqual(chunks[0].start, 0);
  assert.strictEqual(chunks[1].end, 2);
  assert.strictEqual(chunks[2].start, 2);
  assert.strictEqual(chunks[2].end, 3.5);
  for (let i = 1; i < chunks.length; i++) assert.ok(chunks[i].start >= chunks[i - 1].end - 1e-9);
});

test('caption chunks skip empty or zero-length scenes', () => {
  assert.deepStrictEqual(buildCaptionChunks([{ narration: '', start: 0, duration: 2 }, { narration: 'hi', start: 2, duration: 0 }]), []);
});

test('time formatting', () => {
  assert.strictEqual(formatAssTime(0), '0:00:00.00');
  assert.strictEqual(formatAssTime(61.239), '0:01:01.24');
  assert.strictEqual(formatAssTime(3725.5), '1:02:05.50');
  assert.strictEqual(formatSrtTime(3725.5), '01:02:05,500');
});

test('ASS output escapes braces and uppercases text', () => {
  const ass = toASS([{ start: 0, end: 1, text: 'hi {there}' }]);
  assert.match(ass, /PlayResX: 1080/);
  assert.match(ass, /Dialogue: 0,0:00:00\.00,0:00:01\.00,Caption,.*HI \\\{THERE\\\}$/m);
});

test('SRT has one entry per narrated scene', () => {
  const srt = toSRT([
    { narration: 'Hello world.', start: 0, duration: 1.2 },
    { narration: '  ', start: 1.2, duration: 1 }
  ]);
  assert.strictEqual(srt, '1\n00:00:00,000 --> 00:00:01,200\nHello world.\n');
});

test('normalizeScript cleans model output', () => {
  const s = normalizeScript(JSON.stringify({
    title: 'x'.repeat(120),
    tags: ['#shorts', '', 'facts'],
    scenes: [{ narration: ' Hook! ', image_prompt: 'a cat' }, { narration: '' }, { narration: 'End.' }]
  }));
  assert.strictEqual(s.title.length, 90);
  assert.deepStrictEqual(s.tags, ['shorts', 'facts']);
  assert.deepStrictEqual(s.scenes, [
    { narration: 'Hook!', imagePrompt: 'a cat' },
    { narration: 'End.', imagePrompt: 'End.' }
  ]);
  assert.throws(() => normalizeScript({ scenes: [] }), /no narrated scenes/);
  assert.throws(() => normalizeScript({}), /no scenes/);
});

test('scene count scales with duration within bounds', () => {
  assert.strictEqual(targetSceneCount(5), 3);
  assert.strictEqual(targetSceneCount(40), 8);
  assert.strictEqual(targetSceneCount(300), 12);
});

test('YouTube metadata adds #Shorts once', () => {
  const job = { options: { topic: 't' }, script: { title: 'Cool fact', description: 'd', tags: ['shorts', 'space'] } };
  const m = buildMetadata(job, { privacyStatus: 'unlisted' });
  assert.strictEqual(m.snippet.title, 'Cool fact #Shorts');
  assert.deepStrictEqual(m.snippet.tags, ['shorts', 'space']);
  assert.strictEqual(m.status.privacyStatus, 'unlisted');
  assert.strictEqual(buildMetadata({ ...job, script: { ...job.script, title: 'A #shorts' } }).snippet.title, 'A #shorts');
});

test('offline pipeline renders a 1080x1920 MP4 and regenerates a scene', { timeout: 240000 }, async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shorts-'));
  const pipeline = new ShortsPipeline({ openai: null, outputDir });
  const job = await pipeline.createJob({ topic: 'test topic', durationSec: 15 });
  await pipeline.run(job);
  assert.strictEqual(job.status, 'done', job.error);
  assert.strictEqual(job.scenes.length, 3);
  const video = path.join(pipeline.jobDir(job.id), 'short.mp4');
  const audioTotal = job.scenes.reduce((a, s) => a + s.duration, 0);
  assert.ok(Math.abs((await probeDuration(video)) - audioTotal) < 0.3);

  const oldImage = job.scenes[1].image;
  await pipeline.regenerateScene(job.id, 1, { narration: 'A brand new line for this scene here.' });
  assert.strictEqual(job.status, 'done', job.error);
  assert.notStrictEqual(job.scenes[1].image, oldImage);
  assert.strictEqual(job.scenes[1].narration, 'A brand new line for this scene here.');

  // Manifest reloads from disk in a fresh pipeline.
  const reloaded = await new ShortsPipeline({ openai: null, outputDir }).getJob(job.id);
  assert.strictEqual(reloaded.scenes[1].narration, 'A brand new line for this scene here.');
});

test('API validates input and rejects bad ids', async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shorts-api-'));
  const app = express();
  app.use(createShortsRouter({ pipeline: new ShortsPipeline({ openai: null, outputDir }) }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const opts = await (await fetch(`${base}/api/shorts/options`)).json();
    assert.ok(opts.voices.includes('onyx'));
    assert.strictEqual(opts.offline, true);
    assert.strictEqual(opts.youtubeConnected, false);

    const bad = await fetch(`${base}/api/shorts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.strictEqual(bad.status, 400);

    assert.strictEqual((await fetch(`${base}/api/shorts/..%2F..%2Fetc`)).status, 404);
    assert.strictEqual((await fetch(`${base}/api/shorts/nope/files/..%2Fmanifest.json`)).status, 404);
    assert.deepStrictEqual(await (await fetch(`${base}/api/shorts`)).json(), []);
  } finally {
    server.close();
  }
});
