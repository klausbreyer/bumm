import { beforeAll, describe, expect, test } from 'bun:test';
import { createContext, runInContext } from 'node:vm';
import 'fake-indexeddb/auto';
import { CaptureWindow } from '../src/music/capture';
import { clone, hasVocals, makeProject, makeStudio, parseProject, parseStudio } from '../src/music/project';
import { prepareTake, vocalPlacement, waveform } from '../src/music/vocals';
import type { Take } from '../src/music/vocals';
import { renderBank, renderWav } from '../src/music/render';
import { decodeProject, encodeProject, remapImported } from '../src/storage/project-file';
import { TakeStore } from '../src/storage/takes';

function fixture(id = 'take-one'): Take {
  return { id, sampleRate: 8000, samples: Float32Array.from({ length: 8000 }, (_, i) => Math.sin(i * .15) * .4) };
}

describe('Microphone capture', () => {
  test('records only the scheduled window across variable audio block sizes', () => {
    const capture = new CaptureWindow(3, 12);
    expect(capture.push([new Float32Array([0, 1, 2, 3, 4])], 0, 5)).toBe(false);
    expect(capture.push([new Float32Array([5, 6])], 5, 2)).toBe(false);
    expect(capture.push([new Float32Array([7, 8, 9, 10, 11, 12, 13])], 7, 7)).toBe(true);
    expect([...capture.result()]).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  test('an early stop truncates without retaining a long silent tail', () => {
    const capture = new CaptureWindow(0, 100);
    capture.push([new Float32Array(10).fill(.5)], 0, 10);
    capture.finishAt(12);
    expect(capture.push([new Float32Array(10).fill(.5)], 10, 10)).toBe(true);
    expect(capture.result().length).toBe(12);
  });

  test('stereo microphone inputs become mono and missing input remains silence', () => {
    const capture = new CaptureWindow(0, 4);
    capture.push([new Float32Array([1, .5]), new Float32Array([-1, .5])], 0, 2);
    capture.push([], 2, 2);
    expect([...capture.result()]).toEqual([0, .5, 0, 0]);
  });

  test('normalization rejects silence, retains headroom and fades the boundaries', () => {
    expect(() => prepareTake('silent', 8000, new Float32Array(8000))).toThrow('keine Stimme');
    const take = prepareTake('voice', 8000, new Float32Array(8000).fill(.1));
    expect(take.samples[0]).toBe(0);
    expect(take.samples.at(-1)).toBe(0);
    expect(take.samples[500]).toBeCloseTo(.6);
    expect(waveform(take)).toHaveLength(64);
  });

  let workletCode: string;
  beforeAll(async () => {
    const built = await Bun.build({ entrypoints: ['src/audio/capture-worklet.ts'], target: 'browser', format: 'iife' });
    expect(built.success).toBe(true);
    workletCode = await built.outputs[0].text();
  });

  test('the actual worklet captures microphone PCM and never sends it to speakers', () => {
    const messages: { type: string; samples?: Float32Array }[] = [];
    const port = { onmessage: (_event: { data: unknown }) => {}, postMessage: (message: { type: string; samples?: Float32Array }) => messages.push(message) };
    let Processor: new () => { process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean };
    const context = createContext({ Float32Array, currentFrame: 0, sampleRate: 8000,
      AudioWorkletProcessor: class { port = port; },
      registerProcessor: (_name: string, klass: typeof Processor) => { Processor = klass; },
    });
    runInContext(workletCode, context);
    const processor = new Processor!();
    port.onmessage({ data: { type: 'arm', startFrame: 2, endFrame: 7 } });
    const output = new Float32Array(4).fill(9);
    expect(processor.process([[new Float32Array([0, 1, 2, 3])]], [[output]])).toBe(true);
    expect([...output]).toEqual([0, 0, 0, 0]);
    context.currentFrame = 4;
    expect(processor.process([[new Float32Array([4, 5, 6, 7])]], [[output]])).toBe(false);
    expect([...messages.find(message => message.type === 'done')!.samples!]).toEqual([2, 3, 4, 5, 6]);
  });
});

describe('Portable vocal projects', () => {
  test('legacy projects and studio storage migrate without losing arrangements', () => {
    const current = makeProject('hiphop');
    const legacy = { ...current, version: 1, song: current.song.map(({ vocal: _vocal, ...part }) => part) };
    expect(parseProject(legacy)?.song.every(part => part.vocal === null)).toBe(true);
    expect(parseProject(legacy)?.song.map(part => part.id)).toEqual(current.song.map(part => part.id));
    const studio = makeStudio();
    expect(parseStudio(JSON.stringify({ ...studio, version: 1, projects: { ...studio.projects, hiphop: legacy } }))?.version).toBe(2);
  });

  test('a project bundle contains exact audio once, even when a refrain is copied', () => {
    const project = makeProject('hiphop');
    const take = fixture();
    project.song[1].vocal = { takeId: take.id, volume: .8, shiftMs: -20 };
    project.song[2].vocal = clone(project.song[1].vocal);
    const decoded = decodeProject(encodeProject(project, { [take.id]: take }));
    expect(decoded.project).toEqual(project);
    expect(decoded.takes).toHaveLength(1);
    expect(decoded.takes[0].samples).toEqual(take.samples);
  });

  test('imported recordings cannot overwrite recordings with the same ID', () => {
    const project = makeProject('hiphop');
    project.song[0].vocal = { takeId: 'take-one', volume: .8, shiftMs: 0 };
    const imported = remapImported(project, [fixture()], () => 'new-id');
    expect(imported.project.song[0].vocal?.takeId).toBe('new-id');
    expect(imported.takes[0].id).toBe('new-id');
    expect(project.song[0].vocal?.takeId).toBe('take-one');
  });

  test('missing audio and truncated or invalid bundles fail without silently losing vocals', () => {
    const project = makeProject('hiphop');
    const take = fixture();
    project.song[0].vocal = { takeId: take.id, volume: .8, shiftMs: 0 };
    expect(() => encodeProject(project, {})).toThrow('Aufnahme fehlt');
    const encoded = encodeProject(project, { [take.id]: take });
    expect(() => decodeProject(encoded.slice(0, encoded.byteLength - 4))).toThrow();
    const corrupt = encoded.slice(0);
    new DataView(corrupt).setFloat32(corrupt.byteLength - 4, NaN, true);
    expect(() => decodeProject(corrupt)).toThrow('ungültige Audiodaten');
    expect(() => decodeProject(new TextEncoder().encode(JSON.stringify(project)).buffer)).toThrow('vollständige');
  });

  test('beat-only JSON files remain importable', () => {
    const project = makeProject('techno');
    const decoded = decodeProject(new TextEncoder().encode(JSON.stringify(project)).buffer);
    expect(decoded.project).toEqual(project);
    expect(decoded.takes).toEqual([]);
  });

  test('audio survives closing the store and reopening it from IndexedDB', async () => {
    const take = fixture('persistent-take');
    const store = new TakeStore();
    await store.putAll([take]);
    const reopened = new TakeStore();
    expect(await reopened.get(take.id)).toEqual(take);
    await expect(reopened.get('nonexistent')).rejects.toThrow('Aufnahme fehlt');
  });
});

describe('Voice and beat alignment', () => {
  const bank = renderBank('hiphop', 92, 8000);

  test('moving a song part moves its voice and undo restores its original position', () => {
    const project = makeProject('hiphop');
    project.beatLevel = 0;
    const take = fixture();
    project.song[1].vocal = { takeId: take.id, volume: 1, shiftMs: 0 };
    const previous = clone(project);
    const sample = (wav: ArrayBuffer, seconds: number) => new DataView(wav).getInt16(44 + Math.round(seconds * bank.sampleRate) * 4, true);
    const offset = project.song[0].bars * bank.frames / bank.sampleRate / 4;
    const original = renderWav(project, bank, { [take.id]: take });
    expect(sample(original, .125)).toBe(0);
    expect(Math.abs(sample(original, offset + .125))).toBeGreaterThan(1000);
    [project.song[0], project.song[1]] = [project.song[1], project.song[0]];
    const moved = renderWav(project, bank, { [take.id]: take });
    expect(Math.abs(sample(moved, .125))).toBeGreaterThan(1000);
    expect(renderWav(previous, bank, { [take.id]: take })).toEqual(original);
    expect(hasVocals(project)).toBe(true);
    project.song[0].vocal = null;
    expect(hasVocals(project)).toBe(false);
  });

  test('positive timing delays voice; negative timing trims the beginning', () => {
    const take = fixture();
    const clip = { takeId: take.id, volume: 1, shiftMs: 100 };
    expect(vocalPlacement(clip, take, 4)).toEqual({ start: .1, offset: 0, duration: 1 });
    expect(vocalPlacement({ ...clip, shiftMs: -100 }, take, 4)).toEqual({ start: 0, offset: .1, duration: .9 });
    expect(vocalPlacement(clip, take, .5).duration).toBeCloseTo(.4);
  });

  test('export resamples vocals, applies volume and keeps timing identical', () => {
    const project = makeProject('hiphop');
    project.beatLevel = 0;
    project.song = [project.song[0]];
    const take: Take = { id: 'resampled', sampleRate: 16000, samples: new Float32Array(16000).fill(.5) };
    project.song[0].vocal = { takeId: take.id, volume: .5, shiftMs: 100 };
    const view = new DataView(renderWav(project, bank, { [take.id]: take }));
    const sample = (seconds: number) => view.getInt16(44 + Math.round(seconds * 8000) * 4, true);
    expect(sample(.05)).toBe(0);
    expect(sample(.2)).toBeCloseTo(Math.round(.5 * .5 * .48 * 32767), 0);
    expect(sample(1.2)).toBe(0);
  });
});
