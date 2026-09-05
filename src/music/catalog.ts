export const ROLES = ['drums', 'bass', 'hook', 'perc'] as const;
export type Role = (typeof ROLES)[number];
export type PackId = 'hiphop' | 'techno';
export type LoopId = `${PackId}-${Role}-${1 | 2}`;

export interface Loop {
  id: LoopId;
  role: Role;
  name: string;
  description: string;
  variant: 1 | 2;
  art: number[];
}

export interface Pack {
  id: PackId;
  name: string;
  bpm: number;
  minBpm: number;
  maxBpm: number;
  key: string;
  projectName: string;
  loops: Loop[];
}

export const ROLE_NAMES: Record<Role, string> = {
  drums: 'Drums', bass: 'Bass', hook: 'Hook', perc: 'Extras',
};

function loop(pack: PackId, role: Role, variant: 1 | 2, name: string, description: string, art: number[]): Loop {
  return { id: `${pack}-${role}-${variant}`, role, variant, name, description, art };
}

export const PACKS: Record<PackId, Pack> = {
  hiphop: {
    id: 'hiphop', name: 'Hip-Hop', bpm: 92, minBpm: 72, maxBpm: 110, key: 'D-Moll', projectName: 'Nachts im Weltall',
    loops: [
      loop('hiphop', 'drums', 1, 'Beton-Kick', 'Trocken. Knackig. Ordentlich Wumms.', [9,2,3,2,7,2,4,2,9,2,3,5,7,2,4,3]),
      loop('hiphop', 'bass', 1, '808-Wolke', 'Der Bass, den du im Bauch fühlst.', [3,5,7,9,8,6,3,1,3,6,8,9,7,5,2,1]),
      loop('hiphop', 'hook', 1, 'Sternenflug', 'Kleine Melodie. Großer Ohrwurm.', [2,2,5,5,8,8,5,5,3,3,7,7,5,5,2,2]),
      loop('hiphop', 'perc', 1, 'Klack-Klack', 'Ein bisschen mehr Bewegung.', [2,7,2,4,2,7,3,5,2,7,2,4,2,8,3,5]),
      loop('hiphop', 'drums', 2, 'Hinterhof', 'Locker im Takt. Mit extra Swing.', [8,2,3,5,7,2,3,2,8,2,5,3,7,3,2,5]),
      loop('hiphop', 'bass', 2, 'Gummibass', 'Hüpft, federt, bleibt im Kopf.', [2,7,5,2,1,8,6,2,2,7,5,2,1,8,6,2]),
      loop('hiphop', 'hook', 2, 'Pixel-Piano', 'Ein Klavier mit Weltraumstaub.', [2,5,8,5,3,7,9,7,2,5,8,5,3,7,5,2]),
      loop('hiphop', 'perc', 2, 'Sternenstaub', 'Leise Glocken aus einer anderen Welt.', [2,3,7,4,2,1,5,3,2,6,8,4,2,3,5,1]),
    ],
  },
  techno: {
    id: 'techno', name: 'Techno', bpm: 128, minBpm: 115, maxBpm: 145, key: 'A-Moll', projectName: 'Raketenstart',
    loops: [
      loop('techno', 'drums', 1, 'Stampfer', 'Vier Kicks. Der Boden wackelt.', [9,2,6,2,9,2,6,2,9,2,6,2,9,2,6,3]),
      loop('techno', 'bass', 1, 'Tiefgarage', 'Tief unten rollt der Bass.', [1,2,7,8,1,2,7,8,1,2,7,8,1,2,7,8]),
      loop('techno', 'hook', 1, 'Laser-Hook', 'Ein Ohrwurm mit Lichtgeschwindigkeit.', [2,5,8,5,2,5,9,5,3,6,8,6,3,6,9,6]),
      loop('techno', 'perc', 1, 'Zischmaschine', 'Mehr Luft für die Tanzfläche.', [2,6,3,8,2,6,3,8,2,6,3,8,2,6,3,8]),
      loop('techno', 'drums', 2, 'Kellerclub', 'Rauer Beat. Große Nacht.', [9,3,5,3,9,3,5,5,9,3,5,3,9,5,5,7]),
      loop('techno', 'bass', 2, 'Säurefrosch', 'Quakt im Takt und hüpft nach vorn.', [2,6,8,3,7,4,9,2,3,7,5,8,2,6,9,3]),
      loop('techno', 'hook', 2, 'Neonregen', 'Warme Akkorde für die große Hook.', [3,7,9,7,4,7,9,7,3,6,8,6,4,6,8,6]),
      loop('techno', 'perc', 2, 'Roboterfunk', 'Kleine Signale von weit, weit weg.', [2,2,8,3,2,6,2,3,2,7,2,3,8,2,5,2]),
    ],
  },
};

export function findLoop(id: LoopId): Loop {
  const pack = id.startsWith('hiphop') ? PACKS.hiphop : PACKS.techno;
  const result = pack.loops.find(loop => loop.id === id);
  if (!result) throw new Error(`Unknown loop: ${id}`);
  return result;
}
