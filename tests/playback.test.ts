import { afterEach, expect, test } from 'bun:test';
import { BrowserEngine } from '../src/audio/browser-engine';
import { makeProject } from '../src/music/project';
import { renderBank } from '../src/music/render';
import type { BankClient } from '../src/audio/bank-client';

const originalContext = globalThis.AudioContext;
afterEach(() => { globalThis.AudioContext = originalContext; });
function harness() {
  const starts: { channels: number; at: number; offset?: number; duration?: number }[] = [];
  const levels: number[] = [];
  let clicks = 0;
  const node = () => ({ connect(next: unknown) { return next; }, disconnect() {} });
  class Context {
    currentTime = 10;
    state = 'running';
    destination = {};
    resume = async () => {};
    addEventListener() {}
    createGain() { return { ...node(), gain: { value: 0, setTargetAtTime(value: number) { levels.push(value); }, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {} } }; }
    createBuffer(channels: number, frames: number, rate: number) { return { numberOfChannels: channels, duration: frames / rate, copyToChannel() {} }; }
    createBufferSource() { return { ...node(), buffer: null as any, loop: false, start(at: number, offset?: number, duration?: number) { starts.push({ channels: this.buffer.numberOfChannels, at, offset, duration }); }, stop() {}, onended: null }; }
    createOscillator() { clicks++; return { ...node(), frequency: { value: 0 }, start() {}, stop() {}, onended: null }; }
  }
  globalThis.AudioContext = Context as unknown as typeof AudioContext;
  const bank = renderBank('techno', 120, 8000);
  const engine = new BrowserEngine({ getBank: async () => bank } as unknown as BankClient);
  return { engine, starts, levels, clicks: () => clicks };
}

test('recording without headphones keeps beat and count-in silent while the clock runs', async () => {
  const { engine, levels, clicks } = harness();
  const project = makeProject('techno'); project.bpm = 120;
  await engine.start(project, 'song', {}, { recording: true, headphones: false, startSeconds: 4, recordingSeconds: 40 });
  expect(levels.every(value => value === 0)).toBe(true);
  expect(clicks()).toBe(0);
  expect(engine.position()?.seconds).toBe(4);
  engine.stop();
});

test('headphones enable the backing track and four count-in clicks', async () => {
  const { engine, levels, clicks } = harness();
  const project = makeProject('techno'); project.bpm = 120;
  await engine.start(project, 'song', {}, { recording: true, headphones: true, recordingSeconds: 40 });
  expect(levels.some(value => value > 0)).toBe(true);
  expect(clicks()).toBe(4);
  engine.stop();
});

test('song seek schedules a crossing voice at its source offset and stops at the independent song end', async () => {
  const { engine, starts } = harness();
  const project = makeProject('techno'); project.bpm = 120; project.song = [];
  project.vocals = [{ id: 'voice', takeId: 'take', startSeconds: 2, durationSeconds: 20, volume: 1, shiftMs: 0 }];
  let duration = 0;
  await engine.start(project, 'song', { take: { id: 'take', sampleRate: 8000, samples: new Float32Array(160000) } }, { startSeconds: 7, onScheduled: schedule => { duration = schedule.endTime - schedule.startTime; } });
  expect(starts.find(start => start.channels === 1)).toMatchObject({ offset: 5, duration: 15 });
  expect(duration).toBeCloseTo(15);
  engine.stop();
});
