import { PACKS, ROLES } from './catalog';
import type { LoopId, PackId, Role } from './catalog';

export const MAX_PARTS = 8;
export interface Mix {
  loops: Record<Role, LoopId | null>;
  levels: Record<Role, number>;
}
export interface VocalClip { takeId: string; volume: number; shiftMs: number }
export interface SongPart { id: string; name: string; bars: 4 | 8; mix: Mix; vocal: VocalClip | null }
export interface Project { version: 2; pack: PackId; name: string; bpm: number; beatLevel: number; mix: Mix; song: SongPart[] }
export interface Studio { version: 2; currentPack: PackId; projects: Record<PackId, Project> }

export function clone<T>(value: T): T { return structuredClone(value); }

export function makeProject(pack: PackId): Project {
  const mix: Mix = {
    loops: { drums: `${pack}-drums-1`, bass: `${pack}-bass-1`, hook: `${pack}-hook-1`, perc: null },
    levels: { drums: 0.9, bass: 0.8, hook: 0.75, perc: 0.65 },
  };
  const intro = clone(mix);
  intro.loops.bass = null;
  intro.loops.hook = null;
  const beat = clone(mix);
  beat.loops.hook = null;
  return {
    version: 2, pack, name: PACKS[pack].projectName, bpm: PACKS[pack].bpm, beatLevel: 1, mix,
    song: [
      { id: 'intro', name: 'Intro', bars: 4, mix: intro, vocal: null },
      { id: 'beat', name: 'Strophe', bars: 8, mix: beat, vocal: null },
      { id: 'hook', name: 'Refrain', bars: 8, mix: clone(mix), vocal: null },
    ],
  };
}

export function makeStudio(): Studio {
  return { version: 2, currentPack: 'hiphop', projects: { hiphop: makeProject('hiphop'), techno: makeProject('techno') } };
}

export function hasVocals(project: Project): boolean { return project.song.some(part => part.vocal !== null); }
export function takeIds(project: Project): string[] { return [...new Set(project.song.flatMap(part => part.vocal ? [part.vocal.takeId] : []))]; }

/** One loop per musical role keeps the combinations understandable and in tune. */
export function toggleLoop(mix: Mix, role: Role, id: LoopId): Mix {
  const next = clone(mix);
  next.loops[role] = next.loops[role] === id ? null : id;
  return next;
}

export function activeCount(mix: Mix): number { return ROLES.filter(role => mix.loops[role]).length; }
export function totalBars(project: Project): number { return project.song.reduce((sum, part) => sum + part.bars, 0); }
export function durationSeconds(project: Project): number { return totalBars(project) * 240 / project.bpm; }

export function partAtBar(song: SongPart[], bar: number): number {
  let end = 0;
  return song.findIndex(part => { end += part.bars; return bar < end; });
}

/** Use the audio clock, with a short margin for commands near a bar boundary. */
export function nextBarTime(now: number, start: number, barDuration: number): number {
  return start + Math.max(0, Math.ceil((now + 0.025 - start) / barDuration)) * barDuration;
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function validMix(value: unknown, pack: PackId): value is Mix {
  if (!record(value) || !record(value.loops) || !record(value.levels)) return false;
  const loops = value.loops;
  const levels = value.levels;
  return ROLES.every(role => {
    const id = loops[role];
    const level = levels[role];
    return (id === null || PACKS[pack].loops.some(loop => loop.id === id && loop.role === role))
      && typeof level === 'number' && Number.isFinite(level) && level >= 0 && level <= 1;
  });
}

export function validProject(value: unknown, pack: PackId): value is Project {
  if (!record(value) || value.version !== 2 || value.pack !== pack) return false;
  if (typeof value.beatLevel !== 'number' || !Number.isFinite(value.beatLevel) || value.beatLevel < 0 || value.beatLevel > 1) return false;
  if (typeof value.name !== 'string' || value.name.length > 48 || !value.name.trim()) return false;
  if (typeof value.bpm !== 'number' || !Number.isInteger(value.bpm) || value.bpm < PACKS[pack].minBpm || value.bpm > PACKS[pack].maxBpm) return false;
  if (!validMix(value.mix, pack) || !Array.isArray(value.song) || value.song.length > MAX_PARTS) return false;
  const ids = new Set<string>();
  return value.song.every(part => {
    if (!record(part) || typeof part.id !== 'string' || !part.id || part.id.length > 64 || ids.has(part.id)) return false;
    ids.add(part.id);
    return typeof part.name === 'string' && part.name.trim().length > 0 && part.name.length <= 24
      && (part.bars === 4 || part.bars === 8) && validMix(part.mix, pack) && validVocal(part.vocal);
  });
}

function validVocal(value: unknown): value is VocalClip | null {
  return value === null || (record(value)
    && typeof value.takeId === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(value.takeId)
    && typeof value.volume === 'number' && Number.isFinite(value.volume) && value.volume >= 0 && value.volume <= 1
    && typeof value.shiftMs === 'number' && Number.isInteger(value.shiftMs) && Math.abs(value.shiftMs) <= 250);
}

/** Upgrade beat-only files without changing their existing parts or mixes. */
export function parseProject(value: unknown): Project | null {
  if (!record(value) || (value.pack !== 'hiphop' && value.pack !== 'techno')) return null;
  const upgraded = value.version === 1 && Array.isArray(value.song)
    ? { ...value, version: 2, beatLevel: 1, song: value.song.map(part => record(part) ? { ...part, vocal: null } : part) }
    : value;
  return validProject(upgraded, value.pack) ? upgraded : null;
}

export function parseStudio(serialized: string): Studio | null {
  try {
    const value: unknown = JSON.parse(serialized);
    if (!record(value) || (value.version !== 1 && value.version !== 2) || (value.currentPack !== 'hiphop' && value.currentPack !== 'techno') || !record(value.projects)) return null;
    const hiphop = parseProject(value.projects.hiphop);
    const techno = parseProject(value.projects.techno);
    return hiphop?.pack === 'hiphop' && techno?.pack === 'techno' ? { version: 2, currentPack: value.currentPack, projects: { hiphop, techno } } : null;
  } catch { return null; }
}
