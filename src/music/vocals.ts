import type { Project, VocalClip, TimelineVocal } from './project';
import { hasVocals, takeIds, MAX_TAKE_SECONDS } from './project';

export { MAX_TAKE_SECONDS } from './project';
export const VOCAL_GAIN = .48;
export interface Take { id: string; sampleRate: number; samples: Float32Array<ArrayBuffer> }
export type TakeLibrary = Record<string, Take>;

/** Overlapping voice sections use the quieter backing level, never a summed gain. */
export function beatGain(project: Project, recording = false, seconds = 0): number {
  let level = Infinity;
  for (const clip of project.vocals) {
    if (seconds >= clip.startSeconds && seconds < clip.startSeconds + clip.durationSeconds) {
      level = Math.min(level, clip.beatLevel ?? project.beatLevel);
    }
  }
  return (level === Infinity ? project.beatLevel : level) * (recording || hasVocals(project) ? .5 : 1);
}

/** Shared gain changes keep playback, seeking and WAV export on the same section boundaries. */
export function beatLevels(project: Project, recording = false): { start: number; gain: number }[] {
  const times = [...new Set([0, ...project.vocals.flatMap(clip => [clip.startSeconds, clip.startSeconds + clip.durationSeconds])])].sort((a, b) => a - b);
  const result: { start: number; gain: number }[] = [];
  for (const start of times) {
    const gain = beatGain(project, recording, start);
    if (result.at(-1)?.gain !== gain) result.push({ start, gain });
  }
  return result;
}

export function validTake(take: Take): boolean {
  return /^[a-zA-Z0-9-]{1,64}$/.test(take.id) && Number.isInteger(take.sampleRate)
    && take.sampleRate >= 8000 && take.sampleRate <= 192000 && take.samples instanceof Float32Array
    && take.samples.length > 0 && take.samples.length <= take.sampleRate * MAX_TAKE_SECONDS
    && take.samples.every(sample => Number.isFinite(sample) && Math.abs(sample) <= 1);
}

export function requireTakes(project: Project, library: TakeLibrary): void {
  for (const id of takeIds(project)) if (!Object.hasOwn(library, id)) throw new Error('Eine Aufnahme fehlt. Bitte lade die vollständige Projektdatei.');
}

/** Bounded normalization lifts quiet singing without amplifying room noise indefinitely. */
export function prepareTake(id: string, sampleRate: number, samples: Float32Array<ArrayBuffer>): Take {
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  if (!Number.isFinite(peak) || peak < .001) throw new Error('Es war keine Stimme zu hören. Prüfe dein Mikrofon und versuche es nochmal.');
  const gain = Math.min(6, .85 / peak);
  const fadeFrames = Math.round(sampleRate * .005);
  for (let i = 0; i < samples.length; i++) samples[i] *= gain * Math.min(1, i / fadeFrames, (samples.length - 1 - i) / fadeFrames);
  const take = { id, sampleRate, samples };
  if (!validTake(take)) throw new Error('Die Aufnahme ist nicht lesbar. Bitte versuche es nochmal.');
  return take;
}

/** Timing adjustment trims at the clip window, independent of beat boundaries. */
export function vocalPlacement(clip: VocalClip, take: Take, partSeconds: number): { start: number; offset: number; duration: number } {
  const shift = clip.shiftMs / 1000;
  const start = Math.max(0, shift);
  const offset = Math.max(0, -shift);
  return { start, offset, duration: Math.max(0, Math.min(partSeconds - start, take.samples.length / take.sampleRate - offset)) };
}

export function vocalSample(take: Take, seconds: number): number {
  const position = seconds * take.sampleRate;
  if (position < 0 || position >= take.samples.length) return 0;
  const index = Math.floor(position);
  const fraction = position - index;
  return take.samples[index] * (1 - fraction) + (take.samples[index + 1] ?? 0) * fraction;
}

export function waveform(take: Take, count = 64): number[] {
  const stride = take.samples.length / count;
  return Array.from({ length: count }, (_, bar) => {
    let peak = 0;
    for (let i = Math.floor(bar * stride); i < Math.floor((bar + 1) * stride); i++) peak = Math.max(peak, Math.abs(take.samples[i]));
    return peak;
  });
}

/** Absolute song placement shared by Web Audio and WAV export, including seeking. */
export function timelinePlacement(clip: TimelineVocal, take: Take, from = 0): { start: number; offset: number; duration: number } {
  const placement = vocalPlacement(clip, take, clip.durationSeconds);
  const originalStart = clip.startSeconds + placement.start;
  const skipped = Math.max(0, from - originalStart);
  return { start: Math.max(from, originalStart), offset: placement.offset + skipped, duration: Math.max(0, placement.duration - skipped) };
}
