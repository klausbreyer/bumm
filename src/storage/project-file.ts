import { clone, MAX_VOCALS, parseProject, takeIds } from '../music/project';
import type { Project } from '../music/project';
import { MAX_TAKE_SECONDS, requireTakes, validTake } from '../music/vocals';
import type { Take, TakeLibrary } from '../music/vocals';

const MAGIC = [66, 85, 77, 77, 2, 0, 0, 0];
export const MAX_PROJECT_BYTES = 190_000_000;
interface Manifest { project: Project; takes: { id: string; sampleRate: number; frames: number }[] }

/** A versioned binary bundle stores JSON metadata and lossless float PCM together. */
export function encodeProject(project: Project, library: TakeLibrary): ArrayBuffer {
  requireTakes(project, library);
  const takes = takeIds(project).map(id => library[id]);
  if (takes.some(take => !validTake(take))) throw new Error('Eine Aufnahme enthält ungültige Audiodaten.');
  const manifest: Manifest = { project, takes: takes.map(take => ({ id: take.id, sampleRate: take.sampleRate, frames: take.samples.length })) };
  const json = new TextEncoder().encode(JSON.stringify(manifest));
  const bytes = 12 + json.length + takes.reduce((sum, take) => sum + take.samples.length * 4, 0);
  if (bytes > MAX_PROJECT_BYTES) throw new Error('Dieses Projekt ist zu groß für eine einzelne Datei.');
  const output = new ArrayBuffer(bytes);
  const view = new DataView(output);
  MAGIC.forEach((value, i) => view.setUint8(i, value));
  view.setUint32(8, json.length, true);
  new Uint8Array(output, 12, json.length).set(json);
  let offset = 12 + json.length;
  for (const take of takes) for (const sample of take.samples) { view.setFloat32(offset, sample, true); offset += 4; }
  return output;
}

export function decodeProject(input: ArrayBuffer): { project: Project; takes: Take[] } {
  if (input.byteLength > MAX_PROJECT_BYTES) throw new Error('Diese Projektdatei ist zu groß.');
  const bytes = new Uint8Array(input);
  if (!MAGIC.every((value, i) => bytes[i] === value)) {
    if (input.byteLength > 250_000) throw new Error('Das ist keine passende BUMM-Projektdatei.');
    const project = parseProject(JSON.parse(new TextDecoder().decode(bytes)));
    if (!project || takeIds(project).length) throw new Error('Bitte lade eine vollständige BUMM-Datei mit ihren Aufnahmen.');
    return { project, takes: [] };
  }
  if (input.byteLength < 12) throw new Error('Die Projektdatei ist unvollständig.');
  const view = new DataView(input);
  const jsonSize = view.getUint32(8, true);
  if (jsonSize > 250_000 || 12 + jsonSize > input.byteLength) throw new Error('Die Projektdatei ist beschädigt.');
  const manifest = JSON.parse(new TextDecoder().decode(new Uint8Array(input, 12, jsonSize))) as Manifest;
  const project = parseProject(manifest?.project);
  if (!project || !Array.isArray(manifest.takes) || manifest.takes.length > MAX_VOCALS) throw new Error('Die Projektdatei ist nicht lesbar.');
  const ids = new Set<string>();
  let offset = 12 + jsonSize;
  const takes: Take[] = manifest.takes.map(meta => {
    if (!meta || typeof meta.id !== 'string' || ids.has(meta.id) || !Number.isInteger(meta.sampleRate) || meta.sampleRate < 8000 || meta.sampleRate > 192000
      || !Number.isInteger(meta.frames) || meta.frames <= 0 || meta.frames > meta.sampleRate * MAX_TAKE_SECONDS || offset + meta.frames * 4 > input.byteLength) throw new Error('Die Audiodaten sind unvollständig oder ungültig.');
    ids.add(meta.id);
    const samples = new Float32Array(meta.frames);
    for (let i = 0; i < samples.length; i++) { samples[i] = view.getFloat32(offset, true); offset += 4; }
    const take = { id: meta.id, sampleRate: meta.sampleRate, samples };
    if (!validTake(take)) throw new Error('Die Aufnahme enthält ungültige Audiodaten.');
    return take;
  });
  if (offset !== input.byteLength || takeIds(project).length !== takes.length) throw new Error('Die Projektdatei enthält unerwartete Daten.');
  requireTakes(project, Object.fromEntries(takes.map(take => [take.id, take])));
  return { project, takes };
}

/** Imported IDs never overwrite audio still referenced by another project or undo. */
export function remapImported(project: Project, takes: Take[], newId: () => string): { project: Project; takes: Take[] } {
  const copy = clone(project);
  const ids = new Map(takes.map(take => [take.id, newId()]));
  for (const clip of copy.vocals) clip.takeId = ids.get(clip.takeId)!;
  return { project: copy, takes: takes.map(take => ({ ...take, id: ids.get(take.id)! })) };
}
