import '@fontsource/barlow/latin-400.css';
import '@fontsource/barlow/latin-500.css';
import '@fontsource/barlow/latin-600.css';
import '@fontsource/barlow/latin-700.css';
import '@fontsource/barlow-condensed/latin-700.css';
import '@fontsource/barlow-condensed/latin-800.css';
import './style.css';
import { PACKS, ROLES, ROLE_NAMES, findLoop } from './music/catalog';
import type { Loop, LoopId, PackId, Role } from './music/catalog';
import { MAX_PARTS, activeCount, clone, durationSeconds, makeStudio, parseStudio, toggleLoop, totalBars, validProject } from './music/project';
import type { Mix, Project, Studio } from './music/project';
import { BankClient } from './audio/bank-client';
import { BrowserEngine } from './audio/browser-engine';

const STORAGE_KEY = 'bumm.studio.v1';
const app = document.querySelector<HTMLDivElement>('#app')!;
const bank = new BankClient();
const audio = new BrowserEngine(bank);
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
  const raw = localStorage.getItem(STORAGE_KEY);
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
function locked(): boolean { return busy || audio.mode==='song'; }
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
  return `<button type="button" class="loop-pad role-${loop.role} ${on?'selected':''}" data-action="loop" data-id="${loop.id}" data-focus="${loop.id}" aria-pressed="${on}" aria-label="${esc(loop.name)}, ${ROLE_NAMES[loop.role]}" ${disabled(locked())}>
    <span class="pad-top"><span>${ROLE_NAMES[loop.role]}</span><span class="pad-state">${icon(on?'check':'plus')}</span></span>
    ${wave(loop)}<span class="pad-name">${esc(loop.name)}</span><span class="pad-description">${loop.description}</span>
    <span class="pad-bottom"><span>4 TAKTE</span><span>${on?'DABEI':'DAZU?'}</span></span>
  </button>`;
}

function mixer(): string {
  return `<aside class="mixer"><div class="section-heading"><h2>Deine Mischung</h2><span class="mix-count">${String(activeCount(project().mix)).padStart(2,'0')}/04</span></div>
    <div class="mix-tracks">${ROLES.map(role=>{
      const id = project().mix.loops[role];
      return `<div class="mix-track role-${role} ${id?'':'empty'}"><div class="mix-track-top"><span class="track-marker"></span><div class="track-label"><span class="track-role">${ROLE_NAMES[role]}</span><strong>${id?esc(findLoop(id).name):'Noch frei'}</strong></div><button class="icon-button" type="button" data-action="mute" data-role="${role}" data-focus="mute-${role}" aria-label="${ROLE_NAMES[role]} entfernen" ${disabled(!id||locked())}>${icon('close')}</button></div><div class="track-slider"><span>Leise</span><input type="range" aria-label="${ROLE_NAMES[role]} Lautstärke" min="0" max="100" value="${Math.round(project().mix.levels[role]*100)}" data-level="${role}" data-focus="level-${role}" ${disabled(!id||locked())}><span>Laut</span></div></div>`;
    }).join('')}</div>
    <button class="save-part" data-action="add-part" ${disabled(locked()||project().song.length>=MAX_PARTS||activeCount(project().mix)===0)}>${icon('plus')} Als Songteil merken</button>
    <p class="mixer-note">${project().song.length>=MAX_PARTS?'Alle 8 Plätze sind belegt.':editingId?'Änderungen landen direkt in diesem Songteil.':'Mach aus deiner Mischung ein Stück vom Song.'}</p>
  </aside>`;
}

function partTracks(mix: Mix): string {
  return `<div class="part-tracks" aria-label="${ROLES.filter(role=>mix.loops[role]).map(role=>ROLE_NAMES[role]).join(', ')||'Stille'}">${ROLES.map(role=>`<span class="part-track role-${role} ${mix.loops[role]?'filled':''}"><span>${ROLE_NAMES[role]}</span>${mix.loops[role]?'<i></i><i></i><i></i><i></i>':''}</span>`).join('')}</div>`;
}

