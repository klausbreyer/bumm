import type { LoopBank } from '../music/render';
import type { Project } from '../music/project';
import type { PackId } from '../music/catalog';
import type { RenderRequest } from './render-worker';
import type { TakeLibrary } from '../music/vocals';

export class BankClient {
  private worker = new Worker(new URL('./render-worker.ts',import.meta.url),{ type:'module' });
  private nextId = 0;
  private pending = new Map<number,{ resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private failed = false;

  constructor() {
    this.worker.onmessage = (event: MessageEvent<{ id:number; value?:unknown; error?:string }>) => {
      const task = this.pending.get(event.data.id);
      if (!task) return;
      this.pending.delete(event.data.id);
      if (event.data.error) task.reject(new Error(event.data.error));
      else task.resolve(event.data.value);
    };
    this.worker.onerror = () => {
      this.failed = true;
      this.pending.forEach(task => task.reject(new Error('Die Sounds konnten nicht geladen werden. Bitte lade die Seite neu.')));
      this.pending.clear();
    };
  }

  private request<T>(data: Omit<Extract<RenderRequest,{ type:'bank' }>, 'id'> | Omit<Extract<RenderRequest,{ type:'wav' }>, 'id'>): Promise<T> {
    if (this.failed) return Promise.reject(new Error('Bitte lade die Seite neu, um die Sounds zu starten.'));
    const id = ++this.nextId;
    return new Promise<T>((resolve,reject) => {
      this.pending.set(id,{ resolve:value => resolve(value as T),reject });
      this.worker.postMessage({ ...data,id });
    });
  }

  getBank(pack: PackId,bpm: number): Promise<LoopBank> { return this.request({ type:'bank',pack,bpm }); }
  getWav(project: Project, takes: TakeLibrary = {}): Promise<ArrayBuffer> { return this.request({ type:'wav',project,takes }); }
}
