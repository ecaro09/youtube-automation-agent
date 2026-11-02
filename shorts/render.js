/**
 * FFmpeg assembly: Ken Burns clip per scene -> concatenated video ->
 * narration (+ optional background music) -> burned-in captions -> MP4.
 */
const fs = require('fs').promises;
const path = require('path');
const { ffmpeg } = require('./ffmpeg');

const FPS = 30;

function sceneFilter({ frames, width, height, index }) {
  // Upscale first so zoompan has pixels to work with (avoids jitter).
  const bigW = Math.round(width * 1.5);
  const bigH = Math.round(height * 1.5);
  const zoomIn = index % 2 === 0;
  const z = zoomIn ? `1+0.18*on/${frames}` : `1.18-0.18*on/${frames}`;
  return [
    `scale=${bigW}:${bigH}:force_original_aspect_ratio=increase`,
    `crop=${bigW}:${bigH}`,
    `zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${width}x${height}:fps=${FPS}`,
    'format=yuv420p'
  ].join(',');
}

async function renderSceneClip({ imagePath, duration, outPath, index, width, height }) {
  const frames = Math.max(1, Math.ceil(duration * FPS));
  await ffmpeg([
    '-i', imagePath,
    '-vf', sceneFilter({ frames, width, height, index }),
    '-frames:v', String(frames),
    '-r', String(FPS),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    outPath
  ]);
  return { path: outPath, frames };
}

async function writeConcatList(files, listPath) {
  const body = files.map((f) => `file '${path.resolve(f).replace(/'/g, "'\\''")}'`).join('\n');
  await fs.writeFile(listPath, body + '\n');
  return listPath;
}

/**
 * @param {object} p
 * @param {string} p.workDir   job directory (captions.ass must already be in it)
 * @param {Array<{image:string, audio:string, duration:number}>} p.scenes
 * @param {string} p.outPath
 * @param {string} [p.musicPath]
 * @param {number} [p.musicVolume]
 */
async function renderShort({ workDir, scenes, outPath, musicPath, musicVolume = 0.12, width = 1080, height = 1920, captionsFile = 'captions.ass' }) {
  const clipsDir = path.join(workDir, 'clips');
  await fs.mkdir(clipsDir, { recursive: true });

  const clips = [];
  for (let i = 0; i < scenes.length; i++) {
    const out = path.join(clipsDir, `clip_${String(i).padStart(2, '0')}.mp4`);
    await renderSceneClip({ imagePath: scenes[i].image, duration: scenes[i].duration, outPath: out, index: i, width, height });
    clips.push(out);
  }

  const videoList = await writeConcatList(clips, path.join(workDir, 'clips.txt'));
  const silentVideo = path.join(workDir, 'video_silent.mp4');
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', videoList, '-c', 'copy', silentVideo]);

  const audioList = await writeConcatList(scenes.map((s) => s.audio), path.join(workDir, 'audio.txt'));
  const narration = path.join(workDir, 'narration.m4a');
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', audioList, '-c:a', 'aac', '-b:a', '192k', narration]);

  const args = ['-i', silentVideo, '-i', narration];
  let audioMap = '1:a';
  const filters = [`[0:v]ass=${captionsFile}[v]`];
  if (musicPath) {
    args.push('-stream_loop', '-1', '-i', path.resolve(musicPath));
    filters.push(`[2:a]volume=${musicVolume}[bg];[1:a][bg]amix=inputs=2:duration=first:dropout_transition=0[a]`);
    audioMap = '[a]';
  }
  args.push(
    '-filter_complex', filters.join(';'),
    '-map', '[v]', '-map', audioMap,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k',
    '-shortest', '-movflags', '+faststart',
    path.resolve(outPath)
  );
  // cwd = workDir so the ass filter gets a plain relative filename (no escaping issues).
  await ffmpeg(args, { cwd: workDir });
  return outPath;
}

module.exports = { renderShort, renderSceneClip, sceneFilter, FPS };
