/**
 * Turns a topic into a scene-by-scene short-video script.
 */

const WORDS_PER_SECOND = 2.6; // typical TTS narration pace

const STYLES = {
  cinematic: 'cinematic photo, dramatic lighting, shallow depth of field, highly detailed',
  anime: 'anime illustration, vibrant colours, clean line art, studio quality',
  '3d': '3D render, soft global illumination, Pixar-like, highly detailed',
  comic: 'comic book art, bold ink outlines, halftone shading, dynamic composition',
  watercolor: 'watercolor painting, soft washes, textured paper',
  realistic: 'photorealistic, natural light, 35mm photography'
};

function targetSceneCount(durationSec) {
  return Math.max(3, Math.min(12, Math.round(durationSec / 5)));
}

function buildPrompt({ topic, durationSec, language, sceneCount }) {
  const words = Math.round(durationSec * WORDS_PER_SECOND);
  return [
    `Write a faceless vertical short video (YouTube Shorts / TikTok / Reels) about: "${topic}".`,
    `Language for narration, title, description and tags: ${language}.`,
    `Total narration about ${words} words, split into exactly ${sceneCount} scenes.`,
    'Scene 1 must be a strong hook in one sentence. The last scene ends with a short call to action to follow.',
    'Each scene has: "narration" (1-2 short spoken sentences) and "imagePrompt" (an English visual description of one still image for that scene, no text or words in the image).',
    'Respond with JSON only, shaped as:',
    '{"title": string (max 90 chars), "description": string, "tags": string[] (max 12), "scenes": [{"narration": string, "imagePrompt": string}]}'
  ].join('\n');
}

/** Validates and cleans model output. Throws on unusable input. */
function normalizeScript(raw, { topic } = {}) {
  const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!data || !Array.isArray(data.scenes)) throw new Error('Script has no scenes array');
  const scenes = data.scenes
    .map((s) => ({
      narration: String(s?.narration || '').trim(),
      imagePrompt: String(s?.imagePrompt || s?.image_prompt || '').trim()
    }))
    .filter((s) => s.narration);
  if (!scenes.length) throw new Error('Script has no narrated scenes');
  scenes.forEach((s) => {
    if (!s.imagePrompt) s.imagePrompt = s.narration;
  });
  const title = String(data.title || topic || 'Untitled short').trim().slice(0, 90);
  const tags = (Array.isArray(data.tags) ? data.tags : [])
    .map((t) => String(t).replace(/^#/, '').trim())
    .filter(Boolean)
    .slice(0, 12);
  return { title, description: String(data.description || '').trim(), tags, scenes };
}

/** Offline script used when no OpenAI key is configured (demo / tests). */
function placeholderScript({ topic, sceneCount }) {
  const lines = [
    `Here is something about ${topic} most people never notice.`,
    `It starts with a simple idea that changed everything.`,
    `Over time, people found new ways to use it.`,
    `Today it shapes how millions live and work.`,
    `And the next chapter is only beginning.`,
    `Follow for more stories like this.`
  ];
  const scenes = Array.from({ length: sceneCount }, (_, i) => {
    const narration = i === sceneCount - 1 ? lines[lines.length - 1] : lines[Math.min(i, lines.length - 2)];
    return { narration, imagePrompt: `${topic}, scene ${i + 1}` };
  });
  return normalizeScript({
    title: `${topic}`,
    description: `A short about ${topic}.`,
    tags: ['shorts', ...String(topic).toLowerCase().split(/\s+/).slice(0, 3)],
    scenes
  });
}

async function generateScript({ topic, durationSec = 40, language = 'English', openai, model }) {
  if (!topic || !String(topic).trim()) throw new Error('topic is required');
  const sceneCount = targetSceneCount(durationSec);
  if (!openai) return placeholderScript({ topic, sceneCount });

  const response = await openai.chat.completions.create({
    model: model || process.env.SHORTS_SCRIPT_MODEL || 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    temperature: 0.8,
    messages: [
      { role: 'system', content: 'You write viral, factual, fast-paced scripts for faceless short-form videos.' },
      { role: 'user', content: buildPrompt({ topic, durationSec, language, sceneCount }) }
    ]
  });
  return normalizeScript(response.choices[0].message.content, { topic });
}

module.exports = { generateScript, normalizeScript, placeholderScript, targetSceneCount, STYLES, WORDS_PER_SECOND };
