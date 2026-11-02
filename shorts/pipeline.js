/**
 * Faceless Shorts pipeline:
 *   topic -> script -> per-scene voice + image -> captions -> 1080x1920 MP4
 *
 * Each job lives in output/shorts/<id>/ with a manifest.json describing it.
 */
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { generateScript, STYLES } = require('./script');
const { synthesizeVoice, generateImage, VOICES } = require('./media');
const { buildCaptionChunks, toASS, toSRT } = require('./captions');
const { renderShort } = require('./render');

const DEFAULT_OUTPUT_DIR = path.join(__dirname, '..', 'output', 'shorts');

function createOpenAIClient(apiKey = process.env.OPENAI_API_KEY) {
  if (!apiKey) return null;
  const OpenAI = require('openai');
  return new OpenAI({ apiKey });
}

class ShortsPipeline {
  /**
   * @param {object} [opts]
   * @param {object|null} [opts.openai]  OpenAI client; null = offline placeholders
   * @param {string} [opts.outputDir]
   */
  constructor({ openai, outputDir = DEFAULT_OUTPUT_DIR } = {}) {
    this.openai = openai === undefined ? createOpenAIClient() : openai;
    this.outputDir = outputDir;
    this.jobs = new Map();
  }

  get offline() {
    return !this.openai;
  }

  jobDir(id) {
    if (!/^[a-z0-9-]+$/i.test(id)) throw new Error('Invalid job id');
    return path.join(this.outputDir, id);
  }

  async saveManifest(job) {
    await fs.mkdir(this.jobDir(job.id), { recursive: true });
    await fs.writeFile(path.join(this.jobDir(job.id), 'manifest.json'), JSON.stringify(job, null, 2));
  }

  async getJob(id) {
    if (this.jobs.has(id)) return this.jobs.get(id);
    try {
      const job = JSON.parse(await fs.readFile(path.join(this.jobDir(id), 'manifest.json'), 'utf8'));
      this.jobs.set(id, job);
      return job;
    } catch {
      return null;
    }
  }

  async listJobs() {
    let ids = [];
    try {
      ids = await fs.readdir(this.outputDir);
    } catch {
      return [];
    }
    const jobs = await Promise.all(ids.map((id) => this.getJob(id).catch(() => null)));
    return jobs.filter(Boolean).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  /** Creates the job record and returns it immediately; call run(job) to process. */
  async createJob(input) {
    const options = {
      topic: String(input.topic || '').trim(),
      durationSec: Math.max(15, Math.min(90, Number(input.durationSec) || 40)),
      language: String(input.language || 'English'),
      voice: VOICES.includes(input.voice) ? input.voice : 'onyx',
      style: STYLES[input.style] ? input.style : 'cinematic',
      musicPath: input.musicPath || process.env.SHORTS_MUSIC_PATH || null
    };
    if (!options.topic) throw new Error('topic is required');
    const job = {
      id: `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
      createdAt: new Date().toISOString(),
      status: 'queued',
      step: 'queued',
      progress: 0,
      offline: this.offline,
      options,
      script: null,
      scenes: [],
      video: null,
      error: null,
      publish: null
    };
    this.jobs.set(job.id, job);
    await this.saveManifest(job);
    return job;
  }

  async update(job, patch) {
    Object.assign(job, patch);
    await this.saveManifest(job);
  }

  async run(job) {
    try {
      await this.update(job, { status: 'running', step: 'script', progress: 5 });
      const script = await generateScript({ ...job.options, openai: this.openai });
      job.script = { title: script.title, description: script.description, tags: script.tags };
      job.scenes = script.scenes.map((s, i) => ({ index: i, ...s, image: null, audio: null, duration: 0 }));
      await this.update(job, { progress: 15 });

      const n = job.scenes.length;
      for (const scene of job.scenes) {
        await this.update(job, { step: `scene ${scene.index + 1}/${n}` });
        await this.buildSceneAssets(job, scene, { voice: true, image: true });
        await this.update(job, { progress: 15 + Math.round((70 * (scene.index + 1)) / n) });
      }

      await this.update(job, { step: 'render', progress: 88 });
      await this.render(job);
      await this.update(job, { status: 'done', step: 'done', progress: 100 });
    } catch (err) {
      await this.update(job, { status: 'failed', error: err.message });
    }
    return job;
  }

  async buildSceneAssets(job, scene, { voice, image }) {
    const dir = this.jobDir(job.id);
    const tag = String(scene.index).padStart(2, '0');
    const stamp = Date.now().toString(36);
    if (voice) {
      const audioName = `scene_${tag}_${stamp}.mp3`;
      const res = await synthesizeVoice(scene.narration, path.join(dir, audioName), { openai: this.openai, voice: job.options.voice });
      scene.audio = audioName;
      scene.duration = res.duration;
    }
    if (image) {
      const imageName = `scene_${tag}_${stamp}.png`;
      await generateImage(scene.imagePrompt, path.join(dir, imageName), { openai: this.openai, style: job.options.style, index: scene.index });
      scene.image = imageName;
    }
  }

  async render(job) {
    const dir = this.jobDir(job.id);
    let t = 0;
    const timed = job.scenes.map((s) => {
      const out = { ...s, start: t };
      t += s.duration;
      return out;
    });
    await fs.writeFile(path.join(dir, 'captions.ass'), toASS(buildCaptionChunks(timed)));
    await fs.writeFile(path.join(dir, 'captions.srt'), toSRT(timed));
    await renderShort({
      workDir: dir,
      scenes: job.scenes.map((s) => ({ image: path.join(dir, s.image), audio: path.join(dir, s.audio), duration: s.duration })),
      outPath: path.join(dir, 'short.mp4'),
      musicPath: job.options.musicPath
    });
    job.video = { file: 'short.mp4', duration: Math.round(t * 10) / 10, renderedAt: new Date().toISOString() };
  }

  /**
   * Edit and/or regenerate one scene, then re-render the video.
   * @param {{narration?: string, imagePrompt?: string, regenerateImage?: boolean}} changes
   */
  async regenerateScene(id, index, changes = {}) {
    const job = await this.getJob(id);
    if (!job) throw new Error('Job not found');
    if (job.status === 'running') throw new Error('Job is still running');
    const scene = job.scenes[index];
    if (!scene) throw new Error('Scene not found');

    const narrationChanged = typeof changes.narration === 'string' && changes.narration.trim() && changes.narration.trim() !== scene.narration;
    const promptChanged = typeof changes.imagePrompt === 'string' && changes.imagePrompt.trim() && changes.imagePrompt.trim() !== scene.imagePrompt;
    if (narrationChanged) scene.narration = changes.narration.trim();
    if (promptChanged) scene.imagePrompt = changes.imagePrompt.trim();
    const redoImage = promptChanged || changes.regenerateImage !== false;

    await this.update(job, { status: 'running', step: `regenerating scene ${index + 1}`, progress: 50, error: null });
    try {
      await this.buildSceneAssets(job, scene, { voice: narrationChanged, image: redoImage });
      await this.update(job, { step: 'render', progress: 80 });
      await this.render(job);
      await this.update(job, { status: 'done', step: 'done', progress: 100 });
    } catch (err) {
      await this.update(job, { status: 'failed', error: err.message });
    }
    return job;
  }
}

module.exports = { ShortsPipeline, createOpenAIClient, DEFAULT_OUTPUT_DIR };
