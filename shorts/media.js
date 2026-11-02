/**
 * Voiceover and scene-image generation. Uses OpenAI when a client is given,
 * otherwise produces offline placeholders so the pipeline can run without keys.
 */
const fs = require('fs').promises;
const axios = require('axios');
const { ffmpeg, probeDuration } = require('./ffmpeg');
const { STYLES, WORDS_PER_SECOND } = require('./script');

const VOICES = ['alloy', 'ash', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer'];

async function synthesizeVoice(text, outPath, { openai, voice = 'onyx', speed = 1.05 } = {}) {
  if (openai) {
    const res = await openai.audio.speech.create({
      model: process.env.SHORTS_TTS_MODEL || 'tts-1-hd',
      voice: VOICES.includes(voice) ? voice : 'onyx',
      input: text,
      speed,
      response_format: 'mp3'
    });
    await fs.writeFile(outPath, Buffer.from(await res.arrayBuffer()));
  } else {
    // Silent track sized like real narration, so captions/timing still work.
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    const seconds = Math.max(1.5, words / WORDS_PER_SECOND).toFixed(2);
    await ffmpeg(['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', seconds, '-q:a', '9', '-acodec', 'libmp3lame', outPath]);
  }
  return { path: outPath, duration: await probeDuration(outPath) };
}

const PLACEHOLDER_COLOURS = [
  ['0x1e3a8a', '0x9333ea'],
  ['0x065f46', '0x0ea5e9'],
  ['0x7c2d12', '0xf59e0b'],
  ['0x831843', '0x6366f1'],
  ['0x111827', '0x14b8a6']
];

async function generateImage(prompt, outPath, { openai, style = 'cinematic', index = 0 } = {}) {
  if (openai) {
    const model = process.env.SHORTS_IMAGE_MODEL || 'gpt-image-1';
    const fullPrompt = `${prompt}. Style: ${STYLES[style] || style}. Vertical 9:16 composition. No text, letters, captions or watermarks.`;
    const params = { model, prompt: fullPrompt, n: 1 };
    params.size = model === 'dall-e-3' ? '1024x1792' : '1024x1536';
    const res = await openai.images.generate(params);
    const item = res.data[0];
    if (item.b64_json) {
      await fs.writeFile(outPath, Buffer.from(item.b64_json, 'base64'));
    } else {
      const img = await axios.get(item.url, { responseType: 'arraybuffer', timeout: 60000 });
      await fs.writeFile(outPath, Buffer.from(img.data));
    }
  } else {
    const [c0, c1] = PLACEHOLDER_COLOURS[index % PLACEHOLDER_COLOURS.length];
    await ffmpeg(['-f', 'lavfi', '-i', `gradients=s=1080x1920:c0=${c0}:c1=${c1}:x0=0:y0=0:x1=1080:y1=1920:d=1`, '-frames:v', '1', outPath]);
  }
  return outPath;
}

module.exports = { synthesizeVoice, generateImage, VOICES };
