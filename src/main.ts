import '@fontsource/barlow/latin-400.css';
import '@fontsource/barlow/latin-500.css';
import '@fontsource/barlow/latin-600.css';
import '@fontsource/barlow/latin-700.css';
import '@fontsource/barlow-condensed/latin-700.css';
import '@fontsource/barlow-condensed/latin-800.css';
import './style.css';
import { PACKS, ROLES, ROLE_NAMES, findLoop } from './music/catalog';
import type { Loop, LoopId, PackId, Role } from './music/catalog';
import { MAX_PARTS, activeCount, clone, durationSeconds, makeStudio, parseStudio, toggleLoop, hasVocals } from './music/project';
import type { Mix, Project, Studio } from './music/project';
import { BankClient } from './audio/bank-client';
import { BrowserEngine } from './audio/browser-engine';
import { MicrophoneRecorder, microphoneError, RecordingCancelled } from './audio/microphone-recorder';
import { TakeStore } from './storage/takes';
import { decodeProject, encodeProject, MAX_PROJECT_BYTES, remapImported } from './storage/project-file';
import { waveform } from './music/vocals';
import type { Take } from './music/vocals';
import { vocalWorkspace } from './ui/vocal-workspace';
import type { RecordingSession } from './ui/vocal-workspace';

const STORAGE_KEY = 'bumm.studio.v2';
const app = document.querySelector<HTMLDivElement>('#app')!;
const bank = new BankClient();
const audio = new BrowserEngine(bank);
const takes = new TakeStore();
const microphone = new MicrophoneRecorder();
const waves = new Map<string, number[]>();
let selectedVocalId: string | null = 'hook';
let recording: RecordingSession | null = null;
let recordGeneration = 0;
let playGeneration = 0;
let fileBusy = false;
let previewPartId: string | null = null;
let studio = makeStudio();
let saveState: 'saved'|'unavailable'|'invalid' = 'saved';
let view: 'loops'|'song' = 'loops';
let editingId: string | null = null;
let busy = false;
let exporting = false;
let masterVolume = 80;
let history: Studio[] = [];
let editBaseline: Studio | null = null;
let toastTimer = 0;
let lastPosition = '';

try {
  const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem('bumm.studio.v1');
  if (raw) {
    const saved = parseStudio(raw);
    if (saved) studio = saved;
    else saveState = 'invalid';
  }
} catch { saveState = 'unavailable'; }

