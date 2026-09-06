import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  testMatch: '**/*.browser.ts',
  workers: 1,
  timeout: 45_000,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4177/bumm/',
    launchOptions: {
      args: ['--mute-audio'],
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
    },
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'laptop', use: { viewport: { width: 1280, height: 680 } } },
    { name: 'phone', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL ? undefined : {
    command: 'bun run build && ./node_modules/.bin/vite preview --host 127.0.0.1 --port 4177 --strictPort',
    url: 'http://127.0.0.1:4177/bumm/',
    reuseExistingServer: false,
  },
});