function arranger(): string {
  const p = project();
  return `<section class="arranger ${view==='song'?'expanded':''}" id="arranger" aria-label="Song-Arranger">
    <div class="arranger-heading"><div><div class="song-title-line"><h2>Dein Song</h2><span class="song-length">${p.song.length} Teile <span>·</span> ${time(durationSeconds(p))}</span></div><p>Erst der Beat. Dann die Hook. Dann alles zusammen.</p></div><div class="arranger-actions"><button class="text-button" data-action="play-song" data-focus="play-song" ${disabled(busy||!p.song.length)}>${icon(audio.mode==='song'?'stop':'play')} ${audio.mode==='song'?'Song stoppen':'Song abspielen'}</button><button class="export-button" data-action="export-wav" data-focus="export-wav" ${disabled(exporting||!p.song.length||!p.song.some(part=>activeCount(part.mix)))}>${icon('down')} <span>${exporting?'Wird gebaut…':'Exportieren'}</span></button></div></div>
    ${view==='song'?'<p class="arranger-tip">Schiebe Teile mit den Pfeilen an ihren Platz. Mit „Bearbeiten“ änderst du die Sounds.</p>':''}
    <div class="song-parts" aria-label="Songteile in Reihenfolge">${p.song.map((part,index)=>`<article class="song-part ${editingId===part.id?'editing':''}" data-part="${esc(part.id)}">
      <div class="part-header"><span class="part-number">${String(index+1).padStart(2,'0')}</span><input class="part-name" aria-label="Name von Songteil ${index+1}" maxlength="24" value="${esc(part.name)}" data-name="${esc(part.id)}" data-focus="name-${esc(part.id)}" ${disabled(locked())}><select data-bars="${esc(part.id)}" data-focus="bars-${esc(part.id)}" aria-label="Länge von ${esc(part.name)}" ${disabled(locked())}><option value="4" ${part.bars===4?'selected':''}>4 Takte</option><option value="8" ${part.bars===8?'selected':''}>8 Takte</option></select></div>
      <button class="part-edit" data-action="edit-part" data-id="${esc(part.id)}" data-focus="edit-${esc(part.id)}" aria-label="${esc(part.name)} bearbeiten" ${disabled(locked())}>${partTracks(part.mix)}<span class="part-edit-label">${icon('edit')} Bearbeiten</span></button>
      <div class="part-controls"><button class="icon-button" data-action="move-left" data-id="${esc(part.id)}" data-focus="left-${esc(part.id)}" aria-label="${esc(part.name)} nach links" ${disabled(index===0||locked())}>${icon('left')}</button><button class="icon-button" data-action="move-right" data-id="${esc(part.id)}" data-focus="right-${esc(part.id)}" aria-label="${esc(part.name)} nach rechts" ${disabled(index===p.song.length-1||locked())}>${icon('right')}</button><span class="control-spacer"></span><button class="icon-button" data-action="copy-part" data-id="${esc(part.id)}" aria-label="${esc(part.name)} kopieren" ${disabled(p.song.length>=MAX_PARTS||locked())}>${icon('copy')}</button><button class="icon-button" data-action="delete-part" data-id="${esc(part.id)}" aria-label="${esc(part.name)} entfernen" ${disabled(locked())}>${icon('trash')}</button></div>
    </article>`).join('')}${p.song.length<MAX_PARTS?`<button class="new-part" data-action="add-part" ${disabled(locked()||activeCount(p.mix)===0)}>${icon('plus')}<span>Deine Mischung<br>als neuen Teil</span></button>`:''}</div>
    <div class="arranger-footer"><span>${icon('arrow')} Die Teile spielen von links nach rechts.</span><span>${totalBars(p)} Takte <span class="footer-separator">/</span> ${p.bpm} BPM</span></div>
  </section>`;
}

