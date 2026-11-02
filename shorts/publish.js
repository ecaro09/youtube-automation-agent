/**
 * Uploads a rendered short to YouTube using the repo's existing OAuth setup
 * (npm run credentials:setup).
 */
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

function buildMetadata(job, { privacyStatus } = {}) {
  const baseTitle = job.script?.title || job.options.topic;
  const title = /#shorts/i.test(baseTitle) ? baseTitle : `${baseTitle} #Shorts`.slice(0, 100);
  const tags = Array.from(new Set(['shorts', ...(job.script?.tags || [])])).slice(0, 15);
  const description = [job.script?.description || '', '', tags.map((t) => `#${t.replace(/\s+/g, '')}`).join(' ')].join('\n').trim();
  return {
    snippet: { title, description, tags, categoryId: '22' },
    status: {
      privacyStatus: privacyStatus || process.env.DEFAULT_PRIVACY_STATUS || 'private',
      selfDeclaredMadeForKids: false
    }
  };
}

async function publishShort(job, jobDir, { auth, privacyStatus } = {}) {
  if (!job.video?.file) throw new Error('Video has not been rendered yet');
  if (!auth) throw new Error('YouTube is not connected. Run: npm run credentials:setup');
  const youtube = google.youtube({ version: 'v3', auth });

  const res = await youtube.videos.insert({
    part: 'snippet,status',
    requestBody: buildMetadata(job, { privacyStatus }),
    media: { body: fs.createReadStream(path.join(jobDir, job.video.file)) }
  });
  const videoId = res.data.id;

  const srt = path.join(jobDir, 'captions.srt');
  if (fs.existsSync(srt)) {
    try {
      await youtube.captions.insert({
        part: 'snippet',
        requestBody: { snippet: { videoId, language: 'en', name: 'Captions', isDraft: false } },
        media: { body: fs.createReadStream(srt) }
      });
    } catch {
      // Caption upload is optional; the captions are already burned into the video.
    }
  }
  return { videoId, url: `https://youtube.com/shorts/${videoId}`, publishedAt: new Date().toISOString() };
}

module.exports = { publishShort, buildMetadata };
