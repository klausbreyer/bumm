import { expect, test } from 'bun:test';
import { clone, makeProject, parseProject, validProject } from '../src/music/project';
import { beatGain, beatLevels } from '../src/music/vocals';
import { renderBank, renderWav } from '../src/music/render';
import { decodeProject, encodeProject } from '../src/storage/project-file';

function project() {
  const p = makeProject('techno'); p.bpm = 120;
  p.vocals = [
    { id: 'one', takeId: 'voice', startSeconds: 2, durationSeconds: 2, shiftMs: 0, volume: 0, beatLevel: .25 },
    { id: 'two', takeId: 'voice', startSeconds: 8, durationSeconds: 2, shiftMs: 0, volume: 0, beatLevel: .75 },
  ];
  return p;
}

test('each voice section owns its beat level and restores the surrounding mix at its end', () => {
  const p = project();
  expect([0, 2, 4, 8, 10].map(seconds => beatGain(p, false, seconds))).toEqual([.5, .125, .5, .375, .5]);
  expect(beatLevels(p)).toEqual([{ start: 0, gain: .5 }, { start: 2, gain: .125 }, { start: 4, gain: .5 }, { start: 8, gain: .375 }, { start: 10, gain: .5 }]);
  p.vocals[1].startSeconds = 3;
  expect(beatGain(p, false, 3.5)).toBe(.125);
  expect(beatGain(p, false, 4)).toBe(.375);
});

test('old projects retain their mix and invalid section levels are rejected', () => {
  const p = project(); p.beatLevel = .7;
  delete p.vocals[0].beatLevel;
  expect(beatGain(parseProject(p)!, false, 2)).toBeCloseTo(.35);
  for (const value of [-1, 1.1, NaN, null, '0.5']) {
    const invalid = clone(p); (invalid.vocals[0] as any).beatLevel = value;
    expect(validProject(invalid, invalid.pack)).toBe(false);
  }
});

test('export changes only the selected section and keeps the mix through file import and undo', () => {
  const p = project();
  const take = { id: 'voice', sampleRate: 8000, samples: new Float32Array(16000) };
  const library = { voice: take };
  const bank = renderBank('techno', 120, 8000);
  const previous = clone(p);
  const original = new Uint8Array(renderWav(p, bank, library));
  p.vocals[0].beatLevel = 0;
  const changed = new Uint8Array(renderWav(p, bank, library));
  const byte = (seconds: number) => 44 + seconds * 8000 * 4;
  expect(changed.slice(byte(0), byte(2))).toEqual(original.slice(byte(0), byte(2)));
  expect(changed.slice(byte(2), byte(4))).not.toEqual(original.slice(byte(2), byte(4)));
  expect(changed.slice(byte(4))).toEqual(original.slice(byte(4)));
  expect(new Uint8Array(renderWav(previous, bank, library))).toEqual(original);
  expect(decodeProject(encodeProject(p, library)).project.vocals).toEqual(p.vocals);
});
