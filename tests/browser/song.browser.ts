import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { makeProject } from '../../src/music/project';
import { decodeProject, encodeProject } from '../../src/storage/project-file';

interface Playback { offset: number | undefined; duration: number | undefined; bufferDuration: number }
declare global {
  interface Window { vocalStarts: Playback[]; microphoneRequests: number; testMicrophone?: AudioContext }
}
function recordedSong(): ArrayBuffer {
  const project = makeProject('techno');
  project.bpm = 120; project.beatLevel = 0;
  project.song = project.song.slice(0, 2);
  project.song[0].bars = 8; project.song[1].bars = 4;
  project.vocals = [{ id: 'voice', takeId: 'full-take', startSeconds: 0, durationSeconds: 16, volume: 1, shiftMs: 0 }];
  const samples = Float32Array.from({ length: 16 * 8000 }, (_, i) => i < 8 * 8000 ? .25 : .5);
  return encodeProject(project, { 'full-take': { id: 'full-take', sampleRate: 8000, samples } });
}
async function download(page: Page, label: string): Promise<Buffer> {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: label, exact: true }).click();
  const file = await pending;
  return readFile((await file.path())!);
}
async function seek(page: Page, seconds: number): Promise<void> {
  await page.locator('#song-position').evaluate((element, value) => {
    const input = element as HTMLInputElement; input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, seconds);
}
function wavSample(wav: Buffer, seconds: number): number {
  return wav.readInt16LE(44 + Math.round(seconds * wav.readUInt32LE(24)) * 4);
}

test('song opens first, inline beat changes leave the independent voice intact through undo and reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.vocalStarts = []; window.microphoneRequests = 0;
    navigator.mediaDevices.getUserMedia = async () => { window.microphoneRequests++; throw new Error('No microphone in playback test'); };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args: Parameters<typeof start>) {
      if (this.buffer?.numberOfChannels === 1) window.vocalStarts.push({ offset: args[1], duration: args[2], bufferDuration: this.buffer.duration });
      return start.apply(this, args);
    };
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Dein Song', exact: true })).toBeVisible();
  await expect(page.locator('.beat-editor')).toHaveCount(0);
  await expect(page.locator('.record-button')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Beat bauen', exact: true })).toHaveCount(0);
  const fixture = recordedSong();
  await page.locator('#project-file').setInputFiles({ name: 'recorded.bumm', mimeType: 'application/octet-stream', buffer: Buffer.from(fixture) });
  await expect(page.locator('.vocal-part-heading')).toHaveCount(2);
  await page.locator('.vocal-part-heading').first().click();
  const length = page.getByRole('combobox', { name: 'Länge des Songteils' });
  await expect(length).toHaveValue('8');
  await length.selectOption('4');
  await expect(length).toHaveValue('4');
  await expect(page.locator('.voice-clip.has-voice')).toHaveCount(1);
  await seek(page, 7);
  await page.getByRole('button', { name: 'Song starten', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.vocalStarts.at(-1))).toEqual({ offset: 7, duration: 9, bufferDuration: 16 });
  const before = await page.locator('#song-playhead').evaluate(el => (el as HTMLElement).style.left);
  await expect.poll(() => page.locator('#song-playhead').evaluate(el => (el as HTMLElement).style.left)).not.toBe(before);
  await expect(length).toBeDisabled();
  await page.getByRole('button', { name: 'Wiedergabe stoppen', exact: true }).click();
  const wav = await download(page, 'Song mit Beat und Stimme als WAV herunterladen');
  expect(wav.readUInt32LE(40) / wav.readUInt32LE(28)).toBe(16);
  expect(wavSample(wav, 9)).toBeGreaterThan(7000);
  await page.getByRole('button', { name: 'Letzte Änderung rückgängig' }).click();
  await page.locator('.vocal-part-heading').first().click();
  await expect(length).toHaveValue('8');
  await page.getByRole('button', { name: 'Intro nach rechts' }).click();
  const saved = await download(page, 'Projekt mit Aufnahmen sichern');
  const decoded = decodeProject(Uint8Array.from(saved).buffer);
  expect(decoded.project.vocals[0]).toMatchObject({ startSeconds: 0, durationSeconds: 16 });
  expect(decoded.project.song[1].id).toBe('intro');
  expect(decoded.takes[0].samples).toEqual(decodeProject(fixture).takes[0].samples);
  await page.reload();
  await expect(page.locator('.vocal-part-heading').first()).toContainText('Strophe');
  await expect(page.locator('.voice-clip.has-voice')).toHaveCount(1);
  await expect(page.locator('.beat-editor')).toHaveCount(0);
  expect(await page.evaluate(() => window.microphoneRequests)).toBe(0);
  expect(errors).toEqual([]);
});

