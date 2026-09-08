import { ROLES } from '../music/catalog';
import { durationSeconds, MAX_START_SECONDS, MAX_TAKE_SECONDS, MAX_VOCALS } from '../music/project';
import type { Project } from '../music/project';
import type { Schedule } from '../audio/browser-engine';

export interface RecordingSession {
  startSeconds: number;
  clipId: string | null;
  phase: 'preparing' | 'count-in' | 'recording' | 'finishing' | 'saving';
  schedule?: Schedule;
}
export interface WavePreview { peaks: number[]; seconds: number }
interface Workspace {
  editingId: string | null;
  selectedVocalId: string | null;
  session: RecordingSession | null;
  waves: Map<string, WavePreview>;
  locked: boolean;
  headphones: boolean;
  cursor: number;
  editor: string;
}
const esc = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const off = (condition: boolean) => condition ? 'disabled' : '';
const time = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

export function vocalWave(peaks: number[]): string {
  return `<svg class="vocal-waveform" viewBox="0 0 256 40" preserveAspectRatio="none" aria-hidden="true">${peaks.map((peak, i) => `<rect x="${i * 4}" y="${20 - Math.max(1, peak * 21)}" width="2" height="${Math.max(2, peak * 42)}" fill="currentColor"/>`).join('')}</svg>`;
}