function render(): void {
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.focus : undefined;
  const previousScroll = document.querySelector('.song-parts')?.scrollLeft ?? 0;
  const p = project();
  const pack = PACKS[p.pack];
  const editing = p.song.find(part=>part.id===editingId);
  app.innerHTML=`<div class="studio-shell">
    <header class="masthead flex items-center justify-between"><a class="wordmark" href="#" aria-label="BUMM, zum Beat-Baukasten">BUMM<span>.</span></a><p class="brand-line">DEIN BEAT.<br>DEIN DING.</p><div class="masthead-right"><span class="local-label"><span></span> DEIN KLEINES STUDIO</span><button class="help-button" data-action="help" aria-label="So geht BUMM">?</button></div></header>
    <section class="transport-panel" aria-label="Wiedergabe">
      <div class="project-title"><label for="project-name">DEIN TRACK</label><div><input id="project-name" data-focus="project-name" maxlength="48" aria-label="Name deines Tracks" value="${esc(p.name)}">${icon('edit')}</div></div>
      <div class="transport-controls"><div class="tempo-control"><button data-action="bpm-down" aria-label="Langsamer" ${disabled(busy||audio.mode!==null||p.bpm<=pack.minBpm)}>−</button><label><input type="number" id="bpm" data-focus="bpm" aria-label="Tempo in BPM" min="${pack.minBpm}" max="${pack.maxBpm}" value="${p.bpm}" ${disabled(busy||audio.mode!==null)}><span>BPM</span></label><button data-action="bpm-up" aria-label="Schneller" ${disabled(busy||audio.mode!==null||p.bpm>=pack.maxBpm)}>+</button></div><button class="play-button" data-action="play" data-focus="play" aria-label="${audio.mode?'Wiedergabe stoppen':'Loops starten'}" ${disabled(busy)}>${icon(audio.mode?'stop':'play')}<span>${busy?'Lädt…':audio.mode?'Stopp':'Start'}</span></button></div>
    </section>
    <div class="studio-nav"><nav class="view-switch" aria-label="Studio-Bereich"><button data-action="view-loops" class="${view==='loops'?'active':''}" aria-pressed="${view==='loops'}"><span>01</span> Loops spielen</button><button data-action="view-song" class="${view==='song'?'active':''}" aria-pressed="${view==='song'}"><span>02</span> Mein Song</button></nav><div class="pack-switch" aria-label="Soundset"><button data-action="pack" data-pack="hiphop" aria-pressed="${p.pack==='hiphop'}" class="${p.pack==='hiphop'?'active':''}" ${disabled(busy)}>Hip-Hop</button><button data-action="pack" data-pack="techno" aria-pressed="${p.pack==='techno'}" class="${p.pack==='techno'?'active':''}" ${disabled(busy)}>Techno</button></div></div>
    <div class="playback-strip"><div class="beat-display" aria-label="Taktanzeige"><span id="bar-label">TAKT 01</span><div class="beat-lights" aria-hidden="true"><i></i><i></i><i></i><i></i></div></div><span id="playback-status">${busy?'Deine Sounds werden vorbereitet.':'Such dir Sounds aus. Dann drück Start.'}</span><button class="undo-button" data-action="undo" aria-label="Letzte Änderung rückgängig" ${disabled(!history.length||busy)}>${icon('undo')} <span>Rückgängig</span></button></div>
    ${view==='loops'?`<section class="loop-workspace" aria-label="Loop-Baukasten"><div class="pads-section"><div class="section-heading"><h1>${editing?`Mischung für „${esc(editing.name)}“`:'Was spielt mit?'}</h1>${editing?'<button class="text-button finish-edit" data-action="finish-edit">Fertig '+icon('check')+'</button>':'<span class="matching-note">'+icon('spark')+' Alles passt zusammen</span>'}</div><div class="pad-grid">${pack.loops.map(pad).join('')}</div><p class="pads-tip"><span>Antippen: dazu. Nochmal: weg.</span><span>Pro Farbe spielt ein Sound.</span></p></div>${mixer()}</section>`:''}
    ${arranger()}
    <footer class="studio-footer"><div class="file-actions"><button class="text-button" data-action="save-project">${icon('save')} Projekt sichern</button><button class="text-button" data-action="load-project">Projekt laden</button><input id="project-file" class="sr-only" type="file" accept=".json,application/json" aria-label="Projektdatei wählen" tabindex="-1"></div><span id="save-label" class="save-label"></span><label class="master-volume">${icon('volume')}<span class="sr-only">Abhörlautstärke</span><input type="range" id="master-volume" data-focus="master-volume" min="0" max="100" value="${masterVolume}"></label></footer>
    <p class="studio-signoff">KLEINE IDEEN. GROSSE BEATS.</p>
    <dialog id="help-dialog"><div class="dialog-heading"><span class="wordmark">BUMM<span>.</span></span><button class="icon-button" data-action="close-help" aria-label="Hilfe schließen">${icon('close')}</button></div><h2>Du hast den Takt.</h2><ol><li><strong>Sounds aussuchen</strong><p>Tippe auf die großen Pads. Pro Farbe passt ein Sound in deine Mischung.</p></li><li><strong>Start drücken</strong><p>Alles spielt im gleichen Takt. Neue Sounds steigen beim nächsten Takt ein.</p></li><li><strong>Einen Song bauen</strong><p>Merke dir Mischungen als Songteile. Ordne sie mit den Pfeilen an. Fertig ist dein Track.</p></li></ol><p class="storage-help">Deine Projekte bleiben in diesem Browser. Mit „Projekt sichern“ kannst du sie aufheben oder auf einem anderen Gerät laden. „Exportieren“ speichert den Song als WAV-Datei.</p><button class="play-button" data-action="close-help">Los geht’s ${icon('arrow')}</button></dialog>
  </div>`;
  if (!document.querySelector('#toast')) {
    const toast=document.createElement('div'); toast.id='toast'; toast.setAttribute('role','status'); toast.setAttribute('aria-live','polite'); toast.hidden=true; document.body.append(toast);
  }
  updateSaveLabel();
  const parts = document.querySelector('.song-parts');
  if (parts) parts.scrollLeft=previousScroll;
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
  const status=document.querySelector('#playback-status');
  if (status) status.textContent=busy?'Deine Sounds werden vorbereitet.':position?.pending?'Deine Änderung kommt im nächsten Takt.':audio.mode==='song'?`Jetzt: ${project().song[position?.part??0]?.name??'Dein Song'}`:position?'Dein Beat läuft. Probier einen anderen Sound.':'Such dir Sounds aus. Dann drück Start.';
  document.querySelectorAll('.song-part').forEach((part,index)=>part.classList.toggle('is-playing',position?.part===index));
  document.querySelector('.play-button')?.classList.toggle('is-playing',audio.mode!==null);
}

