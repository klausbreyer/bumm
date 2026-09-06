import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { makeProject } from '../../src/music/project';
import { decodeProject, encodeProject } from '../../src/storage/project-file';

interface Playback { duration: number | undefined; bufferDuration: number }
declare global {
  interface Window { vocalStarts: Playback[]; microphoneRequests: number }
}

function recordedSong(): ArrayBuffer {
  const project = makeProject('techno');
  project.bpm = 120;
  project.beatLevel = 0;
  project.song = project.song.slice(0, 2);
  project.song[0].bars = 8;
  project.song[1].bars = 4;
  project.song[0].vocal = { takeId: 'full-take', volume: 1, shiftMs: 0 };
  // Distinct first and second halves expose dropped audio and spill into the next part.
  const samples = Float32Array.from({ length: 16 * 8000 }, (_, i) => i < 8 * 8000 ? .25 : .5);
  return encodeProject(project, { 'full-take': { id: 'full-take', sampleRate: 8000, samples } });
}

async function download(page: Page, label: string): Promise<Buffer> {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: label, exact: true }).click();
  const file = await pending;
  return readFile((await file.path())!);
}

function wavSample(wav: Buffer, seconds: number): number {
  return wav.readInt16LE(44 + Math.round(seconds * wav.readUInt32LE(24)) * 4);
}

test('a recorded part can shrink and grow without losing audio or spilling into the next part', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const observed = window;
    observed.vocalStarts = [];
    observed.microphoneRequests = 0;
    navigator.mediaDevices.getUserMedia = async () => {
      observed.microphoneRequests++;
      throw new Error('This test must not access a microphone');
    };
    // Observe real Web Audio scheduling, keeping the original source.start implementation.
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args: Parameters<typeof start>) {
      if (this.buffer?.numberOfChannels === 1) observed.vocalStarts.push({ duration: args[2], bufferDuration: this.buffer.duration });
      return start.apply(this, args);
    };
  });
  await page.goto('./');
  await page.evaluate(() => document.fonts.ready);
  const fixture = recordedSong();
  await page.locator('#project-file').setInputFiles({ name: 'recorded-song.bumm', mimeType: 'application/octet-stream', buffer: Buffer.from(fixture) });
  await expect(page.locator('.song-part')).toHaveCount(2);
  await page.locator('.song-part').first().click();
  await page.getByText('Songteil bearbeiten', { exact: true }).click();
  const length = page.getByRole('combobox', { name: 'Länge des Songteils' });
  await expect(length).toHaveValue('8');
  await expect(length).toBeEnabled();

  if (testInfo.project.name === 'phone') await length.tap();
  else await length.click();
  await expect(length).toBeFocused();
  // Native popup keyboard handling varies by platform; use Playwright's select control.
  await length.press('Escape');
  await length.selectOption('4');
  await expect(length).toHaveValue('4');
  await expect(page.locator('.vocal-part-heading.chosen')).toContainText('4 Takte');
  await expect(page.locator('.voice-clip.has-voice')).toHaveCount(1);
  await page.getByRole('button', { name: 'Teil anhören' }).click();
  await expect.poll(() => page.evaluate(() => window.vocalStarts.at(-1))).toEqual({ duration: 8, bufferDuration: 16 });
  await expect(length).toBeDisabled();
  // Let the real audio clock finish this eight-second preview without clicking Stop.
  await expect(page.locator('[data-action="play"]')).toHaveText('Start', { timeout: 11_000 });
  await expect(length).toBeEnabled();
  const shortWav = await download(page, 'Song mit Beat und Stimme als WAV herunterladen');
  expect(shortWav.readUInt32LE(40) / shortWav.readUInt32LE(28)).toBe(16);
  expect(wavSample(shortWav, 3)).toBeGreaterThan(3000);
  expect(wavSample(shortWav, 9)).toBe(0);

  await page.getByRole('button', { name: 'Letzte Änderung rückgängig' }).click();
  await expect(length).toHaveValue('8');
  await length.selectOption('4');
  const saved = await download(page, 'Projekt mit Aufnahmen sichern');
  const decoded = decodeProject(Uint8Array.from(saved).buffer);
  expect(decoded.project.song[0].bars).toBe(4);
  expect(decoded.takes[0].samples).toEqual(decodeProject(fixture).takes[0].samples);

  // Reload from IndexedDB/localStorage while shortened, then restore the full eight bars.
  await page.reload();
  await page.locator('.song-part').first().click();
  await page.getByText('Songteil bearbeiten', { exact: true }).click();
  await expect(length).toHaveValue('4');
  await length.selectOption('8');
  await page.getByRole('button', { name: 'Teil anhören' }).click();
  await expect.poll(() => page.evaluate(() => window.vocalStarts.at(-1))).toEqual({ duration: 16, bufferDuration: 16 });
  await page.locator('[data-action="play"]').click();
  const fullWav = await download(page, 'Song mit Beat und Stimme als WAV herunterladen');
  expect(fullWav.readUInt32LE(40) / fullWav.readUInt32LE(28)).toBe(24);
  expect(wavSample(fullWav, 9)).toBeGreaterThan(7000);
  expect(wavSample(fullWav, 17)).toBe(0);
  expect(await page.evaluate(() => window.microphoneRequests)).toBe(0);
  expect(errors).toEqual([]);
});
