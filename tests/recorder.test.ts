import { beforeAll, expect, test } from 'bun:test';
import { createContext, runInContext } from 'node:vm';

let code: string;
beforeAll(async () => {
  const result = await Bun.build({
    entrypoints: ['src/audio/microphone-recorder.ts'], target: 'browser', format: 'cjs',
    plugins: [{ name: 'worklet-url', setup(build) {
      build.onResolve({ filter: /\?worker&url$/ }, () => ({ path: 'worklet-url', namespace: 'test' }));
      build.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export default "capture-worklet.js"', loader: 'js' }));
    } }],
  });
  expect(result.success).toBe(true);
  code = await result.outputs[0].text();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function stream() {
  const track = { stopped: false, onended: null, stop() { this.stopped = true; }, getSettings: () => ({ latency: .01 }) };
  return { track, getTracks: () => [track], getAudioTracks: () => [track] };
}

function harness(getUserMedia: () => Promise<ReturnType<typeof stream>>, addModule: () => Promise<void> = async () => {}) {
  const graphNode = () => ({ connect(next: unknown) { return next; }, disconnect() {} });
  const worklets: { port: { onmessage: (event: unknown) => void; postMessage: (message: unknown) => void; close: () => void } }[] = [];
  const environment = createContext({ Float32Array, crypto, DOMException, module: { exports: {} },
    navigator: { mediaDevices: { getUserMedia } },
    AudioWorkletNode: class {
      port = { onmessage: (_event: unknown) => {}, postMessage: (_message: unknown) => {}, close() {} };
      constructor() { worklets.push(this); }
      connect(next: unknown) { return next; }
      disconnect() {}
    },
  });
  runInContext(code, environment);
  const Recorder = environment.module.exports.MicrophoneRecorder;
  const recorder = new Recorder();
  const context = {
    sampleRate: 8000, baseLatency: .01, outputLatency: .02, currentTime: 1, destination: {},
    audioWorklet: { addModule },
    createMediaStreamSource: graphNode,
    createBiquadFilter: () => ({ ...graphNode(), type: '', frequency: { value: 0 } }),
  };
  return { recorder, context, worklets };
}

test('cancelling a pending permission request stops the late microphone stream', async () => {
  const request = deferred<ReturnType<typeof stream>>();
  const { recorder, context, worklets } = harness(() => request.promise);
  const pending = recorder.prepare(context);
  recorder.cancel();
  const input = stream();
  request.resolve(input);
  await expect(pending).rejects.toThrow();
  expect(input.track.stopped).toBe(true);
  expect(worklets).toHaveLength(0);
});

test('a cancelled worklet load cannot close the next recording microphone', async () => {
  const oldModule = deferred<void>();
  const moduleStarted = deferred<void>();
  const oldStream = stream();
  const newStream = stream();
  let streams = 0;
  let modules = 0;
  const { recorder, context } = harness(async () => streams++ === 0 ? oldStream : newStream, () => {
    if (modules++ === 0) { moduleStarted.resolve(); return oldModule.promise; }
    return Promise.resolve();
  });
  const old = recorder.prepare(context).catch((error: Error) => error);
  await moduleStarted.promise;
  recorder.cancel();
  await recorder.prepare(context);
  oldModule.resolve();
  expect((await old).constructor.name).toBe('RecordingCancelled');
  expect(oldStream.track.stopped).toBe(true);
  expect(newStream.track.stopped).toBe(false);
  recorder.cancel();
  expect(newStream.track.stopped).toBe(true);
});

test('finishing captures audio and releases the microphone before saving', async () => {
  const input = stream();
  const { recorder, context, worklets } = harness(async () => input);
  await recorder.prepare(context);
  const result = recorder.capture(2, 3);
  worklets[0].port.onmessage({ data: { type: 'done', samples: new Float32Array(8000).fill(.2) } });
  const take = await result;
  expect(take.samples.length).toBe(8000);
  expect(take.samples[100]).toBeCloseTo(.85);
  expect(input.track.stopped).toBe(true);
});
