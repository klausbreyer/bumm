import { PACKS } from '../music/catalog';
import type { LoopId, Role } from '../music/catalog';
import { MASTER_GAIN } from '../music/render';
import { clone, nextBarTime, partAtBar, totalBars } from '../music/project';
import type { Mix, Project } from '../music/project';
import { BankClient } from './bank-client';

interface Channel { source: AudioBufferSourceNode; gain: GainNode; role: Role }
export interface Position { bar: number; beat: number; part: number; pending: boolean }

export class BrowserEngine {
  private context?: AudioContext;
  private master?: GainNode;
  private channels = new Map<LoopId,Channel>();
  private epoch = 0;
  private startTime = 0;
  private barDuration = 0;
  private endTime = Infinity;
  private pendingUntil = 0;
  private project?: Project;
  private volume = .8;
  mode: 'loops' | 'song' | null = null;
  onStop: (() => void) | null = null;

  constructor(private bank: BankClient) {}

  async start(project: Project, mode: 'loops'|'song'): Promise<boolean> {
    this.stop();
    const epoch = this.epoch;
    if (!this.context) {
      this.context = new AudioContext({ latencyHint:'interactive' });
      this.master = this.context.createGain();
      this.master.gain.value = MASTER_GAIN*this.volume;
      this.master.connect(this.context.destination);
      this.context.addEventListener('statechange',() => {
        if (this.mode && this.context?.state !== 'running') { this.stop(); this.onStop?.(); }
      });
    }
    // Resume inside the user gesture, before waiting for worker-generated sounds.
    await this.context.resume();
    const bank = await this.bank.getBank(project.pack,project.bpm);
    if (epoch !== this.epoch) return false;
    const context = this.context;
    this.startTime = context.currentTime+.06;
    this.barDuration = bank.frames/bank.sampleRate/4;
    this.endTime = mode==='song' ? this.startTime+totalBars(project)*this.barDuration : Infinity;
    this.project = clone(project);
    for (const loop of PACKS[project.pack].loops) {
      const pcm = bank.loops[loop.id];
      const buffer = context.createBuffer(2,bank.frames,bank.sampleRate);
      buffer.copyToChannel(pcm.left,0);
      buffer.copyToChannel(pcm.right,1);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const gain = context.createGain();
      gain.gain.value = 0;
      source.connect(gain).connect(this.master!);
      this.channels.set(loop.id,{ source,gain,role:loop.role });
      source.start(this.startTime);
      if (mode==='song') source.stop(this.endTime);
    }
    this.mode = mode;
    if (mode==='loops') this.scheduleMix(project.mix,this.startTime,false);
    else {
      let bar = 0;
      for (const part of project.song) {
        this.scheduleMix(part.mix,this.startTime+bar*this.barDuration,false);
        bar += part.bars;
      }
      for (const { gain } of this.channels.values()) gain.gain.setTargetAtTime(0,this.endTime-.018,.003);
    }
    return true;
  }

  private scheduleMix(mix: Mix, at: number, replace: boolean): void {
    for (const [id,{ gain,role }] of this.channels) {
      const parameter = gain.gain;
      if (replace) parameter.cancelScheduledValues(at);
      // Targets can be replaced repeatedly before the boundary without inventing
      // an intermediate gain. The short ramp avoids clicks when a pad changes.
      parameter.setTargetAtTime(mix.loops[role]===id ? mix.levels[role] : 0,at,.002);
    }
    if (this.project) this.project.mix = clone(mix);
  }

  setMix(mix: Mix): void {
    if (this.mode!=='loops' || !this.context) return;
    const at = nextBarTime(this.context.currentTime,this.startTime,this.barDuration);
    this.scheduleMix(mix,at,true);
    this.pendingUntil = at;
  }

  setVolume(value: number): void {
    this.volume = value;
    if (this.context && this.master) this.master.gain.setTargetAtTime(MASTER_GAIN*value,this.context.currentTime,.015);
  }

  position(): Position | null {
    if (!this.mode || !this.context || !this.project) return null;
    if (this.context.currentTime>=this.endTime) { this.stop(); this.onStop?.(); return null; }
    const time = Math.max(0,this.context.currentTime-this.startTime);
    const bar = Math.floor(time/this.barDuration);
    return { bar, beat:Math.floor(time/(this.barDuration/4))%4, part:this.mode==='song' ? partAtBar(this.project.song,bar) : -1, pending:this.context.currentTime<this.pendingUntil };
  }

  stop(): void {
    this.epoch++;
    this.mode = null;
    this.pendingUntil = 0;
    for (const { source,gain } of this.channels.values()) {
      const now = this.context?.currentTime ?? 0;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setTargetAtTime(0,now,.008);
      source.stop(now+.04);
      source.onended = () => { source.disconnect(); gain.disconnect(); };
    }
    this.channels.clear();
  }
}
