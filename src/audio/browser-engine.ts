import { PACKS } from '../music/catalog';
import type { LoopId, Role } from '../music/catalog';
import { MASTER_GAIN } from '../music/render';
import { clone, nextBarTime, partAtBar, totalBars } from '../music/project';
import type { Mix, Project } from '../music/project';
import { beatGain, requireTakes, VOCAL_GAIN, vocalPlacement } from '../music/vocals';
import type { TakeLibrary } from '../music/vocals';
import { BankClient } from './bank-client';

interface Channel { source: AudioBufferSourceNode; gain: GainNode; role: Role }
export interface Position { bar: number; beat: number; part: number; pending: boolean; countIn: number | null }
export interface Schedule { startTime: number; endTime: number; barDuration: number }
interface StartOptions { recording?: boolean; onScheduled?: (schedule: Schedule) => void }

export class BrowserEngine {
  private context?: AudioContext;
  private master?: GainNode;
  private channels = new Map<LoopId, Channel>();
  private extraSources = new Set<AudioScheduledSourceNode>();
  private epoch = 0;
  private startTime = 0;
  private barDuration = 0;
  private endTime = Infinity;
  private pendingUntil = 0;
  private backingGain = 1;
  private project?: Project;
  private volume = .8;
  mode: 'loops' | 'song' | null = null;
  onStop: ((reason: 'end' | 'interrupted') => void) | null = null;

  constructor(private bank: BankClient) {}

  get clockTime(): number { return this.context?.currentTime ?? 0; }

