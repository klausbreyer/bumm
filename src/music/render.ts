import { PACKS } from './catalog';
import type { Loop, LoopId, PackId } from './catalog';
import { ROLES } from './catalog';
import { totalBars } from './project';
import type { Project } from './project';

export const SAMPLE_RATE = 44100;
export const MASTER_GAIN = 0.68;
export interface Stereo { left: Float32Array<ArrayBuffer>; right: Float32Array<ArrayBuffer> }
export interface LoopBank { sampleRate: number; frames: number; loops: Record<LoopId, Stereo> }
type Voice = 'kick' | 'snare' | 'clap' | 'hat' | 'openhat' | 'sub' | 'pluck' | 'keys' | 'acid' | 'bell' | 'tick';
interface Note { step: number; voice: Voice; midi: number; duration: number; gain: number; pan: number }
const TAU = Math.PI * 2;

function random(seed: number): () => number {
  let state = seed | 0;
  return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296 * 2 - 1; };
}

/** Original four-bar patterns. Each pack shares a chord progression and tempo. */
function score(loop: Loop, pack: PackId): Note[] {
  const notes: Note[] = [];
  const techno = pack === 'techno';
  const second = loop.variant === 2;
  const roots = techno ? [33, 33, 29, 31] : [38, 38, 34, 36];
  const chords = techno ? [[69,72,76],[69,72,79],[65,69,72],[67,71,74]] : [[62,65,69],[62,65,72],[65,70,74],[64,67,72]];
  const add = (step: number, voice: Voice, midi: number, duration: number, gain = 1, pan = 0) => notes.push({ step, voice, midi, duration, gain, pan });
  for (let bar = 0; bar < 4; bar++) {
    const b = bar * 16;
    const root = roots[bar];
    const chord = chords[bar];
    if (loop.role === 'drums') {
      const kicks = techno ? [0,4,8,12] : second ? [0,7,10,14] : [0,6,8,...(bar % 2 ? [11,14] : [14])];
      for (const step of kicks) add(b + step, 'kick', techno ? 33 : 35, techno ? 2.3 : 2.9, step === 0 ? 1 : 0.89);
      for (const step of [4,12]) {
        add(b + step + (techno ? 0 : .09), second ? 'snare' : 'clap', 50, 1.1, .72);
        if (!techno) add(b + step, 'snare', 50, .9, .28);
      }
      for (let step = 0; step < 16; step += techno ? 4 : 2) {
        add(b + step + (techno ? 2 : step % 4 === 2 ? .15 : 0), techno ? 'openhat' : 'hat', 80, techno ? .85 : .37, techno ? .24 : step % 4 === 0 ? .3 : .19, step % 4 ? .3 : -.3);
      }
      if (second) for (const step of [3,11,15]) add(b + step + .06, 'hat', 80, .25, .12, -.45);
    } else if (loop.role === 'bass') {
      if (techno) {
        const steps = second ? [0,2,3,6,8,10,11,14] : [2,6,10,14];
        steps.forEach((step, i) => add(b + step, second ? 'acid' : 'sub', root + (second && i % 4 === 3 ? 12 : 0), second ? 1.1 : 1.75, .8));
      } else {
        const steps = second ? [0,3,6,8,11,14] : [0,6,8,14];
        steps.forEach((step, i) => add(b + step + (step % 2 ? .1 : 0), second ? 'pluck' : 'sub', root + (second && i === 4 ? 12 : 0), second ? 1.7 : step === 0 ? 5.4 : 1.9, .85));
      }
    } else if (loop.role === 'hook') {
      if (second) {
        for (const step of techno ? [0,6,10] : [0,7,12]) {
          chord.forEach((midi, i) => add(b + step + i * .035, 'keys', midi, techno ? 3.8 : 4.1, .38, (i-1)*.4));
        }
        add(b + 14, 'bell', chord[1] + 12, 2.2, .15, .4);
      } else {
        const rhythm = techno ? [0,2,4,6,8,10,12,14] : [0,3,6,8,11,14];
        const phrase = techno ? [0,1,2,1,0,1,2,1] : [0,2,1,0,1,2];
        rhythm.forEach((step, i) => add(b + step + (techno ? 0 : step%2 * .12), 'pluck', chord[phrase[i]] + (techno ? 0 : 12), techno ? 1.35 : 2.6, i===0 ? .65 : .5, i % 2 ? .25 : -.25));
      }
    } else if (second) {
      for (const [i, step] of [2,7,10,15].entries()) add(b + step, techno ? 'pluck' : 'bell', chord[i % 3]+12, 2.3, .28, i%2 ? -.6 : .6);
    } else {
      for (let step=0; step<16; step+=2) add(b+step+.12, techno ? 'hat' : 'tick', 84, .45, step%4 ? .7 : .35, step%4 ? -.6 : .6);
    }
  }
  return notes;
}

