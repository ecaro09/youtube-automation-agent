#!/usr/bin/env node
const { YouTubeAutomationAgent } = require('../index');

async function run() {
  const app = new YouTubeAutomationAgent();
  const initialized = await app.initialize();

  if (!initialized) {
    throw new Error('Initialization failed. Run `npm run setup` and verify credentials.');
  }

  const report = await app.agents.analytics.generateWeeklyReport();
  console.log('Weekly strategy review completed.');
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

run().catch((error) => {
  console.error('Workflow failed:', error.message);
  process.exit(1);
});