/** The timeline has one time scale for beats, independent voice clips and the playhead. */
export function vocalWorkspace(project: Project, state: Workspace): string {
  const { session, locked, waves, cursor, headphones } = state;
  const selected = project.vocals.find(clip => clip.id === state.selectedVocalId);
  const barSeconds = 240 / project.bpm;
  const extent = Math.max(durationSeconds(project), 8 * barSeconds, cursor + barSeconds, session ? session.startSeconds + MAX_TAKE_SECONDS : 0);
  const bars = Math.ceil(extent / barSeconds);
  const seconds = bars * barSeconds;
  const percent = (value: number) => value / seconds * 100;
  let partStart = 0;
  const beats = project.song.map(part => {
    const start = partStart;
    partStart += part.bars * barSeconds;
    return `<button class="vocal-part-heading ${part.id === state.editingId ? 'chosen' : ''}" style="left:${percent(start)}%;width:${percent(part.bars * barSeconds)}%" data-action="edit-part" data-id="${esc(part.id)}" data-part="${esc(part.id)}" data-focus="part-${esc(part.id)}" aria-label="${esc(part.name)}, ${part.bars} Takte, Beat ändern" aria-expanded="${part.id === state.editingId}" ${off(locked)}><strong>${esc(part.name)}</strong><span>${part.bars} Takte · ändern</span><span class="mini-tracks" aria-hidden="true">${ROLES.map(role => `<i class="role-${role} ${part.mix.loops[role] ? 'filled' : ''}"></i>`).join('')}</span></button>`;
  }).join('');
  // Overlapping recordings remain individually selectable within the same voice track.
  const rowEnds: number[] = [];
  const voices = [...project.vocals].sort((a, b) => a.startSeconds - b.startSeconds).map(clip => {
    let row = rowEnds.findIndex(end => end <= clip.startSeconds);
    if (row < 0) row = rowEnds.length;
    rowEnds[row] = clip.startSeconds + clip.durationSeconds;
    const wave = waves.get(clip.takeId);
    return `<button class="voice-clip has-voice ${clip.id === selected?.id ? 'chosen' : ''}" style="left:${percent(clip.startSeconds)}%;width:${percent(clip.durationSeconds)}%;top:${row * 82 + 8}px" data-action="select-vocal" data-id="${esc(clip.id)}" data-focus="voice-${esc(clip.id)}" aria-label="Aufnahme ab ${time(clip.startSeconds)} auswählen" aria-pressed="${clip.id === selected?.id}" ${off(locked)}><span>Meine Stimme · ${time(clip.startSeconds)}</span>${wave ? `<div class="wave-window"><div style="left:${clip.shiftMs / 1000 / clip.durationSeconds * 100}%;width:${wave.seconds / clip.durationSeconds * 100}%">${vocalWave(wave.peaks)}</div></div>` : '<span>Aufnahme wird geladen…</span>'}</button>`;
  }).join('');
  const timeline = `<div class="vocal-scroll" tabindex="0" role="region" aria-label="Beats und Stimme auf der Zeitleiste"><div class="song-timeline" style="min-width:${72 + bars * 32}px" data-duration="${seconds}">
    <div class="timeline-label">Takt</div><div class="timeline-ruler"><div class="ruler-numbers" aria-hidden="true">${Array.from({ length: bars }, (_, i) => `<span style="left:${i / bars * 100}%">${i % 4 === 0 ? i + 1 : '·'}</span>`).join('')}</div><input id="song-position" type="range" min="0" max="${Math.min(MAX_START_SECONDS, seconds - .01)}" step="0.01" value="${cursor}" aria-label="Position im Song" aria-valuetext="${time(cursor)}" data-focus="song-position" ${off(locked)}></div>
    <div class="timeline-label">Beats</div><div class="beats-lane">${beats || '<span class="empty-lane">Füge einen Beat hinzu oder sing direkt los.</span>'}</div>
    <div class="timeline-label">Stimme</div><div class="voice-lane" style="height:${Math.max(1, rowEnds.length) * 82 + 16}px">${voices || '<span class="empty-lane">Hier kommt deine Stimme hin. Auch ohne Beats.</span>'}</div>
    <div class="playhead-area" aria-hidden="true"><div id="song-playhead" style="left:${percent(cursor)}%"><span>▼</span></div></div>
  </div></div>`;
  const finishing = session?.phase === 'finishing' || session?.phase === 'saving';
  const buttonText = !session ? selected ? 'Neu aufnehmen' : 'Aufnahme starten'
    : session.phase === 'recording' ? 'Aufnahme beenden' : finishing ? 'Wird gespeichert…' : 'Einzählen…';
  const targetSeconds = selected?.startSeconds ?? cursor;
  return `${timeline}${state.editor}<section class="voice-recorder" aria-label="Gesangsaufnahme">
    <div class="record-target"><div class="headphone-choice"><strong>Trägst du Kopfhörer?</strong><div class="headphone-options"><label><input type="radio" name="headphones" value="no" ${!headphones ? 'checked' : ''} ${off(locked)}> Nein</label><label><input type="radio" name="headphones" value="yes" ${headphones ? 'checked' : ''} ${off(locked)}> Ja</label></div><p>${headphones ? 'Du hörst den Beat beim Aufnehmen über Kopfhörer.' : 'Beim Aufnehmen bleibt es stumm. Du siehst den Takt.'}</p></div><div class="record-controls">${session ? `<button class="action-button" data-action="cancel-record" ${off(finishing)}>Abbrechen</button>` : selected ? `<button class="action-button" data-action="new-vocal" ${off(locked)}>Neue Aufnahme</button>` : ''}<button class="record-button" data-action="record" data-focus="record" ${off(finishing || (!session && (locked || (!selected && project.vocals.length >= MAX_VOCALS))) || session?.phase === 'preparing' || session?.phase === 'count-in')}>● <span>${buttonText}</span></button></div></div>
    <p id="record-status" role="status">${session ? session.phase === 'preparing' ? 'Erlaube den Mikrofonzugriff. Dann geht es los.' : 'Gleich geht es los.' : `Ab ${time(targetSeconds)} · vier Schläge einzählen, dann singen. Stopp, wenn du fertig bist. Maximal zwei Minuten.`}</p>
    <div class="record-progress"><div id="record-progress-fill"></div></div>
    ${!selected && project.vocals.length >= MAX_VOCALS ? '<p>Acht Aufnahmen sind im Song. Wähle eine zum Ersetzen oder Entfernen.</p>' : ''}
    ${session ? '<div class="mic-meter" role="meter" aria-label="Mikrofonpegel" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span>Mikrofon</span><i><b id="mic-level"></b></i></div>' : ''}
    <details data-panel="voice" class="settings-panel"><summary>Stimme &amp; Beat mischen</summary><div class="voice-mix-controls"><label>Beat<input type="range" min="0" max="100" value="${Math.round(project.beatLevel * 100)}" data-voice-control="beat" aria-label="Beat Lautstärke" data-focus="beat-level" ${off(locked)}></label><label>Meine Stimme<input type="range" min="0" max="100" value="${Math.round((selected?.volume ?? .9) * 100)}" data-voice-control="volume" aria-label="Stimme Lautstärke" data-focus="voice-level" ${off(locked || !selected)}></label>${selected ? `<button class="action-button" data-action="remove-vocal" ${off(locked)}>Aufnahme entfernen</button>` : ''}</div>
    ${selected ? `<div class="voice-timing"><label><span>Früher</span><input type="range" min="-250" max="250" step="10" value="${selected.shiftMs}" data-voice-control="timing" data-focus="voice-timing" aria-label="Stimme zeitlich verschieben" ${off(locked)}><span>Später</span><output id="timing-value">${selected.shiftMs} ms</output></label><p>Falls deine Aufnahme etwas neben dem Beat sitzt.</p></div><div class="clip-position"><label>Start (Sekunden)<input type="number" min="0" max="${MAX_START_SECONDS}" step="0.1" value="${selected.startSeconds}" data-clip-position="startSeconds" data-focus="clip-start" ${off(locked)}></label><label>Länge (Sekunden)<input type="number" min="0.1" max="${MAX_TAKE_SECONDS}" step="0.1" value="${selected.durationSeconds}" data-clip-position="durationSeconds" data-focus="clip-duration" ${off(locked)}></label></div>` : ''}</details>
  </section>`;
}