function voice(note: Note, beat: number, sampleRate: number, seed: number): Float32Array {
  const seconds = note.duration * beat / 4;
  const length = Math.ceil(seconds * sampleRate);
  const output = new Float32Array(length);
  const noise = random(seed || 123);
  const hz = 440 * 2 ** ((note.midi-69)/12);
  let phase = 0;
  let lastNoise = 0;
  let filtered = 0;
  for (let i=0; i<length; i++) {
    const t = i/sampleRate;
    const progress = i/length;
    const tail = Math.min(1, (length-i)/(sampleRate*.015));
    const n = noise();
    const highNoise = n-lastNoise;
    lastNoise = n;
    let sample = 0;
    switch (note.voice) {
      case 'kick': {
        const frequency = 47 + 112*Math.exp(-t*42);
        phase += TAU*frequency/sampleRate;
        sample = Math.tanh(Math.sin(phase)*1.8)*Math.exp(-t*8.8) + highNoise*.15*Math.exp(-t*180);
        break;
      }
      case 'snare':
        sample = (Math.sin(TAU*185*t)*.4+Math.sin(TAU*330*t)*.15)*Math.exp(-t*25) + highNoise*.52*Math.exp(-t*20);
        break;
      case 'clap': {
        const burst = Math.exp(-t*90) + (t>.011 ? .8*Math.exp(-(t-.011)*100) : 0) + (t>.024 ? Math.exp(-(t-.024)*24) : 0);
        filtered += .38*(n-filtered);
        sample = (n-filtered)*burst*.9;
        break;
      }
      case 'hat': case 'openhat': {
        const metallic = Math.sin(TAU*7311*t)*Math.sin(TAU*5137*t)*.2;
        sample = (highNoise*.43+metallic)*Math.exp(-t*(note.voice==='hat'?65:19))*Math.min(1,t*1800);
        break;
      }
      case 'sub': {
        const pitch = hz*(1+.11*Math.exp(-t*32));
        phase += TAU*pitch/sampleRate;
        const fundamental = Math.sin(phase);
        sample = (Math.tanh(fundamental*1.45)*.8+Math.sin(phase*2)*.13+Math.sin(phase*3)*.06)*Math.min(1,t*130)*Math.exp(-progress*1.9);
        break;
      }
      case 'pluck': {
        phase += TAU*hz/sampleRate;
        sample = (Math.sin(phase)+Math.sin(phase*2+.1)*.36*Math.exp(-t*9)+Math.sin(phase*3)*.19*Math.exp(-t*14)+Math.sin(phase*1.003)*.25)*Math.exp(-progress*4.2)*Math.min(1,t*300);
        break;
      }
      case 'keys': {
        const fm = Math.sin(TAU*hz*2*t)*1.5*Math.exp(-t*5);
        sample = (Math.sin(TAU*hz*t+fm)*.67+Math.sin(TAU*hz*1.002*t)*.3)*Math.exp(-progress*3.2)*Math.min(1,t*150);
        break;
      }
      case 'acid': {
        phase += TAU*hz/sampleRate;
        let saw = 0;
        const bright = .22+.68*Math.exp(-t*18);
        for (let harmonic=1; harmonic<=8; harmonic++) saw += Math.sin(phase*harmonic)/harmonic * bright**(harmonic-1);
        sample = Math.tanh(saw*2)*.75*Math.min(1,t*400)*Math.exp(-progress*2.3);
        break;
      }
      case 'bell':
        sample = (Math.sin(TAU*hz*t)*.7+Math.sin(TAU*hz*2.76*t)*.28*Math.exp(-t*8))*Math.exp(-progress*4)*Math.min(1,t*300);
        break;
      case 'tick':
        sample = (Math.sin(TAU*1800*t)*.7+highNoise*.25)*Math.exp(-t*95)*Math.min(1,t*1200);
        break;
    }
    output[i] = sample*tail*note.gain;
  }
  return output;
}