async function play(mode: 'loops'|'song'): Promise<void> {
  if (busy) return;
  if (audio.mode===mode || (mode==='loops'&&audio.mode)) { audio.stop(); render(); return; }
  if (mode==='song'&&!project().song.length) return;
  busy=true; render();
  try {
    await audio.start(clone(project()),mode);
  } catch (error) {
    audio.stop();
    announce(error instanceof Error?error.message:'Die Musik konnte nicht starten. Bitte versuche es nochmal.',true);
  } finally { busy=false; render(); }
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
    const wav=await bank.getWav(snapshot);
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
  if (action==='play') { void play('loops'); return; }
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
    announce(`${PACKS[pack].name}: dein eigener Track mit eigenen Sounds.`);
    return;
  }
  if (action==='undo') {
    const previous=history.pop();
    if (!previous) return;
    audio.stop(); studio=previous; editingId=null; save(); render(); announce('Letzte Änderung rückgängig.'); return;
  }
  if (action==='save-project') { download(new Blob([JSON.stringify(p,null,2)],{type:'application/json'}),`${filename(p.name)}.bumm.json`); return; }
  if (action==='load-project') { document.querySelector<HTMLInputElement>('#project-file')!.click(); return; }
  if (locked()) return;
  if (action==='loop') {
    const loop=findLoop(id as LoopId);
    mutate(()=>{p.mix=toggleLoop(p.mix,loop.role,loop.id);},true); return;
  }
  if (action==='mute') {
    const role=button.dataset.role as Role;
    mutate(()=>{p.mix.loops[role]=null;},true); return;
  }
  if (action==='bpm-down'||action==='bpm-up') {
    mutate(()=>{p.bpm+=action==='bpm-down'?-1:1;}); return;
  }
  if (action==='finish-edit') { editingId=null; render(); return; }
  if (action==='add-part') {
    if (p.song.length>=MAX_PARTS||!activeCount(p.mix)) return;
    const newId=crypto.randomUUID();
    mutate(()=>{p.song.push({id:newId,name:p.song.length===3?'Finale':`Teil ${p.song.length+1}`,bars:4,mix:clone(p.mix)});});
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
  if (input.matches('[data-level],[data-name],#project-name')) editBaseline=clone(studio);
});

