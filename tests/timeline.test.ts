import { expect, test } from 'bun:test';
import { clone, durationSeconds, makeProject, parseProject, validProject } from '../src/music/project';
import { renderBank, renderWav } from '../src/music/render';
import { timelinePlacement } from '../src/music/vocals';
import { decodeProject, encodeProject } from '../src/storage/project-file';

const take = { id: 'free-voice', sampleRate: 8000, samples: new Float32Array(8000 * 20).fill(.5) };
const clip = { id: 'voice-1', takeId: take.id, startSeconds: 2, durationSeconds: 20, volume: 1, shiftMs: 0 };

test('v2 vocals migrate to fixed time positions and retain their previous playback windows', () => {
  const project = makeProject('hiphop');
  const legacy = { ...project, version: 2, song: project.song.map((part, index) => ({ ...part, vocal: index === 1 ? { takeId: take.id, volume: .8, shiftMs: -20 } : null })) };
  const migrated = parseProject(legacy)!;
  expect(migrated.version).toBe(3);
  expect(migrated.vocals[0]).toMatchObject({ takeId: take.id, startSeconds: 4 * 240 / project.bpm, durationSeconds: 8 * 240 / project.bpm, volume: .8, shiftMs: -20 });
  expect(migrated.song[1]).not.toHaveProperty('vocal');
  expect(parseProject({ ...legacy, song: [{ ...legacy.song[0], bars: -4 }] })).toBeNull();
});

test('voice spans beat boundaries and survives rearranging, shortening and deleting all beats', () => {
  const project = makeProject('techno');
  project.bpm = 120;
  project.beatLevel = 0;
  project.song = project.song.slice(0, 2);
  project.vocals = [clone(clip)];
  const bank = renderBank('techno', 120, 8000);
  const sample = (wav: ArrayBuffer, seconds: number) => new DataView(wav).getInt16(44 + Math.round(seconds * 8000) * 4, true);
  const before = renderWav(project, bank, { [take.id]: take });
  expect(sample(before, 8)).toBeGreaterThan(7000);
  project.song.reverse();
  project.song[0].bars = 4;
  const after = renderWav(project, bank, { [take.id]: take });
  expect(sample(after, 8)).toEqual(sample(before, 8));
  project.song = [];
  expect(durationSeconds(project)).toBe(22);
  expect(sample(renderWav(project, bank, { [take.id]: take }), 21)).toBeGreaterThan(7000);
  expect(decodeProject(encodeProject(project, { [take.id]: take })).project).toEqual(project);
});

test('seeking into a voice clips its source offset without moving it', () => {
  expect(timelinePlacement(clip, take, 7)).toEqual({ start: 7, offset: 5, duration: 15 });
  expect(timelinePlacement({ ...clip, shiftMs: 100 }, take, 0)).toEqual({ start: 2.1, offset: 0, duration: 19.9 });
  expect(timelinePlacement(clip, take, 30).duration).toBe(0);
});

test('voice timelines reject invalid positions, duration, duplicate IDs and excess clips', () => {
  for (const change of [
    (p: any) => p.vocals[0].startSeconds = -1,
    (p: any) => p.vocals[0].durationSeconds = Infinity,
    (p: any) => p.vocals[0].durationSeconds = 0,
    (p: any) => p.vocals.push(clone(p.vocals[0])),
    (p: any) => p.vocals = Array.from({ length: 9 }, (_, i) => ({ ...clip, id: String(i) })),
  ]) {
    const p = makeProject('hiphop');
    p.vocals = [clone(clip)];
    change(p);
    expect(validProject(p, p.pack)).toBe(false);
  }
});