  /** Call from the user gesture before loading files or requesting the microphone. */
  async unlock(): Promise<AudioContext> {
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: 'interactive' });
      this.master = this.context.createGain();
      this.master.gain.value = MASTER_GAIN * this.volume;
      this.master.connect(this.context.destination);
      this.context.addEventListener('statechange', () => {
        if (this.mode && this.context?.state !== 'running') { this.stop(); this.onStop?.('interrupted'); }
      });
    }
    await this.context.resume();
    return this.context;
  }

  async start(project: Project, mode: 'loops' | 'song', takes: TakeLibrary = {}, options: StartOptions = {}): Promise<boolean> {
    this.stop();
    const epoch = this.epoch;
    const context = await this.unlock();
    if (mode === 'song' && !options.recording) requireTakes(project, takes);
    const bank = await this.bank.getBank(project.pack, project.bpm);
    if (epoch !== this.epoch) return false;
    if (context.state !== 'running') throw new Error('Audio wurde unterbrochen. Bitte drücke nochmal Start.');
    this.barDuration = bank.frames / bank.sampleRate / 4;
    this.startTime = context.currentTime + .12 + (options.recording ? this.barDuration : 0);
    this.endTime = mode === 'song' ? this.startTime + totalBars(project) * this.barDuration : Infinity;
    this.project = clone(project);
    this.backingGain = mode === 'song' ? beatGain(project, options.recording) : 1;
    for (const loop of PACKS[project.pack].loops) {
      const pcm = bank.loops[loop.id];
      const buffer = context.createBuffer(2, bank.frames, bank.sampleRate);
      buffer.copyToChannel(pcm.left, 0); buffer.copyToChannel(pcm.right, 1);
      const source = context.createBufferSource();
      source.buffer = buffer; source.loop = true;
      const gain = context.createGain(); gain.gain.value = 0;
      source.connect(gain).connect(this.master!);
      this.channels.set(loop.id, { source, gain, role: loop.role });
      source.start(this.startTime);
      if (mode === 'song') source.stop(this.endTime);
    }
    this.mode = mode;
    if (mode === 'loops') this.scheduleMix(project.mix, this.startTime, false);
    else {
      let bar = 0;
      for (const part of project.song) {
        const at = this.startTime + bar * this.barDuration;
        this.scheduleMix(part.mix, at, false);
        if (part.vocal && !options.recording) {
          const take = takes[part.vocal.takeId];
          const placement = vocalPlacement(part.vocal, take, part.bars * this.barDuration);
          if (placement.duration > 0) {
            const buffer = context.createBuffer(1, take.samples.length, take.sampleRate);
            buffer.copyToChannel(take.samples, 0);
            const source = context.createBufferSource(); source.buffer = buffer;
            const gain = context.createGain();
            const volume = part.vocal.volume * VOCAL_GAIN / MASTER_GAIN;
            const voiceStart = at + placement.start;
            const voiceEnd = voiceStart + placement.duration;
            const fade = Math.min(.005, placement.duration / 2);
            gain.gain.value = 0;
            gain.gain.setValueAtTime(0, voiceStart);
            gain.gain.linearRampToValueAtTime(volume, voiceStart + fade);
            gain.gain.setValueAtTime(volume, voiceEnd - fade);
            gain.gain.linearRampToValueAtTime(0, voiceEnd);
            source.connect(gain).connect(this.master!);
            this.trackSource(source, gain);
            source.start(at + placement.start, placement.offset, placement.duration);
          }
        }
        bar += part.bars;
      }
      for (const { gain } of this.channels.values()) gain.gain.setTargetAtTime(0, this.endTime - .018, .003);
    }
    if (options.recording) this.countIn();
    options.onScheduled?.({ startTime: this.startTime, endTime: this.endTime, barDuration: this.barDuration });
    return true;
  }

  private trackSource(source: AudioScheduledSourceNode, gain: GainNode): void {
    this.extraSources.add(source);
    source.onended = () => { this.extraSources.delete(source); source.disconnect(); gain.disconnect(); };
  }

  private countIn(): void {
    const context = this.context!;
    for (let beat = 0; beat < 4; beat++) {
      const at = this.startTime - this.barDuration + beat * this.barDuration / 4;
      const source = context.createOscillator(); source.frequency.value = beat === 0 ? 1047 : 784;
      const gain = context.createGain(); gain.gain.value = 0;
      gain.gain.setValueAtTime(.25, at); gain.gain.exponentialRampToValueAtTime(.001, at + .06);
      source.connect(gain).connect(this.master!);
      this.trackSource(source, gain); source.start(at); source.stop(at + .07);
    }
  }

  private scheduleMix(mix: Mix, at: number, replace: boolean): void {
    for (const [id, { gain, role }] of this.channels) {
      if (replace) gain.gain.cancelScheduledValues(at);
      gain.gain.setTargetAtTime(mix.loops[role] === id ? mix.levels[role] * this.backingGain : 0, at, .002);
    }
    if (this.project) this.project.mix = clone(mix);
  }

  setMix(mix: Mix): void {
    if (this.mode !== 'loops' || !this.context) return;
    const at = nextBarTime(this.context.currentTime, this.startTime, this.barDuration);
    this.scheduleMix(mix, at, true); this.pendingUntil = at;
  }

  setVolume(value: number): void {
    this.volume = value;
    if (this.context && this.master) this.master.gain.setTargetAtTime(MASTER_GAIN * value, this.context.currentTime, .015);
  }

  position(): Position | null {
    if (!this.mode || !this.context || !this.project) return null;
    if (this.context.currentTime >= this.endTime) { this.stop(); this.onStop?.('end'); return null; }
    const time = this.context.currentTime - this.startTime;
    const bar = Math.floor(Math.max(0, time) / this.barDuration);
    const countIn = time < -.1 ? Math.max(1, Math.min(4, Math.floor((time + this.barDuration) / (this.barDuration / 4)) + 1)) : null;
    return { bar, beat: countIn !== null ? countIn - 1 : Math.floor(Math.max(0, time) / (this.barDuration / 4)) % 4, part: this.mode === 'song' ? partAtBar(this.project.song, bar) : -1, pending: this.context.currentTime < this.pendingUntil, countIn };
  }

  stop(): void {
    this.epoch++; this.mode = null; this.pendingUntil = 0;
    for (const { source, gain } of this.channels.values()) {
      const now = this.context?.currentTime ?? 0;
      gain.gain.cancelScheduledValues(now); gain.gain.setTargetAtTime(0, now, .008);
      source.stop(now + .04); source.onended = () => { source.disconnect(); gain.disconnect(); };
    }
    for (const source of this.extraSources) source.stop();
    this.extraSources.clear(); this.channels.clear();
  }
}