app.addEventListener('input',event=>{
  const input=event.target as HTMLInputElement;
  if (input.id==='master-volume') { masterVolume=Number(input.value); audio.setVolume(masterVolume/100); return; }
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
    const bpm=Number(input.value);
    const pack=PACKS[project().pack];
    if (!Number.isInteger(bpm)||bpm<pack.minBpm||bpm>pack.maxBpm) { input.value=String(project().bpm); announce(`Das Tempo liegt hier zwischen ${pack.minBpm} und ${pack.maxBpm} BPM.`); return; }
    if (bpm!==project().bpm) mutate(()=>{project().bpm=bpm;});
    return;
  }
  if (input.dataset.bars) {
    const part=project().song.find(part=>part.id===input.dataset.bars);
    if (part) mutate(()=>{part.bars=Number(input.value) as 4|8;});
    return;
  }
  if (input.matches('[data-level],[data-name],#project-name')) {
    if (!input.value.trim()) input.value=input.id==='project-name'?project().name:project().song.find(part=>part.id===input.dataset.name)?.name??'';
    if (editBaseline&&JSON.stringify(editBaseline)!==JSON.stringify(studio)) {
      remember(editBaseline);
      document.querySelector<HTMLButtonElement>('[data-action="undo"]')!.disabled=false;
    }
    editBaseline=clone(studio);
  }
});

async function importProject(input: HTMLInputElement): Promise<void> {
  const file=input.files?.[0];
  if (!file) return;
  try {
    if (file.size>250_000) throw new Error('Diese Datei ist zu groß für ein BUMM-Projekt.');
    const value:unknown=JSON.parse(await file.text());
    const pack=(value as {pack?:unknown})?.pack;
    if ((pack!=='hiphop'&&pack!=='techno')||!validProject(value,pack)) throw new Error('Das ist keine passende BUMM-Projektdatei.');
    audio.stop(); editingId=null;
    mutate(()=>{studio.currentPack=pack;studio.projects[pack]=value;});
    announce('Projekt geladen. Dein vorheriger Stand ist über Rückgängig erreichbar.');
  } catch (error) { announce(error instanceof Error?error.message:'Diese Projektdatei konnte nicht geladen werden.',true); }
  finally { input.value=''; }
}

document.addEventListener('keydown',event=>{
  if ((event.target as HTMLElement).matches('input,select,textarea,button')||document.querySelector('dialog[open]')) return;
  if (event.code==='Space') { event.preventDefault();void play('loops'); }
  if ((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='z'&&!busy) {
    event.preventDefault();document.querySelector<HTMLButtonElement>('[data-action="undo"]')?.click();
  }
});
document.addEventListener('visibilitychange',()=>{
  if (document.hidden&&(audio.mode||busy)) { audio.stop();render(); }
});
audio.onStop=()=>render();
render();
window.setInterval(updatePosition,100);
