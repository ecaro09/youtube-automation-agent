#!/usr/bin/env node
const { YouTubeAutomationAgent } = require('../index');

async function run() {
  const topic = process.argv[2] || null;
  const style = process.argv[3] || null;
  const length = process.argv[4] || 'medium';

  const app = new YouTubeAutomationAgent();
  const initialized = await app.initialize();

  if (!initialized) {
    throw new Error('Initialization failed. Run `npm run setup` and verify credentials.');
  }

  const result = await app.generateContent(topic, style, length);
  console.log('Daily content pipeline completed.');
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

run().catch((error) => {
  console.error('Workflow failed:', error.message);
  process.exit(1);
});
