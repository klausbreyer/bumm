import captureUrl from './capture-worklet.ts?worker&url';
import { prepareTake } from '../music/vocals';
import type { Take } from '../music/vocals';

export class RecordingCancelled extends Error {}

export class MicrophoneRecorder {
  private context?: AudioContext;
  private stream?: MediaStream;
  private source?: MediaStreamAudioSourceNode;
  private filter?: BiquadFilterNode;
  private node?: AudioWorkletNode;
  private generation = 0;
  private complete?: { resolve: (take: Take) => void; reject: (error: Error) => void };
  private id = '';
  private endTime = 0;
  private compensation = 0;
  onLevel: (level: number) => void = () => {};
  onInterrupted: () => void = () => {};

  async prepare(context: AudioContext, headphones = true): Promise<void> {
    this.cancel();
    const generation = this.generation;
    if (!navigator.mediaDevices?.getUserMedia || !context.audioWorklet) throw new Error('Für Aufnahmen braucht BUMM HTTPS oder localhost und einen aktuellen Browser.');
    this.context = context;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      video: false,
    });
    if (generation !== this.generation) { stream.getTracks().forEach(track => track.stop()); throw new RecordingCancelled(); }
    this.stream = stream;
    try {
      await context.audioWorklet.addModule(captureUrl);
      if (generation !== this.generation) throw new RecordingCancelled();
      this.source = context.createMediaStreamSource(stream);
      this.filter = context.createBiquadFilter();
      this.filter.type = 'highpass';
      this.filter.frequency.value = 70;
      this.node = new AudioWorkletNode(context, 'bumm-microphone', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      this.source.connect(this.filter).connect(this.node).connect(context.destination);
      this.node.onprocessorerror = () => {
        if (generation === this.generation) this.fail(new Error('Die Aufnahme wurde unterbrochen. Deine vorige Aufnahme bleibt erhalten.'));
      };
      this.node.port.onmessage = event => {
        if (generation !== this.generation) return;
        if (event.data.type === 'level') this.onLevel(event.data.peak);
        if (event.data.type === 'done') {
          const completion = this.complete;
          this.complete = undefined;
          this.cleanup();
          try { completion?.resolve(prepareTake(this.id, context.sampleRate, event.data.samples)); }
          catch (error) { completion?.reject(error instanceof Error ? error : new Error('Die Aufnahme konnte nicht gelesen werden.')); }
        }
      };
      for (const track of stream.getTracks()) track.onended = () => {
        if (generation === this.generation) this.fail(new Error('Die Verbindung zum Mikrofon wurde unterbrochen. Bitte versuche es nochmal.'));
      };
      // Device values are estimates. Per-take timing adjustment remains available.
      const input = (stream.getAudioTracks()[0].getSettings() as MediaTrackSettings & { latency?: number }).latency ?? 0;
      this.compensation = Math.min(.5, Math.max(0, (headphones ? (context.baseLatency || 0) + (context.outputLatency || 0) : 0) + input));
    } catch (error) { if (generation === this.generation) this.cleanup(); throw error; }
  }

  capture(startTime: number, endTime: number): Promise<Take> {
    if (!this.node || !this.context) return Promise.reject(new Error('Das Mikrofon ist noch nicht bereit.'));
    this.id = crypto.randomUUID();
    this.endTime = endTime + this.compensation;
    const sampleRate = this.context.sampleRate;
    return new Promise((resolve, reject) => {
      this.complete = { resolve, reject };
      this.node!.port.postMessage({ type: 'arm', startFrame: Math.round((startTime + this.compensation) * sampleRate), endFrame: Math.round(this.endTime * sampleRate) });
    });
  }

  finish(): void {
    if (!this.context || !this.node) return;
    this.node.port.postMessage({ type: 'finish', endFrame: Math.round(Math.min(this.endTime, this.context.currentTime + this.compensation) * this.context.sampleRate) });
  }

  cancel(): void {
    this.generation++;
    const completion = this.complete;
    this.complete = undefined;
    this.node?.port.postMessage({ type: 'cancel' });
    this.cleanup();
    completion?.reject(new RecordingCancelled());
  }

  private fail(error: Error): void {
    const completion = this.complete;
    this.complete = undefined;
    this.cleanup();
    if (completion) completion.reject(error);
    else this.onInterrupted();
  }

  private cleanup(): void {
    this.source?.disconnect(); this.filter?.disconnect(); this.node?.disconnect();
    this.node?.port.close();
    this.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    this.stream = undefined; this.source = undefined; this.filter = undefined; this.node = undefined;
    this.onLevel(0);
  }
}

export function microphoneError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') return 'Erlaube den Mikrofonzugriff im Browser und versuche es nochmal.';
  if (error instanceof DOMException && error.name === 'NotFoundError') return 'Kein Mikrofon gefunden. Verbinde ein Mikrofon und versuche es nochmal.';
  if (error instanceof DOMException && error.name === 'NotReadableError') return 'Das Mikrofon ist gerade nicht verfügbar. Schließe andere Aufnahme-Apps und versuche es nochmal.';
  return error instanceof Error ? error.message : 'Die Aufnahme konnte nicht starten. Bitte versuche es nochmal.';
}
