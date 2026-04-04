// @ts-check
const { test, expect } = require('@playwright/test');

// Spec §0 exit criteria:
// 1. No SecurityError in log
// 2. Luminance and diff values are logged correctly
// 3. No false alert on startup (normal video content)
// 4. Cover ratio spikes above 50% at ~27:53

const COVER_TIMESTAMP_S = 27 * 60 + 53; // 1673s
const CHECK_INTERVAL_MS = 5_000;

test.describe('POC – Frame Detection', () => {
  test.beforeEach(async ({ page }) => {
    // Expose console errors to help debug
    page.on('pageerror', err => console.error('Page error:', err.message));

    await page.goto('/poc');

    // Wait for the video to be ready — log entry confirms it
    await expect(page.locator('#log')).toContainText('Video loaded', {
      timeout: 60_000,
    });
  });

  test('no SecurityError on canvas read', async ({ page }) => {
    // Wait for at least one frame check
    await page.waitForTimeout(CHECK_INTERVAL_MS + 1_000);
    const logText = await page.locator('#log').textContent();
    expect(logText).not.toContain('SecurityError');
  });

  test('logs luminance and diff values on each check', async ({ page }) => {
    // Wait for at least one check cycle
    await page.waitForTimeout(CHECK_INTERVAL_MS + 1_000);
    const logText = await page.locator('#log').textContent();

    // Should contain a numbered check entry with luma and diff
    expect(logText).toMatch(/#\d+ readyState=/);
    expect(logText).toMatch(/luma=\d+\.\d/);
    expect(logText).toMatch(/diff=/);
    expect(logText).toMatch(/frozen=\d+\.\d+s/);
    expect(logText).toMatch(/coverRatio=\d+\.\d+%/);
  });

  test('luminance is above black-frame threshold on normal content', async ({ page }) => {
    await page.waitForTimeout(CHECK_INTERVAL_MS + 1_000);
    const logText = await page.locator('#log').textContent();

    // Extract the first luma= value
    const match = logText.match(/luma=(\d+\.\d)/);
    expect(match).not.toBeNull();
    const luma = parseFloat(match[1]);

    // Normal video should be above the 20-threshold (not a black frame)
    expect(luma).toBeGreaterThan(20);
  });

  test('no false cover alert on startup', async ({ page }) => {
    // Wait for two check cycles to settle
    await page.waitForTimeout(CHECK_INTERVAL_MS * 2 + 1_000);
    const logText = await page.locator('#log').textContent();

    // Should not falsely trigger a COVER event at the start
    expect(logText).not.toContain('POSSIBLE COVER');
    // Cover ratio should be below 50% on normal content
    const matches = [...logText.matchAll(/coverRatio=(\d+\.\d+)%/g)];
    expect(matches.length).toBeGreaterThan(0);
    for (const m of matches) {
      const ratio = parseFloat(m[1]);
      expect(ratio).toBeLessThan(50);
    }
  });

  test('cover detection algorithm fires on a synthetically covered frame', async ({ page }) => {
    // Rather than relying on a specific video timestamp, we deterministically
    // paint the canvas a solid colour (simulating a lens cover) and verify
    // the algorithm raises the cover ratio above 50%.
    const ratio = await page.evaluate(() => {
      const canvas = document.getElementById('c');
      const ctx = canvas.getContext('2d');
      const W = canvas.width, H = canvas.height;

      // Fill the entire canvas with a uniform mid-grey — zero variance in every cell
      ctx.fillStyle = '#888888';
      ctx.fillRect(0, 0, W, H);

      const { data } = ctx.getImageData(0, 0, W, H);
      return computeCoverRatio(data, W, H);
    });

    console.log(`Cover ratio on solid frame: ${(ratio * 100).toFixed(1)}%`);
    // A fully uniform frame must register 100% coverage
    expect(ratio).toBeGreaterThanOrEqual(0.99);
  });

  test('cover detection algorithm does NOT fire on high-variance content', async ({ page }) => {
    // Paint a noise-like checkerboard (alternating black/white pixels) —
    // every cell will have maximum variance, so cover ratio should be ~0.
    const ratio = await page.evaluate(() => {
      const canvas = document.getElementById('c');
      const ctx = canvas.getContext('2d');
      const W = canvas.width, H = canvas.height;
      const imageData = ctx.createImageData(W, H);
      for (let i = 0; i < imageData.data.length; i += 4) {
        const v = ((i / 4) % 2 === 0) ? 0 : 255;
        imageData.data[i] = imageData.data[i+1] = imageData.data[i+2] = v;
        imageData.data[i+3] = 255;
      }
      ctx.putImageData(imageData, 0, 0);
      const { data } = ctx.getImageData(0, 0, W, H);
      return computeCoverRatio(data, W, H);
    });

    console.log(`Cover ratio on checkerboard: ${(ratio * 100).toFixed(1)}%`);
    expect(ratio).toBeLessThan(0.05);
  });
});