test('recording crosses a beat boundary, offers headphone monitoring and preserves a take on cancellation', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.microphoneRequests = 0;
    // A generated signal exercises the actual recorder and worklet without a physical microphone.
    navigator.mediaDevices.getUserMedia = async () => {
      window.microphoneRequests++;
      const context = new AudioContext(); window.testMicrophone = context;
      const tone = context.createOscillator(); tone.frequency.value = 220;
      const destination = context.createMediaStreamDestination();
      tone.connect(destination); tone.start(); await context.resume();
      const track = destination.stream.getAudioTracks()[0];
      const stop = track.stop.bind(track);
      track.stop = () => { stop(); tone.stop(); void context.close(); };
      return destination.stream;
    };
  });
  await page.goto('./');
  await page.getByRole('button', { name: 'Techno', exact: true }).click();
  const bpm = page.getByRole('spinbutton', { name: 'Tempo in BPM' });
  await bpm.fill('120'); await bpm.press('Tab');
  await expect(page.getByRole('radio', { name: 'Nein', exact: true })).toBeChecked();
  await seek(page, 7);
  await page.getByRole('button', { name: 'Aufnahme starten', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Aufnahme beenden', exact: true })).toBeEnabled();
  await expect(page.locator('#position-time')).toHaveText('0:10', { timeout: 7000 });
  await page.getByRole('button', { name: 'Aufnahme beenden', exact: true }).click();
  await expect(page.locator('.voice-clip.has-voice')).toHaveCount(1);
  const saved = await download(page, 'Projekt mit Aufnahmen sichern');
  const original = decodeProject(Uint8Array.from(saved).buffer);
  expect(original.project.vocals[0].startSeconds).toBe(7);
  expect(original.project.vocals[0].durationSeconds).toBeGreaterThan(2);
  expect(original.project.vocals[0].durationSeconds).toBeLessThan(5);
  await page.getByRole('radio', { name: 'Ja', exact: true }).check();
  await expect(page.getByText('Du hörst den Beat beim Aufnehmen über Kopfhörer.')).toBeVisible();
  await page.getByRole('button', { name: 'Neu aufnehmen', exact: true }).click();
  await page.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Neu aufnehmen', exact: true })).toBeEnabled();
  const after = decodeProject(Uint8Array.from(await download(page, 'Projekt mit Aufnahmen sichern')).buffer);
  expect(after.project.vocals).toEqual(original.project.vocals);
  expect(after.takes[0].samples).toEqual(original.takes[0].samples);
  await page.getByText('Stimme & Beat mischen', { exact: true }).click();
  await page.getByRole('button', { name: 'Aufnahme entfernen', exact: true }).click();
  await expect(page.locator('.voice-clip')).toHaveCount(0);
  await page.getByRole('button', { name: 'Letzte Änderung rückgängig' }).click();
  await expect(page.locator('.voice-clip')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('a voice-only project can play, export and begin a new recording', async ({ page }) => {
  const decoded = decodeProject(recordedSong()); decoded.project.song = [];
  const fixture = encodeProject(decoded.project, Object.fromEntries(decoded.takes.map(take => [take.id, take])));
  await page.goto('./');
  await page.locator('#project-file').setInputFiles({ name: 'voice.bumm', mimeType: 'application/octet-stream', buffer: Buffer.from(fixture) });
  await expect(page.locator('.voice-clip')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Aufnahme starten', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Song starten', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Wiedergabe stoppen', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Wiedergabe stoppen', exact: true }).click();
  const wav = await download(page, 'Song mit Beat und Stimme als WAV herunterladen');
  expect(wavSample(wav, 9)).toBeGreaterThan(7000);
});