function renderLoop(loop: Loop, pack: PackId, bpm: number, frames: number, sampleRate: number): Stereo {
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  const beat = 60/bpm;
  score(loop,pack).forEach((note,index) => {
    const samples = voice(note,beat,sampleRate,12345+index*139+loop.variant*8191);
    const start = Math.round(note.step*frames/64);
    const leftGain = Math.sqrt((1-note.pan)/2);
    const rightGain = Math.sqrt((1+note.pan)/2);
    for (let i=0;i<samples.length;i++) {
      const frame = (start+i)%frames;
      left[frame] += samples[i]*leftGain;
      right[frame] += samples[i]*rightGain;
    }
  });
  if (loop.role === 'hook' || (loop.role === 'perc' && loop.variant === 2)) {
    const dryLeft = left.slice();
    const dryRight = right.slice();
    for (let echo=1;echo<=3;echo++) {
      const delay = Math.round(beat*.75*sampleRate*echo);
      const gain = .27**echo;
      for (let i=0;i<frames;i++) {
        const dest = (i+delay)%frames;
        left[dest] += dryRight[i]*gain;
        right[dest] += dryLeft[i]*gain;
      }
    }
  }
  let peak = 0;
  for (let i=0;i<frames;i++) peak = Math.max(peak,Math.abs(left[i]),Math.abs(right[i]));
  const target = { drums: .58, bass: .4, hook: .31, perc: .17 }[loop.role];
  const scale = peak ? target/peak : 0;
  for (let i=0;i<frames;i++) { left[i] *= scale; right[i] *= scale; }
  return { left, right };
}

/** Pure PCM rendering runs in a worker and can be reused without DOM or Web Audio. */
export function renderBank(pack: PackId, bpm: number, sampleRate = SAMPLE_RATE): LoopBank {
  const frames = Math.round(16*60/bpm*sampleRate);
  const loops = Object.fromEntries(PACKS[pack].loops.map(loop => [loop.id, renderLoop(loop,pack,bpm,frames,sampleRate)])) as Record<LoopId,Stereo>;
  return { sampleRate, frames, loops };
}

/** Write PCM directly into the WAV buffer to bound memory use on mobile devices. */
export function renderWav(project: Project, bank: LoopBank): ArrayBuffer {
  const frames = totalBars(project)*bank.frames/4;
  const frameCount = Math.round(frames);
  const output = new ArrayBuffer(44+frameCount*4);
  const view = new DataView(output);
  const text = (at: number, value: string) => [...value].forEach((char,i) => view.setUint8(at+i,char.charCodeAt(0)));
  text(0,'RIFF'); view.setUint32(4,36+frameCount*4,true); text(8,'WAVE'); text(12,'fmt ');
  view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,2,true);
  view.setUint32(24,bank.sampleRate,true); view.setUint32(28,bank.sampleRate*4,true);
  view.setUint16(32,4,true); view.setUint16(34,16,true); text(36,'data'); view.setUint32(40,frameCount*4,true);
  let offset = 0;
  for (const part of project.song) {
    const partFrames = part.bars*bank.frames/4;
    const tracks = ROLES.flatMap(role => part.mix.loops[role] ? [{ samples:bank.loops[part.mix.loops[role]!], gain:part.mix.levels[role] }] : []);
    for (let i=0;i<partFrames;i++) {
      let left = 0; let right = 0;
      const position = i%bank.frames;
      for (const track of tracks) { left += track.samples.left[position]*track.gain; right += track.samples.right[position]*track.gain; }
      const fade = Math.min(1,i/(bank.sampleRate*.006),(partFrames-i-1)/(bank.sampleRate*.006));
      view.setInt16(44+(offset+i)*4,Math.round(Math.max(-1,Math.min(1,left*MASTER_GAIN*fade))*32767),true);
      view.setInt16(46+(offset+i)*4,Math.round(Math.max(-1,Math.min(1,right*MASTER_GAIN*fade))*32767),true);
    }
    offset += partFrames;
  }
  return output;
}