function project(): Project { return studio.projects[studio.currentPack]; }
function esc(value: string): string { return value.replace(/[&<>"']/g,char => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[char]!); }
function disabled(value: boolean): string { return value ? 'disabled' : ''; }
function time(seconds: number): string { const rounded=Math.round(seconds); return `${Math.floor(rounded/60)}:${String(rounded%60).padStart(2,'0')}`; }
function locked(): boolean { return busy || fileBusy || recording !== null || audio.mode==='song'; }
function save(): void {
  try { localStorage.setItem(STORAGE_KEY,JSON.stringify(studio)); saveState='saved'; }
  catch { saveState='unavailable'; }
  updateSaveLabel();
}
function remember(snapshot = clone(studio)): void {
  history.push(snapshot);
  if (history.length>35) history.shift();
}
function mutate(action: () => void, syncMix = false): void {
  remember();
  action();
  if (syncMix && editingId) {
    const part = project().song.find(part => part.id===editingId);
    if (part) part.mix=clone(project().mix);
  }
  save();
  if (syncMix) audio.setMix(project().mix);
  render();
}
function announce(message: string, error = false): void {
  const toast = document.querySelector<HTMLDivElement>('#toast')!;
  clearTimeout(toastTimer);
  toast.textContent=message;
  toast.classList.toggle('error',error);
  toast.hidden=false;
  toastTimer=window.setTimeout(()=>{ toast.hidden=true; },error ? 9000 : 4200);
}

const paths: Record<string,string> = {
  play:'<path d="m8 5 11 7-11 7z" fill="currentColor" stroke="none"/>',
  stop:'<rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor" stroke="none"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
  undo:'<path d="M4 10h10a6 6 0 0 1 0 12M4 10l5-5M4 10l5 5" transform="translate(0 -2)"/>',
  arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>',
  left:'<path d="m14 6-6 6 6 6"/>',
  right:'<path d="m10 6 6 6-6 6"/>',
  down:'<path d="M12 3v12m-5-5 5 5 5-5M5 17v4h14v-4"/>',
  volume:'<path d="m11 5-6 4H2v6h3l6 4V5zm4 3a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  edit:'<path d="m5 15 10-10 4 4L9 19H5v-4zm8-8 4 4"/>',
  trash:'<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6"/>',
  copy:'<rect x="8" y="8" width="12" height="12" rx="1"/><path d="M15 8V4H4v11h4"/>',
  spark:'<path d="m12 2 2.7 7.3L22 12l-7.3 2.7L12 22l-2.7-7.3L2 12l7.3-2.7z"/>',
  mic:'<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/>',
  pads:'<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
  song:'<path d="M3 5h18M3 12h18M3 19h18M7 2v6m8 1v6m-4 1v6"/>',
  folder:'<path d="M3 5h7l3 3h8v12H3z"/>',
  save:'<path d="M4 4h13l3 3v13H4V4zm4 0v6h8V4M8 20v-7h8v7"/>',
};
function icon(name: string,extra = ''): string { return `<svg class="icon ${extra}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]??paths.spark}</svg>`; }

function wave(loop: Loop): string {
  if (loop.role==='bass') return `<svg class="wave" viewBox="0 0 240 64" aria-hidden="true"><path d="M0 32C10 32 12 6 24 6S38 58 48 58S62 6 72 6S86 58 96 58S110 6 120 6S134 58 144 58S158 6 168 6S182 58 192 58S206 6 216 6S230 32 240 32" fill="none" stroke="currentColor" stroke-width="3.5"/></svg>`;
  return `<svg class="wave" viewBox="0 0 240 64" aria-hidden="true">${loop.art.map((height,i)=> loop.role==='hook'
    ? `<rect x="${i*15}" y="${54-height*5}" width="12" height="5" fill="currentColor"/>`
    : `<rect x="${i*15+3}" y="${32-height*3}" width="${loop.role==='perc'?3:8}" height="${height*6}" rx="1" fill="currentColor"/>`).join('')}</svg>`;
}

function pad(loop: Loop): string {
  const on = project().mix.loops[loop.role]===loop.id;
  return `<button type="button" class="loop-pad role-${loop.role} ${on?'selected':''}" data-action="loop" data-id="${loop.id}" data-focus="${loop.id}" aria-pressed="${on}" aria-label="${esc(loop.name)}, ${ROLE_NAMES[loop.role]}" title="${esc(loop.description)}" ${disabled(locked())}>
    <span class="pad-top"><span>${ROLE_NAMES[loop.role]}</span><span class="pad-state">${icon(on?'check':'plus')}</span></span>
    ${wave(loop)}<span class="pad-name">${esc(loop.name)}</span>
  </button>`;
}

function mixer(): string {
  return `<aside class="mixer"><div class="section-heading"><h2>Deine Mischung</h2><span class="mix-count">${activeCount(project().mix)} / 4</span></div>
    <div class="mix-tracks">${ROLES.map(role=>{
      const id = project().mix.loops[role];
      return `<div class="mix-track role-${role} ${id?'':'empty'}"><span class="track-marker"></span><div class="track-label"><strong>${id?esc(findLoop(id).name):ROLE_NAMES[role]}</strong><input type="range" aria-label="${ROLE_NAMES[role]} Lautstärke" min="0" max="100" value="${Math.round(project().mix.levels[role]*100)}" data-level="${role}" data-focus="level-${role}" ${disabled(!id||locked())}></div><button class="icon-button" type="button" data-action="mute" data-role="${role}" data-focus="mute-${role}" aria-label="${ROLE_NAMES[role]} entfernen" ${disabled(!id||locked())}>${icon('close')}</button></div>`;
    }).join('')}</div>
    <button class="save-part" data-action="add-part" ${disabled(locked()||project().song.length>=MAX_PARTS||activeCount(project().mix)===0)}>${icon('plus')} Als Songteil merken</button>
  </aside>`;
}

function partTracks(mix: Mix): string {
  return `<span class="mini-tracks" aria-hidden="true">${ROLES.map(role=>`<i class="role-${role} ${mix.loops[role]?'filled':''}"></i>`).join('')}</span>`;
}

function arranger(): string {
  const p = project();
  return `<section class="arranger ${view==='song'?'expanded':'song-overview'}" id="arranger" aria-label="Song-Arranger">
    <div class="arranger-heading"><div class="song-title-line"><h2>Dein Song</h2><span class="song-length">${p.song.length} Teile · ${time(durationSeconds(p))}</span></div>${view==='loops'?`<button class="action-button" data-action="view-song" ${disabled(busy||recording!==null||fileBusy)}>${icon('song')} Song bearbeiten</button>`:''}</div>
    ${view==='song'?vocalWorkspace(p,selectedVocalId,recording,waves,locked()):`
    <div class="song-parts" aria-label="Songteile in Reihenfolge">${p.song.map((part,index)=>`<button class="song-part ${editingId===part.id?'editing':''}" data-part="${esc(part.id)}" data-action="open-song-part" data-id="${esc(part.id)}" data-focus="part-${esc(part.id)}" aria-label="${esc(part.name)}, ${part.bars} Takte${part.vocal?', mit deiner Stimme':''}, im Song öffnen" ${disabled(busy||recording!==null||fileBusy)}>
      <span class="part-number">${String(index+1).padStart(2,'0')}</span><span class="part-summary"><strong>${esc(part.name)}</strong><small>${part.bars} Takte</small></span>${partTracks(part.mix)}${part.vocal?`<span class="voice-present">${icon('mic')}</span>`:''}
    </button>`).join('')}${p.song.length<MAX_PARTS?`<button class="new-part" data-action="add-part" ${disabled(locked()||activeCount(p.mix)===0)}>${icon('plus')}<span>Teil dazu</span></button>`:''}</div>`}
  </section>`;
}

function render(): void {
  if (!project().song.some(part => part.id === selectedVocalId)) selectedVocalId = project().song[0]?.id ?? null;
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.focus : undefined;
  const previousScroll = document.querySelector('.song-parts')?.scrollLeft ?? 0;
  const oldTimeline = document.querySelector('.vocal-scroll');
  const vocalScroll = oldTimeline?.scrollLeft ?? 0;
  const oldSelection = oldTimeline?.querySelector<HTMLElement>('.vocal-part-heading.chosen')?.dataset.id;
  const openPanels = [...document.querySelectorAll<HTMLDetailsElement>('details[data-panel][open]')].map(panel=>panel.dataset.panel);
  const p = project();
  const pack = PACKS[p.pack];
  const editing = p.song.find(part=>part.id===editingId);
  app.innerHTML=`<div class="studio-shell ${view==='loops'?'loops-view':'song-view'}">
    <header class="studio-toolbar">
      <button class="wordmark" data-action="view-loops" aria-label="BUMM, zum Beat-Baukasten" ${disabled(recording!==null||fileBusy)}>BUMM<span>.</span></button>
      <div class="project-title"><input id="project-name" data-focus="project-name" maxlength="48" aria-label="Name deines Tracks" value="${esc(p.name)}">${icon('edit')}</div>
      <div class="transport-controls"><div class="tempo-control"><button data-action="bpm-down" aria-label="Langsamer" ${disabled(locked()||audio.mode!==null||hasVocals(p)||p.bpm<=pack.minBpm)}>−</button><label><input type="number" id="bpm" data-focus="bpm" aria-label="Tempo in BPM" min="${pack.minBpm}" max="${pack.maxBpm}" value="${p.bpm}" ${disabled(locked()||audio.mode!==null||hasVocals(p))}><span>${hasVocals(p)?'BPM · FEST':'BPM'}</span></label><button data-action="bpm-up" aria-label="Schneller" ${disabled(locked()||audio.mode!==null||hasVocals(p)||p.bpm>=pack.maxBpm)}>+</button></div><button class="play-button" data-action="play" data-focus="play" aria-label="${recording?'Aufnahme stoppen':audio.mode?'Wiedergabe stoppen':view==='song'?'Song starten':'Loops starten'}" ${disabled(busy||fileBusy)}>${icon(audio.mode?'stop':'play')}<span>${recording?'Stopp':busy?'Lädt…':audio.mode?'Stopp':'Start'}</span></button><button class="record-entry" data-action="open-recorder" data-focus="open-recorder" ${disabled(busy||recording!==null||fileBusy)}>${icon('mic')}<span>${recording?'Aufnahme läuft':'Stimme aufnehmen'}</span></button></div>
    </header>
    <div class="studio-nav"><nav class="view-switch" aria-label="Studio-Bereich"><button data-action="view-loops" class="${view==='loops'?'active':''}" ${disabled(recording!==null||fileBusy)} aria-pressed="${view==='loops'}">${icon('pads')} Beat bauen</button><button data-action="view-song" class="${view==='song'?'active':''}" ${disabled(recording!==null||fileBusy)} aria-pressed="${view==='song'}">${icon('song')} Mein Song</button></nav><div class="pack-switch" aria-label="Soundset"><button data-action="pack" data-pack="hiphop" aria-pressed="${p.pack==='hiphop'}" class="${p.pack==='hiphop'?'active':''}" ${disabled(busy||recording!==null||fileBusy)}>Hip-Hop</button><button data-action="pack" data-pack="techno" aria-pressed="${p.pack==='techno'}" class="${p.pack==='techno'?'active':''}" ${disabled(busy||recording!==null||fileBusy)}>Techno</button></div><div class="beat-display" aria-label="Taktanzeige"><span id="bar-label">TAKT 01</span><div class="beat-lights" aria-hidden="true"><i></i><i></i><i></i><i></i></div></div><button class="undo-button" data-action="undo" aria-label="Letzte Änderung rückgängig" ${disabled(!history.length||busy||recording!==null||fileBusy)}>${icon('undo')} <span>Zurück</span></button></div>
    <span id="playback-status" class="sr-only"></span>
    ${view==='loops'?`<section class="loop-workspace" aria-label="Loop-Baukasten"><div class="pads-section"><div class="section-heading"><h1>${editing?`Mischung für „${esc(editing.name)}“`:'Was spielt mit?'}</h1>${editing?'<button class="action-button finish-edit" data-action="finish-edit">Fertig '+icon('check')+'</button>':'<span class="matching-note">Pro Farbe ein Sound.</span>'}</div><div class="pad-grid">${pack.loops.map(pad).join('')}</div></div>${mixer()}</section>`:''}
    ${arranger()}
    <footer class="studio-footer"><div class="file-actions"><button class="action-button" data-action="save-project" aria-label="Projekt mit Aufnahmen sichern" ${disabled(busy||recording!==null||fileBusy)}>${icon('save')} Sichern</button><button class="action-button" data-action="load-project" aria-label="Projekt laden" ${disabled(busy||recording!==null||fileBusy)}>${icon('folder')} Laden</button><input id="project-file" class="sr-only" type="file" accept=".bumm,.json,application/json,application/octet-stream" aria-label="Projektdatei wählen" tabindex="-1"></div><span id="save-label" class="save-label"></span><label class="master-volume">${icon('volume')}<span class="sr-only">Abhörlautstärke</span><input type="range" id="master-volume" data-focus="master-volume" min="0" max="100" value="${masterVolume}"></label><button class="export-button" data-action="export-wav" data-focus="export-wav" aria-label="Song mit Beat und Stimme als WAV herunterladen" ${disabled(exporting||recording!==null||fileBusy||!p.song.length||!p.song.some(part=>activeCount(part.mix)||part.vocal))}>${icon('down')} <span>${exporting?'Wird gebaut…':'Song herunterladen'}</span></button><button class="help-button" data-action="help" ${disabled(recording!==null||fileBusy)} aria-label="So geht BUMM">?</button></footer>
    <dialog id="help-dialog"><div class="dialog-heading"><span class="wordmark">BUMM<span>.</span></span><button class="icon-button" data-action="close-help" aria-label="Hilfe schließen">${icon('close')}</button></div><h2>Du hast den Takt.</h2><ol><li><strong>Sounds aussuchen</strong><p>Tippe auf die großen Pads. Pro Farbe passt ein Sound in deine Mischung.</p></li><li><strong>Start drücken</strong><p>Alles spielt im gleichen Takt. Neue Sounds steigen beim nächsten Takt ein.</p></li><li><strong>Einen Song bauen</strong><p>Merke dir Mischungen als Songteile. Unter „Mein Song“ wählst du einen Teil und singst deine Stimme dazu. Ordne die Teile mit den Pfeilen an.</p></li></ol><p class="storage-help">Deine Projekte bleiben in diesem Browser. Mit „Sichern“ kannst du sie aufheben oder auf einem anderen Gerät laden. „Song herunterladen“ speichert Beat und Stimme zusammen als WAV-Datei. Nutze Kopfhörer beim Einsingen. Das Tempo bleibt nach einer Aufnahme fest.</p><button class="play-button" data-action="close-help">Los geht’s ${icon('arrow')}</button></dialog>
  </div>`;
  if (!document.querySelector('#toast')) {
    const toast=document.createElement('div'); toast.id='toast'; toast.setAttribute('role','status'); toast.setAttribute('aria-live','polite'); toast.hidden=true; document.body.append(toast);
  }
  updateSaveLabel();
  const parts = document.querySelector('.song-parts');
  if (parts) parts.scrollLeft=previousScroll;
  const timeline = document.querySelector('.vocal-scroll');
  if (timeline) {
    timeline.scrollLeft = vocalScroll;
    if (!oldTimeline || oldSelection !== selectedVocalId || recording?.phase === 'preparing') {
      const selected = timeline.querySelector<HTMLElement>('.vocal-part-heading.chosen');
      if (selected) timeline.scrollLeft = Math.max(0, selected.offsetLeft - 118);
    }
  }
  for (const panel of openPanels) app.querySelector<HTMLDetailsElement>(`details[data-panel="${panel}"]`)?.setAttribute('open','');
  if (focused) app.querySelector<HTMLElement>(`[data-focus="${CSS.escape(focused)}"]`)?.focus({ preventScroll:true });
  lastPosition='';
  updatePosition();
}

function updateSaveLabel(): void {
  const label=document.querySelector('#save-label');
  if (!label) return;
  label.textContent=saveState==='saved'?'Auf diesem Gerät gespeichert':saveState==='invalid'?'Alter Speicherstand nicht lesbar. Bitte Projektdatei laden.':'Speichern nicht möglich. Bitte Projektdatei sichern.';
  label.classList.toggle('save-warning',saveState!=='saved');
}

function updatePosition(): void {
  const position=audio.position();
  const key=JSON.stringify(position);
  if (lastPosition===key) return;
  lastPosition=key;
  document.querySelectorAll<HTMLElement>('.beat-lights i').forEach((light,index)=>light.classList.toggle('lit',position?.beat===index));
  const bar=document.querySelector('#bar-label');
  if (bar) bar.textContent=`TAKT ${String(position ? audio.mode==='song'?position.bar+1:position.bar%4+1 : 1).padStart(2,'0')}`;
  const playingPartId=recording?.partId??previewPartId??project().song[position?.part??-1]?.id;
  const playingPart=project().song.find(part=>part.id===playingPartId);
  const status=document.querySelector('#playback-status');
  if (status) status.textContent=busy?'Deine Sounds werden vorbereitet.':position?.pending?'Deine Änderung kommt im nächsten Takt.':audio.mode==='song'?`Jetzt: ${playingPart?.name??'Dein Song'}`:position?'Dein Beat läuft. Probier einen anderen Sound.':'Such dir Sounds aus. Dann drück Start.';
  document.querySelectorAll<HTMLElement>('.song-part').forEach(part=>part.classList.toggle('is-playing',Boolean(position)&&part.dataset.part===playingPartId));
  document.querySelectorAll<HTMLElement>('[data-vocal-part]').forEach(part=>part.classList.toggle('is-playing',Boolean(position)&&part.dataset.vocalPart===playingPartId));
  document.querySelector('.play-button')?.classList.toggle('is-playing',audio.mode!==null);
}

async function play(mode: 'loops'|'song', partId: string | null = null): Promise<void> {
  if (busy||fileBusy||recording) return;
  if (audio.mode===mode || (mode==='loops'&&audio.mode)) { audio.stop(); render(); return; }
  if (mode==='song'&&!project().song.length) return;
  const generation=++playGeneration;
  busy=true; render();
  try {
    await audio.unlock();
    const snapshot=clone(project());
    if (partId) snapshot.song=snapshot.song.filter(part=>part.id===partId);
    previewPartId=partId;
    const library=mode==='song'?await takes.forProject(snapshot):{};
    if (generation!==playGeneration) return;
    await audio.start(snapshot,mode,library);
  } catch (error) {
    audio.stop();
    announce(error instanceof Error?error.message:'Die Musik konnte nicht starten. Bitte versuche es nochmal.',true);
  } finally { if(generation===playGeneration) {busy=false; render();} }
}

function download(blob: Blob,filename: string): void {
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a'); link.href=url; link.download=filename;
  document.body.append(link); link.click(); link.remove();
  window.setTimeout(()=>URL.revokeObjectURL(url),60_000);
}
function filename(name: string): string { return name.replace(/[^\p{L}\p{N} _-]/gu,'').trim()||'Mein Beat'; }

async function exportWav(): Promise<void> {
  if (exporting||!project().song.length) return;
  const snapshot=clone(project());
  exporting=true; render();
  announce('Dein Song wird als Audiodatei gebaut.');
  try {
    const wav=await bank.getWav(snapshot,await takes.forProject(snapshot));
    download(new Blob([wav],{ type:'audio/wav' }),`${filename(snapshot.name)}.wav`);
    announce('Deine WAV-Datei ist fertig. Schau in deine Downloads.');
  } catch { announce('Der Export hat nicht geklappt. Bitte versuche es nochmal.',true); }
  finally { exporting=false; render(); }
}

app.addEventListener('click',event=>{
  const button=(event.target as Element).closest<HTMLButtonElement>('[data-action]');
  if (!button||button.disabled) return;
  const action=button.dataset.action;
  const id=button.dataset.id;
  const p=project();
  if (action==='cancel-record') { cancelRecording(); return; }
  if (action==='record') { if (recording) finishRecording(); else void recordVocal(); return; }
  if (action==='play'&&recording) { finishRecording(); return; }
  if (recording||fileBusy) return;
  if (action==='open-recorder'||action==='open-song-part') {
    if (busy) return;
    audio.stop();
    if (id&&p.song.some(part=>part.id===id)) selectedVocalId=id;
    view='song'; render();
    const target=app.querySelector<HTMLElement>(action==='open-recorder'?'.record-button':'.vocal-part-heading.chosen');
    target?.focus({preventScroll:true});
    target?.scrollIntoView({block:'nearest'});
    return;
  }
  if (action==='play') { void play(view); return; }
  if (action==='preview-part') { void play('song',selectedVocalId); return; }
  if (action==='play-song') { void play('song'); return; }
  if (action==='export-wav') { void exportWav(); return; }
  if (action==='help') { document.querySelector<HTMLDialogElement>('#help-dialog')!.showModal(); return; }
  if (action==='close-help') { document.querySelector<HTMLDialogElement>('#help-dialog')!.close(); return; }
  if (action==='view-loops'||action==='view-song') { view=action==='view-loops'?'loops':'song'; render(); return; }
  if (action==='pack') {
    const pack=button.dataset.pack as PackId;
    if (pack===studio.currentPack) return;
    audio.stop(); editingId=null;
    mutate(()=>{studio.currentPack=pack;});
    void refreshWaves();
    announce(`${PACKS[pack].name}: dein eigener Track mit eigenen Sounds.`);
    return;
  }
  if (action==='undo') {
    const previous=history.pop();
    if (!previous) return;
    audio.stop(); studio=previous; editingId=null; save(); render(); announce('Letzte Änderung rückgängig.'); return;
  }
  if (action==='save-project') { void saveProjectFile(); return; }
  if (action==='load-project') { document.querySelector<HTMLInputElement>('#project-file')!.click(); return; }
  if (locked()) return;
  if (action==='select-vocal') { selectedVocalId=id!; render(); return; }
  if (action==='remove-vocal') {
    const part=p.song.find(part=>part.id===selectedVocalId);
    if (part?.vocal) { mutate(()=>{part.vocal=null;}); announce('Aufnahme entfernt. Mit Rückgängig holst du sie zurück.'); }
    return;
  }
  if (action==='loop') {
    const loop=findLoop(id as LoopId);
    mutate(()=>{p.mix=toggleLoop(p.mix,loop.role,loop.id);},true); return;
  }
  if (action==='mute') {
    const role=button.dataset.role as Role;
    mutate(()=>{p.mix.loops[role]=null;},true); return;
  }
  if ((action==='bpm-down'||action==='bpm-up')&&!hasVocals(p)) {
    mutate(()=>{p.bpm+=action==='bpm-down'?-1:1;}); return;
  }
  if (action==='finish-edit') { editingId=null; render(); return; }
  if (action==='add-part') {
    if (p.song.length>=MAX_PARTS||!activeCount(p.mix)) return;
    const newId=crypto.randomUUID();
    mutate(()=>{p.song.push({id:newId,name:p.song.length===3?'Finale':`Teil ${p.song.length+1}`,bars:4,mix:clone(p.mix),vocal:null});});
    document.querySelector('.song-parts')?.scrollTo({left:10000});
    announce('Deine Mischung ist jetzt ein neuer Songteil.'); return;
  }
  const index=p.song.findIndex(part=>part.id===id);
  if (index<0) return;
  if (action==='edit-part') {
    editingId=id!; view='loops';
    mutate(()=>{p.mix=clone(p.song[index].mix);});
    audio.setMix(p.mix);
    document.querySelector('.pads-section')?.scrollIntoView({block:'nearest'});
    announce(`Du bearbeitest jetzt „${p.song[index].name}“.`); return;
  }
  if (action==='move-left'||action==='move-right') {
    const target=index+(action==='move-left'?-1:1);
    if (target<0||target>=p.song.length) return;
    mutate(()=>{[p.song[index],p.song[target]]=[p.song[target],p.song[index]];}); return;
  }
  if (action==='delete-part') {
    const name=p.song[index].name;
    mutate(()=>{p.song.splice(index,1);if(editingId===id) editingId=null;});
    announce(`„${name}“ entfernt. Mit Rückgängig holst du den Teil zurück.`); return;
  }
  if (action==='copy-part'&&p.song.length<MAX_PARTS) {
    mutate(()=>{p.song.splice(index+1,0,{...clone(p.song[index]),id:crypto.randomUUID(),name:`${p.song[index].name.slice(0,18)} Kopie`});});
  }
});

app.addEventListener('focusin',event=>{
  const input=event.target as HTMLInputElement;
  if (input.matches('[data-level],[data-name],[data-voice-control],#project-name')) editBaseline=clone(studio);
});

app.addEventListener('input',event=>{
  const input=event.target as HTMLInputElement;
  if (input.id==='master-volume') { masterVolume=Number(input.value); audio.setVolume(masterVolume/100); return; }
  if (input.dataset.voiceControl&&!locked()) {
    const part=project().song.find(part=>part.id===selectedVocalId);
    if (input.dataset.voiceControl==='beat') project().beatLevel=Number(input.value)/100;
    if (part?.vocal&&input.dataset.voiceControl==='volume') part.vocal.volume=Number(input.value)/100;
    if (part?.vocal&&input.dataset.voiceControl==='timing') {
      part.vocal.shiftMs=Number(input.value);
      const output=document.querySelector('#timing-value');
      if (output) output.textContent=`${part.vocal.shiftMs} ms`;
    }
    save(); return;
  }
  if (input.dataset.level) {
    const role=input.dataset.level as Role;
    project().mix.levels[role]=Number(input.value)/100;
    if (editingId) {
      const part=project().song.find(part=>part.id===editingId);
      if (part) part.mix=clone(project().mix);
    }
    audio.setMix(project().mix); save();
  }
  if (input.id==='project-name'&&input.value.trim()) { project().name=input.value.trim().slice(0,48); save(); }
  if (input.dataset.name&&input.value.trim()) {
    const part=project().song.find(part=>part.id===input.dataset.name);
    if (part) { part.name=input.value.trim().slice(0,24); save(); }
  }
});

app.addEventListener('change',event=>{
  const input=event.target as HTMLInputElement;
  if (input.id==='project-file') { void importProject(input); return; }
  if (input.id==='bpm') {
    if (hasVocals(project())||locked()) { input.value=String(project().bpm); return; }
    const bpm=Number(input.value);
    const pack=PACKS[project().pack];
    if (!Number.isInteger(bpm)||bpm<pack.minBpm||bpm>pack.maxBpm) { input.value=String(project().bpm); announce(`Das Tempo liegt hier zwischen ${pack.minBpm} und ${pack.maxBpm} BPM.`); return; }
    if (bpm!==project().bpm) mutate(()=>{project().bpm=bpm;});
    return;
  }
  if (input.dataset.bars) {
    const part=project().song.find(part=>part.id===input.dataset.bars);
    if (!part) return;
    const bars=Number(input.value);
    if (locked()||(bars!==4&&bars!==8)) { input.value=String(part.bars); return; }
    if (part.bars!==bars) mutate(()=>{part.bars=bars;});
    return;
  }
  if (input.matches('[data-level],[data-name],[data-voice-control],#project-name')) {
    if (!input.value.trim()) input.value=input.id==='project-name'?project().name:project().song.find(part=>part.id===input.dataset.name)?.name??'';
    if (editBaseline&&JSON.stringify(editBaseline)!==JSON.stringify(studio)) {
      remember(editBaseline);
      document.querySelector<HTMLButtonElement>('[data-action="undo"]')!.disabled=false;
    }
    editBaseline=clone(studio);
    if (input.dataset.name) render();
  }
});

async function saveProjectFile(): Promise<void> {
  if (fileBusy||recording) return;
  const snapshot=clone(project());
  fileBusy=true; render();
  try {
    const data=encodeProject(snapshot,await takes.forProject(snapshot));
    download(new Blob([data],{type:'application/octet-stream'}),`${filename(snapshot.name)}.bumm`);
    announce('Projektdatei mit allen Aufnahmen erstellt.');
  } catch (error) { announce(error instanceof Error?error.message:'Das Projekt konnte nicht gesichert werden.',true); }
  finally { fileBusy=false; render(); }
}

async function importProject(input: HTMLInputElement): Promise<void> {
  const file=input.files?.[0];
  if (!file||recording||fileBusy) return;
  fileBusy=true; audio.stop(); render();
  try {
    if (file.size>MAX_PROJECT_BYTES) throw new Error('Diese Projektdatei ist zu groß.');
    const decoded=decodeProject(await file.arrayBuffer());
    const imported=remapImported(decoded.project,decoded.takes,()=>crypto.randomUUID());
    await takes.putAll(imported.takes);
    for (const take of imported.takes) waves.set(take.id,waveform(take));
    editingId=null;
    mutate(()=>{studio.currentPack=imported.project.pack;studio.projects[imported.project.pack]=imported.project;});
    announce('Projekt samt Aufnahmen geladen. Dein vorheriger Stand bleibt über Rückgängig erreichbar.');
  } catch (error) { announce(error instanceof Error?error.message:'Diese Projektdatei konnte nicht geladen werden.',true); }
  finally { fileBusy=false; input.value=''; render(); }
}

async function refreshWaves(): Promise<void> {
  const snapshot=project();
  try {
    const library=await takes.forProject(snapshot);
    for (const take of Object.values(library)) if (!waves.has(take.id)) waves.set(take.id,waveform(take));
    if (snapshot===project()&&!recording) render();
  } catch (error) { if (snapshot===project()) announce(error instanceof Error?error.message:'Aufnahme fehlt.',true); }
}

async function recordVocal(): Promise<void> {
  const part=project().song.find(part=>part.id===selectedVocalId);
  if (!part||locked()) return;
  const owner=project();
  const generation=++recordGeneration;
  audio.stop(); previewPartId=null;
  recording={partId:part.id,phase:'preparing'};
  view='song'; render();
  let captured: Promise<Take> | undefined;
  try {
    const context=await audio.unlock();
    if (generation!==recordGeneration) throw new RecordingCancelled();
    await microphone.prepare(context);
    if (generation!==recordGeneration) throw new RecordingCancelled();
    const backing=clone(owner); backing.song=[clone(part)];
    const started=await audio.start(backing,'song',{}, {recording:true,onScheduled:schedule=>{
      if (generation!==recordGeneration) throw new RecordingCancelled();
      recording={partId:part.id,phase:'count-in',schedule};
      captured=microphone.capture(schedule.startTime,schedule.endTime);
      void captured.catch(()=>{});
      render();
    }});
    if (!started||!captured) throw new RecordingCancelled();
    const take=await captured;
    if (generation!==recordGeneration) throw new RecordingCancelled();
    recording={partId:part.id,phase:'saving'}; audio.stop(); render();
    await takes.putAll([take]);
    if (generation!==recordGeneration) throw new RecordingCancelled();
    waves.set(take.id,waveform(take));
    recording=null;
    mutate(()=>{part.vocal={takeId:take.id,volume:.9,shiftMs:0};});
    announce(`Deine Stimme ist jetzt in „${part.name}“.`);
  } catch (error) {
    if (generation===recordGeneration&&!(error instanceof RecordingCancelled)) announce(microphoneError(error),true);
  } finally {
    if (generation===recordGeneration) { microphone.cancel();audio.stop();recording=null;render(); }
  }
}

function cancelRecording(): void {
  recordGeneration++; microphone.cancel(); audio.stop(); recording=null; render();
  announce('Aufnahme abgebrochen. Deine vorige Aufnahme bleibt erhalten.');
}

function finishRecording(): void {
  if (!recording) return;
  if (recording.phase==='count-in'||recording.phase==='preparing') { cancelRecording(); return; }
  if (recording.phase!=='recording') return;
  recording.phase='finishing'; microphone.finish(); audio.stop(); render();
}

function updateRecording(): void {
  if (!recording) return;
  const {schedule}=recording;
  const elapsed=schedule?audio.clockTime-schedule.startTime:0;
  if (recording.phase==='count-in'&&elapsed>=0) { recording.phase='recording';render();return; }
  const text=document.querySelector('#record-status');
  const duration=schedule?schedule.endTime-schedule.startTime:0;
  if (text) text.textContent=recording.phase==='preparing'?'Erlaube den Mikrofonzugriff. Dann geht es los.':recording.phase==='count-in'?`Einzählen: ${Math.max(1,Math.min(4,Math.floor((elapsed+schedule!.barDuration)/(schedule!.barDuration/4))+1))} von 4` :recording.phase==='recording'?`Jetzt singen! Noch ${Math.max(0,Math.ceil(duration-elapsed))} Sekunden.`:'Deine Aufnahme wird gespeichert.';
  const progress=document.querySelector<HTMLElement>('#record-progress-fill');
  if (progress) progress.style.width=`${Math.min(100,Math.max(0,elapsed/Math.max(1,duration)*100))}%`;
}

microphone.onLevel=peak=>{
  const level=Math.min(100,Math.round(peak*250));
  const meter=document.querySelector<HTMLElement>('#mic-level');
  if (meter) meter.style.width=`${level}%`;
  document.querySelector('.mic-meter')?.setAttribute('aria-valuenow',String(level));
};
microphone.onInterrupted=()=>{ if(recording) { cancelRecording(); announce('Das Mikrofon wurde unterbrochen. Bitte versuche es nochmal.',true); } };

document.addEventListener('keydown',event=>{
  if ((event.target as HTMLElement).matches('input,select,textarea,button,summary')||document.querySelector('dialog[open]')) return;
  if (event.code==='Space') { event.preventDefault(); if(recording) finishRecording(); else void play(view); }
  if (event.code==='Escape'&&recording) { event.preventDefault();cancelRecording(); }
  if ((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='z'&&!busy&&!recording) {
    event.preventDefault();document.querySelector<HTMLButtonElement>('[data-action="undo"]')?.click();
  }
});
document.addEventListener('visibilitychange',()=>{
  if (document.hidden&&recording) cancelRecording();
  else if (document.hidden&&(audio.mode||busy)) { playGeneration++;busy=false;audio.stop();render(); }
});
audio.onStop=reason=>{
  if(reason==='interrupted'&&recording) { cancelRecording();announce('Audio wurde unterbrochen. Bitte starte die Aufnahme nochmal.',true); }
  else render();
};
render();
void refreshWaves();
window.setInterval(()=>{updatePosition();updateRecording();},100);
