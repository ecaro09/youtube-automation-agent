/**
 * REST API for the Shorts studio. Mounted by index.js, or run standalone:
 *   npm run shorts:server   ->  http://localhost:3000/shorts.html
 */
const path = require('path');
const express = require('express');
const { ShortsPipeline } = require('./pipeline');
const { publishShort } = require('./publish');
const { VOICES } = require('./media');
const { STYLES } = require('./script');

function createShortsRouter({ pipeline = new ShortsPipeline(), getYouTubeAuth } = {}) {
  const router = express.Router();
  router.use(express.json());

  router.get('/api/shorts/options', (req, res) => {
    res.json({ voices: VOICES, styles: Object.keys(STYLES), offline: pipeline.offline, youtubeConnected: Boolean(safeAuth(getYouTubeAuth)) });
  });

  router.get('/api/shorts', async (req, res) => {
    res.json(await pipeline.listJobs());
  });

  router.post('/api/shorts', async (req, res) => {
    try {
      const job = await pipeline.createJob(req.body || {});
      pipeline.run(job); // background
      res.status(202).json(job);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.get('/api/shorts/:id', async (req, res) => {
    const job = await safeGet(pipeline, req.params.id);
    if (!job) return res.status(404).json({ error: 'Not found' });
    res.json(job);
  });

  router.get('/api/shorts/:id/files/:name', async (req, res) => {
    const job = await safeGet(pipeline, req.params.id);
    const name = req.params.name;
    if (!job || !/^[\w.-]+\.(mp4|png|mp3|srt)$/.test(name)) return res.status(404).end();
    res.sendFile(path.join(pipeline.jobDir(job.id), name));
  });

  router.post('/api/shorts/:id/scenes/:index', async (req, res) => {
    const job = await safeGet(pipeline, req.params.id);
    if (!job) return res.status(404).json({ error: 'Not found' });
    if (job.status === 'running') return res.status(409).json({ error: 'Job is still running' });
    const index = Number(req.params.index);
    if (!job.scenes[index]) return res.status(404).json({ error: 'Scene not found' });
    pipeline.regenerateScene(job.id, index, req.body || {}); // background
    res.status(202).json({ ok: true });
  });

  router.post('/api/shorts/:id/publish', async (req, res) => {
    const job = await safeGet(pipeline, req.params.id);
    if (!job) return res.status(404).json({ error: 'Not found' });
    try {
      const result = await publishShort(job, pipeline.jobDir(job.id), {
        auth: safeAuth(getYouTubeAuth),
        privacyStatus: req.body?.privacyStatus
      });
      await pipeline.update(job, { publish: result });
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  return router;
}

async function safeGet(pipeline, id) {
  try {
    return await pipeline.getJob(id);
  } catch {
    return null;
  }
}

function safeAuth(getYouTubeAuth) {
  try {
    return getYouTubeAuth ? getYouTubeAuth() : null;
  } catch {
    return null;
  }
}

async function startStandalone(port = process.env.PORT || 3000) {
  require('dotenv').config();
  const { CredentialManager } = require('../utils/credential-manager');
  const creds = new CredentialManager();
  await creds.initialize();
  const app = express();
  app.use(express.static(path.join(__dirname, '..', 'dashboard')));
  app.get('/', (req, res) => res.redirect('/shorts.html'));
  const pipeline = new ShortsPipeline();
  app.use(createShortsRouter({ pipeline, getYouTubeAuth: () => creds.getYouTubeAuth() }));
  app.listen(port, () => {
    console.log(`Shorts studio: http://localhost:${port}/shorts.html${pipeline.offline ? '  (offline mode: set OPENAI_API_KEY for real voice + images)' : ''}`);
  });
}

if (require.main === module) startStandalone();

module.exports = { createShortsRouter, startStandalone };
