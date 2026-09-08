import { MAX_TAKE_SECONDS } from './project';

/** Capture an exact audio-clock window, independent of callback/block sizes. */
export class CaptureWindow {
  private samples: Float32Array<ArrayBuffer>;
  private end: number;

  constructor(readonly start: number, end: number) {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end - start > 192000 * MAX_TAKE_SECONDS) throw new Error('Invalid capture window');
    this.end = end;
    this.samples = new Float32Array(end - start);
  }

  finishAt(frame: number): void { this.end = Math.max(this.start, Math.min(this.end, Math.round(frame))); }

  push(channels: Float32Array[], frame: number, blockLength: number): boolean {
    const from = Math.max(frame, this.start);
    const to = Math.min(frame + blockLength, this.end);
    for (let at = from; at < to; at++) {
      let sample = 0;
      for (const channel of channels) sample += channel[at - frame] ?? 0;
      this.samples[at - this.start] = channels.length ? sample / channels.length : 0;
    }
    return frame + blockLength >= this.end;
  }

  result(): Float32Array<ArrayBuffer> {
    const length = this.end - this.start;
    return length === this.samples.length ? this.samples : this.samples.slice(0, length);
  }
}
