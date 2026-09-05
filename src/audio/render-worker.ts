import { renderBank, renderWav } from '../music/render';
import type { LoopBank } from '../music/render';
import type { PackId } from '../music/catalog';
import type { Project } from '../music/project';

export type RenderRequest = { id: number } & ({ type: 'bank'; pack: PackId; bpm: number } | { type: 'wav'; project: Project });
const cache = new Map<string, LoopBank>();

function bank(pack: PackId, bpm: number): LoopBank {
  const key = `${pack}:${bpm}`;
  if (!cache.has(key)) {
    if (cache.size >= 2) cache.delete(cache.keys().next().value!);
    cache.set(key,renderBank(pack,bpm));
  }
  return cache.get(key)!;
}

self.onmessage = (event: MessageEvent<RenderRequest>) => {
  const request = event.data;
  try {
    if (request.type === 'bank') {
      self.postMessage({ id:request.id, value:bank(request.pack,request.bpm) });
    } else {
      const wav = renderWav(request.project,bank(request.project.pack,request.project.bpm));
      self.postMessage({ id:request.id, value:wav },{ transfer:[wav] });
    }
  } catch (error) { self.postMessage({ id:request.id, error: error instanceof Error ? error.message : 'Audio konnte nicht erstellt werden.' }); }
};
