import { ROLES, ROLE_NAMES, findLoop } from '../music/catalog';
import type { Project } from '../music/project';
import type { Schedule } from '../audio/browser-engine';

export interface RecordingSession {
  partId: string;
  phase: 'preparing' | 'count-in' | 'recording' | 'finishing' | 'saving';
  schedule?: Schedule;
}

const esc = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const off = (condition: boolean) => condition ? 'disabled' : '';
const mic = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/></svg>';

export function vocalWave(peaks: number[]): string {
  return `<svg class="vocal-waveform" viewBox="0 0 256 40" preserveAspectRatio="none" aria-hidden="true">${peaks.map((peak, i) => `<rect x="${i * 4}" y="${20 - Math.max(1, peak * 21)}" width="2" height="${Math.max(2, peak * 42)}" fill="currentColor"/>`).join('')}</svg>`;
}

export function vocalWorkspace(project: Project, selectedId: string | null, session: RecordingSession | null, waves: Map<string, number[]>, locked: boolean): string {
  const selected = project.song.find(part => part.id === selectedId);
  if (!project.song.length) return '<div class="vocal-empty">Merke dir zuerst eine Mischung als Songteil. Danach kannst du dazu singen.</div>';
  const count = project.song.length;
  const columns = `96px ${project.song.map(part => `${part.bars}fr`).join(' ')}`;
  const timeline = `<div class="vocal-scroll" tabindex="0" role="region" aria-label="Beat- und Gesangsspuren"><div class="vocal-grid" style="grid-template-columns:${columns};min-width:${96 + count * 155}px">
    <div class="lane-heading">SONGTEILE</div>${project.song.map((part, i) => `<button class="vocal-part-heading ${part.id === selectedId ? 'chosen' : ''}" data-action="select-vocal" data-id="${esc(part.id)}" data-focus="select-${esc(part.id)}" aria-label="${esc(part.name)} zum Einsingen auswählen" aria-pressed="${part.id === selectedId}" ${off(locked)}><span>${String(i + 1).padStart(2, '0')} · ${part.bars} Takte</span><strong>${esc(part.name)}</strong></button>`).join('')}
    ${ROLES.map(role => `<div class="lane-label role-${role}">${ROLE_NAMES[role]}</div>${project.song.map(part => `<div class="beat-clip role-${role} ${part.mix.loops[role] ? 'filled' : ''}">${part.mix.loops[role] ? esc(findLoop(part.mix.loops[role]!).name) : '<span class="clip-rest">·</span>'}</div>`).join('')}`).join('')}
    <div class="lane-label voice-lane-label">${mic}<span>Meine<br>Stimme</span></div>${project.song.map(part => `<button class="voice-clip ${part.vocal ? 'has-voice' : ''} ${part.id === selectedId ? 'chosen' : ''}" data-action="select-vocal" data-id="${esc(part.id)}" data-vocal-part="${esc(part.id)}" aria-label="Stimme für ${esc(part.name)} auswählen" ${off(locked)}>${part.vocal ? `<span>Deine Aufnahme</span>${waves.has(part.vocal.takeId) ? vocalWave(waves.get(part.vocal.takeId)!) : '<span class="wave-loading">Wellenform wird geladen</span>'}` : `<span>${part.id === selectedId ? '↓ Hier singst du rein' : '+ Stimme dazu'}</span>`}</button>`).join('')}
    <div class="lane-heading">ANORDNEN</div>${project.song.map((part, i) => `<div class="vocal-part-tools"><button data-action="move-left" data-id="${esc(part.id)}" aria-label="${esc(part.name)} nach links" ${off(locked || i === 0)}>‹</button><button data-action="move-right" data-id="${esc(part.id)}" aria-label="${esc(part.name)} nach rechts" ${off(locked || i === count - 1)}>›</button><button data-action="copy-part" data-id="${esc(part.id)}" aria-label="${esc(part.name)} samt Stimme kopieren" ${off(locked || count >= 8)}>＋</button><button class="edit-sounds" data-action="edit-part" data-id="${esc(part.id)}" aria-label="Sounds von ${esc(part.name)} bearbeiten" ${off(locked)}>Sounds ↗</button></div>`).join('')}
  </div></div>`;
  if (!selected) return timeline;
  const vocal = selected.vocal;
  const active = session !== null;
  const finishing = session?.phase === 'finishing' || session?.phase === 'saving';
  const buttonText = !session ? vocal ? 'Nochmal aufnehmen' : `${selected.name} aufnehmen`
    : session.phase === 'preparing' ? 'Mikrofon wird bereit…' : session.phase === 'count-in' ? 'Einzählen…'
      : session.phase === 'recording' ? 'Aufnahme beenden' : 'Aufnahme wird gespeichert…';
  return `${timeline}<section class="voice-recorder" aria-label="Gesangsaufnahme">
    <div class="record-target"><div class="record-target-copy"><h3>Deine Stimme für „${esc(selected.name)}“</h3><p id="record-status" role="status">${session ? 'Gleich geht es los.' : `${selected.bars} Takte · ${Math.round(selected.bars * 240 / project.bpm)} Sekunden. Vier Schläge zum Einzählen.`}</p></div><div class="record-controls"><button class="record-button" data-action="record" data-focus="record" ${off(finishing || (!active && locked) || session?.phase === 'preparing' || session?.phase === 'count-in')}>${mic}<span>${esc(buttonText)}</span></button>${active ? `<button class="cancel-record" data-action="cancel-record" ${off(finishing)}>Abbrechen</button>` : `<button class="text-button" data-action="preview-part" ${off(locked)}>▶ Teil anhören</button>`}</div></div>
    <div class="record-progress"><div id="record-progress-fill"></div></div>
    <div class="voice-mix-controls"><label>Beat<input type="range" min="0" max="100" value="${Math.round(project.beatLevel * 100)}" data-voice-control="beat" aria-label="Beat Lautstärke" data-focus="beat-level" ${off(locked)}></label><label>Meine Stimme<input type="range" min="0" max="100" value="${Math.round((vocal?.volume ?? .9) * 100)}" data-voice-control="volume" aria-label="Stimme Lautstärke" data-focus="voice-level" ${off(locked || !vocal)}></label><div class="mic-meter" role="meter" aria-label="Mikrofonpegel" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span>Mikrofon</span><i><b id="mic-level"></b></i></div>${vocal ? `<button class="text-button remove-voice" data-action="remove-vocal" ${off(locked)}>Aufnahme entfernen</button>` : ''}</div>
    ${vocal ? `<details class="voice-timing"><summary>Stimme früher oder später einsetzen</summary><label><span>Früher</span><input type="range" min="-250" max="250" step="10" value="${vocal.shiftMs}" data-voice-control="timing" data-focus="voice-timing" aria-label="Stimme zeitlich verschieben" ${off(locked)}><span>Später</span><output id="timing-value">${vocal.shiftMs} ms</output></label><p>Falls deine Aufnahme etwas neben dem Beat sitzt. Die Melodie bleibt gleich.</p></details>` : ''}
    <p class="record-note">Kopfhörer auf, damit nur deine Stimme aufgenommen wird. Beim Verschieben oder Kopieren geht sie mit ihrem Songteil mit.</p>
  </section>`;
}
