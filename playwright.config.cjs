const { defineConfig, devices } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests/browser', fullyParallel: false, workers: 1, timeout: 20000,
  reporter: 'list', use: { baseURL: 'http://127.0.0.1:3107', headless: true, trace: 'retain-on-failure' },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'] } }, { name: 'mobile', use: { ...devices['Pixel 7'] } }],
  webServer: { command: 'node dist/server/index.js', url: 'http://127.0.0.1:3107/api/health', env: { PORT: '3107', APP_MODE: 'demo', SESSION_PERSISTENCE: 'false' }, reuseExistingServer: false },
});
