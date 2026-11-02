#!/usr/bin/env node
/**
 * Generate a faceless short from the command line.
 *   npm run short -- --topic "Why octopuses have three hearts" --voice nova --style anime --duration 45
 */
require('dotenv').config();
const path = require('path');
const { ShortsPipeline } = require('./pipeline');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const m = argv[i].match(/^--([\w-]+)(?:=(.*))?$/);
    if (!m) continue;
    args[m[1]] = m[2] !== undefined ? m[2] : argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return args;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (!a.topic || a.help) {
    console.log('Usage: npm run short -- --topic "<topic>" [--duration 40] [--voice onyx] [--style cinematic] [--language English] [--music path.mp3]');
    process.exit(a.help ? 0 : 1);
  }
  const pipeline = new ShortsPipeline();
  if (pipeline.offline) console.log('No OPENAI_API_KEY set: running offline with placeholder script, silent voice and gradient images.');
  const job = await pipeline.createJob({
    topic: a.topic,
    durationSec: a.duration,
    voice: a.voice,
    style: a.style,
    language: a.language,
    musicPath: a.music
  });
  let last = '';
  const timer = setInterval(() => {
    const line = `[${job.progress}%] ${job.step}`;
    if (line !== last) console.log((last = line));
  }, 500);
  await pipeline.run(job);
  clearInterval(timer);
  if (job.status !== 'done') {
    console.error(`Failed: ${job.error}`);
    process.exit(1);
  }
  console.log(`Done: ${path.join(pipeline.jobDir(job.id), job.video.file)} (${job.video.duration}s)`);
  console.log(`Title: ${job.script.title}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
