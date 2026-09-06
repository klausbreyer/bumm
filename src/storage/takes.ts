import { takeIds } from '../music/project';
import type { Project } from '../music/project';
import { validTake } from '../music/vocals';
import type { Take, TakeLibrary } from '../music/vocals';

/** Audio stays in IndexedDB. Project metadata contains only stable take IDs. */
export class TakeStore {
  private database?: Promise<IDBDatabase>;
  private cache = new Map<string, Take>();

  private open(): Promise<IDBDatabase> {
    if (!this.database) {
      this.database = new Promise((resolve, reject) => {
        const request = indexedDB.open('bumm-audio', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('takes', { keyPath: 'id' });
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(new Error('Aufnahmen können hier nicht gespeichert werden. Prüfe den freien Speicher und die Browser-Einstellungen.'));
        request.onblocked = () => reject(new Error('Bitte schließe andere BUMM-Tabs und versuche es nochmal.'));
      });
      this.database.catch(() => { this.database = undefined; });
    }
    return this.database;
  }

  async putAll(takes: Take[]): Promise<void> {
    if (!takes.length) return;
    if (takes.some(take => !validTake(take))) throw new Error('Eine Aufnahme enthält ungültige Audiodaten.');
    const database = await this.open();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('takes', 'readwrite');
      for (const take of takes) transaction.objectStore('takes').put(take);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(new Error('Die Aufnahme konnte nicht gespeichert werden. Eventuell ist der Gerätespeicher voll.'));
      transaction.onabort = () => reject(new Error('Das Speichern wurde abgebrochen. Deine vorige Aufnahme bleibt erhalten.'));
    });
    for (const take of takes) this.cache.set(take.id, take);
  }

  async get(id: string): Promise<Take> {
    if (this.cache.has(id)) return this.cache.get(id)!;
    const database = await this.open();
    const take = await new Promise<Take | undefined>((resolve, reject) => {
      const request = database.transaction('takes').objectStore('takes').get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('Die Aufnahme konnte nicht gelesen werden.'));
    });
    if (!take || !validTake(take)) throw new Error('Eine Aufnahme fehlt auf diesem Gerät. Bitte lade die vollständige Projektdatei.');
    this.cache.set(id, take);
    return take;
  }

  async forProject(project: Project): Promise<TakeLibrary> {
    const takes = await Promise.all(takeIds(project).map(id => this.get(id)));
    return Object.fromEntries(takes.map(take => [take.id, take]));
  }
}
