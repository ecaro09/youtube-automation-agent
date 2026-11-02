const { execFile } = require('child_process');

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';

function run(bin, args, { timeoutMs = 10 * 60 * 1000, cwd } = {}) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs, cwd }, (err, stdout, stderr) => {
      if (err) {
        const tail = String(stderr || '').split('\n').slice(-15).join('\n');
        err.message = `${bin} failed: ${err.message}\n${tail}`;
        return reject(err);
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

function ffmpeg(args, opts) {
  return run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], opts);
}

async function probeDuration(file) {
  const { stdout } = await run(FFPROBE, [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    file
  ]);
  const value = parseFloat(stdout.trim());
  if (!Number.isFinite(value)) throw new Error(`Could not read duration of ${file}`);
  return value;
}

module.exports = { ffmpeg, probeDuration };
