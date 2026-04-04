// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3001',
    headless: true,
    ignoreHTTPSErrors: true,
    launchOptions: {
      args: ['--disable-web-security', '--autoplay-policy=no-user-gesture-required'],
    },
  },
  webServer: {
    command: 'node server.js',
    url: 'http://localhost:3001',
    reuseExistingServer: false,
    timeout: 15_000,
    env: {
      PORT: '3001',
      DB_PATH: '/tmp/coordinator-test.db',
    },
  },
  projects: [
    // Use system Chrome for H.264 codec support (headless Chromium lacks proprietary codecs)
    { name: 'chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome' } },
  ],
});
