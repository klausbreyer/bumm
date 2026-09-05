import { CaptureWindow } from '../music/capture';

declare const currentFrame: number;
declare const sampleRate: number;
declare class AudioWorkletProcessor { readonly port: MessagePort }
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;

class MicrophoneCapture extends AudioWorkletProcessor {
  private capture: CaptureWindow | null = null;
  private closed = false;
  private nextMeter = 0;
  private peak = 0;

  constructor() {
    super();
    this.port.onmessage = event => {
      if (event.data.type === 'arm') this.capture = new CaptureWindow(event.data.startFrame, event.data.endFrame);
      if (event.data.type === 'finish') this.capture?.finishAt(event.data.endFrame);
      if (event.data.type === 'cancel') this.closed = true;
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    if (this.closed) return false;
    // The node remains in the live graph, but microphone audio is never monitored.
    for (const output of outputs) for (const channel of output) channel.fill(0);
    const channels = inputs[0] ?? [];
    const length = outputs[0]?.[0]?.length ?? channels[0]?.length ?? 0;
    for (const channel of channels) for (const sample of channel) this.peak = Math.max(this.peak, Math.abs(sample));
    if (currentFrame >= this.nextMeter) {
      this.port.postMessage({ type: 'level', peak: this.peak });
      this.peak = 0;
      this.nextMeter = currentFrame + sampleRate / 10;
    }
    if (this.capture?.push(channels, currentFrame, length)) {
      const samples = this.capture.result();
      this.port.postMessage({ type: 'done', samples }, [samples.buffer]);
      this.closed = true;
      return false;
    }
    return true;
  }
}

registerProcessor('bumm-microphone', MicrophoneCapture);
