import { describe, expect, test } from 'bun:test';
import { PACKS, ROLES } from '../src/music/catalog';
import { clone, makeProject, makeStudio, nextBarTime, parseStudio, partAtBar, toggleLoop, totalBars, validProject } from '../src/music/project';
import { MASTER_GAIN, renderBank, renderWav } from '../src/music/render';

describe('Portable song model',()=>{
  test('a role has one loop, and tapping the selected loop removes it',()=>{
    const project=makeProject('hiphop');
    const next=toggleLoop(project.mix,'drums','hiphop-drums-2');
    expect(next.loops.drums).toBe('hiphop-drums-2');
    expect(next.loops.bass).toBe(project.mix.loops.bass);
    expect(project.mix.loops.drums).toBe('hiphop-drums-1');
    expect(toggleLoop(next,'drums','hiphop-drums-2').loops.drums).toBeNull();
  });

  test('saved song parts have independent mixes',()=>{
    const project=makeProject('hiphop');
    project.mix.levels.drums=0;
    project.mix.loops.hook=null;
    expect(project.song[2].mix.levels.drums).toBe(.9);
    expect(project.song[2].mix.loops.hook).toBe('hiphop-hook-1');
    expect(project.song[0].mix.loops.bass).toBeNull();
  });

  test('project files round-trip, preserving both genres',()=>{
    const studio=makeStudio();
    studio.projects.techno.bpm=137;
    studio.projects.hiphop.name='Mein eigener Song';
    expect(parseStudio(JSON.stringify(studio))).toEqual(studio);
  });

  test('rejects corrupt files, cross-pack loops, invalid levels, duplicate parts and unknown versions',()=>{
    expect(parseStudio('{')).toBeNull();
    for (const change of [
      (p:any)=>{p.mix.loops.drums='techno-drums-1';},
      (p:any)=>{p.mix.loops.drums='hiphop-bass-1';},
      (p:any)=>{p.mix.levels.bass=4;},
      (p:any)=>{p.song[1].id=p.song[0].id;},
      (p:any)=>{p.song[1].bars=3;},
      (p:any)=>{p.bpm=0;},
      (p:any)=>{p.version=7;},
      (p:any)=>{p.song=Array.from({length:9},(_,i)=>({...p.song[0],id:String(i)}));},
    ]) {
      const project=makeProject('hiphop');
      change(project);
      expect(validProject(project,'hiphop')).toBe(false);
    }
  });

  test('scene boundaries and the song end are unambiguous',()=>{
    const p=makeProject('hiphop');
    expect([0,3,4,11,12,19,20].map(bar=>partAtBar(p.song,bar))).toEqual([0,0,1,1,2,2,-1]);
    expect(totalBars(p)).toBe(20);
  });

  test('loop changes use the next audio-clock bar, including near-boundary commands',()=>{
    expect(nextBarTime(10.2,10,2)).toBe(12);
    expect(nextBarTime(11.99,10,2)).toBe(14);
    expect(nextBarTime(9.9,10,2)).toBe(10);
  });
});

describe('Original sounds and audio export',()=>{
  const rate=22050;
  const hiphop=renderBank('hiphop',92,rate);
  const techno=renderBank('techno',128,rate);

  test('all loops have matching lengths, finite stereo audio and useful signal levels',()=>{
    for (const [id,bank] of [['hiphop',hiphop],['techno',techno]] as const) {
      expect(bank.frames/rate).toBeCloseTo(16*60/PACKS[id].bpm,3);
      for (const loop of PACKS[id].loops) {
        const pcm=bank.loops[loop.id];
        expect(pcm.left.length).toBe(bank.frames);
        expect(pcm.right.length).toBe(bank.frames);
        let power=0;
        let peak=0;
        for (let i=0;i<bank.frames;i++) {
          if (!Number.isFinite(pcm.left[i])||!Number.isFinite(pcm.right[i])) throw new Error(`Invalid sample in ${loop.id}`);
          power+=pcm.left[i]**2;
          peak=Math.max(peak,Math.abs(pcm.left[i]),Math.abs(pcm.right[i]));
        }
        expect(Math.sqrt(power/bank.frames)).toBeGreaterThan(.003);
        expect(peak).toBeLessThan(.59);
      }
    }
  });

  test('all four roles together retain headroom, even at full channel volume',()=>{
    for (const bank of [hiphop,techno]) {
      const pack=bank===hiphop?PACKS.hiphop:PACKS.techno;
      let worstPeak=0;
      for (let i=0;i<bank.frames;i++) {
        for (const side of ['left','right'] as const) {
          const absoluteSum=ROLES.reduce((sum,role)=>sum+Math.max(...pack.loops.filter(loop=>loop.role===role).map(loop=>Math.abs(bank.loops[loop.id][side][i]))),0);
          worstPeak=Math.max(worstPeak,absoluteSum*MASTER_GAIN);
        }
      }
      expect(worstPeak).toBeLessThan(1);
    }
  });

  test('WAV exports the arrangement in order, including an intentionally silent part',()=>{
    const p=makeProject('hiphop');
    p.song=[clone(p.song[0]),clone(p.song[1])];
    p.song[0].bars=4;
    p.song[1].bars=4;
    for (const role of ROLES) p.song[0].mix.loops[role]=null;
    const wav=renderWav(p,hiphop);
    const view=new DataView(wav);
    const text=(at:number,len:number)=>String.fromCharCode(...new Uint8Array(wav,at,len));
    expect(text(0,4)).toBe('RIFF');
    expect(text(8,4)).toBe('WAVE');
    expect(view.getUint16(22,true)).toBe(2);
    expect(view.getUint32(24,true)).toBe(rate);
    expect(view.getUint16(34,true)).toBe(16);
    expect(wav.byteLength).toBe(44+hiphop.frames*2*4);
    let silencePeak=0;
    let beatPeak=0;
    for (let i=0;i<hiphop.frames;i++) {
      silencePeak=Math.max(silencePeak,Math.abs(view.getInt16(44+i*4,true)));
      beatPeak=Math.max(beatPeak,Math.abs(view.getInt16(44+(hiphop.frames+i)*4,true)));
    }
    expect(silencePeak).toBe(0);
    expect(beatPeak).toBeGreaterThan(3000);
    expect(view.getInt16(wav.byteLength-4,true)).toBe(0);
  });

  test('sounds are deterministic, so reopened projects retain their sound',()=>{
    const second=renderBank('hiphop',92,rate);
    expect(second.loops['hiphop-hook-1'].left).toEqual(hiphop.loops['hiphop-hook-1'].left);
    expect(second.loops['hiphop-hook-2'].left).not.toEqual(hiphop.loops['hiphop-hook-1'].left);
  });
});
