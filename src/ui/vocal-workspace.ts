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
  if (!project.song.length) return '<div class="vocal-empty"><p>Merke dir zuerst eine Mischung als Songteil. Danach kannst du dazu singen.</p><button class="action-button" data-action="view-loops">Zum Beat-Baukasten</button></div>';
  const count = project.song.length;
  const columns = `112px ${project.song.map(part => `${part.bars}fr`).join(' ')}`;
  const timeline = `<div class="vocal-scroll" tabindex="0" role="region" aria-label="Beat- und Gesangsspuren"><div class="vocal-grid" style="grid-template-columns:${columns};min-width:${112 + count * 155}px">
    <div class="lane-heading">Songteile</div>${project.song.map((part, i) => `<button class="vocal-part-heading ${part.id === selectedId ? 'chosen' : ''}" data-action="select-vocal" data-id="${esc(part.id)}" data-focus="select-${esc(part.id)}" aria-label="${esc(part.name)} zum Einsingen auswählen" aria-pressed="${part.id === selectedId}" ${off(locked)}><span>${String(i + 1).padStart(2, '0')} · ${part.bars} Takte</span><strong>${esc(part.name)}</strong></button>`).join('')}
    ${ROLES.map(role => `<div class="lane-label role-${role}">${ROLE_NAMES[role]}</div>${project.song.map(part => `<div class="beat-clip role-${role} ${part.mix.loops[role] ? 'filled' : ''}">${part.mix.loops[role] ? esc(findLoop(part.mix.loops[role]!).name) : '<span class="clip-rest">·</span>'}</div>`).join('')}`).join('')}
    <div class="lane-label voice-lane-label">${mic}<span>Meine<br>Stimme</span></div>${project.song.map(part => `<button class="voice-clip ${part.vocal ? 'has-voice' : ''} ${part.id === selectedId ? 'chosen' : ''}" data-action="select-vocal" data-id="${esc(part.id)}" data-vocal-part="${esc(part.id)}" aria-label="Stimme für ${esc(part.name)} auswählen" ${off(locked)}>${part.vocal ? `<span>Deine Aufnahme</span>${waves.has(part.vocal.takeId) ? vocalWave(waves.get(part.vocal.takeId)!) : '<span class="wave-loading">Wellenform wird geladen</span>'}` : `<span>${part.id === selectedId ? 'Hier kommt deine Stimme hin' : '+ Stimme dazu'}</span>`}</button>`).join('')}
  </div></div>`;
  if (!selected) return timeline;
  const vocal = selected.vocal;
  const index = project.song.indexOf(selected);
  const id = esc(selected.id);
  const active = session !== null;
  const finishing = session?.phase === 'finishing' || session?.phase === 'saving';
  const buttonText = !session ? vocal ? 'Nochmal aufnehmen' : 'Jetzt aufnehmen'
    : session.phase === 'preparing' ? 'Mikrofon wird bereit…' : session.phase === 'count-in' ? 'Einzählen…'
      : session.phase === 'recording' ? 'Aufnahme beenden' : 'Aufnahme wird gespeichert…';
  return `${timeline}<section class="voice-recorder" aria-label="Gesangsaufnahme">
    <div class="record-target"><div class="record-target-copy"><h3>Deine Stimme für „${esc(selected.name)}“</h3><p id="record-status" role="status">${session ? 'Gleich geht es los.' : `${selected.bars} Takte · ${Math.round(selected.bars * 240 / project.bpm)} Sekunden. Kopfhörer auf, dann vier Schläge zum Einzählen.`}</p></div><div class="record-controls">${active ? `<button class="action-button cancel-record" data-action="cancel-record" ${off(finishing)}>Abbrechen</button>` : `<button class="action-button" data-action="preview-part" ${off(locked)}>▶ Teil anhören</button>`}<button class="record-button" data-action="record" data-focus="record" ${off(finishing || (!active && locked) || session?.phase === 'preparing' || session?.phase === 'count-in')}>${mic}<span>${esc(buttonText)}</span></button></div></div>
    <div class="record-progress"><div id="record-progress-fill"></div></div>
    ${active ? '<div class="mic-meter" role="meter" aria-label="Mikrofonpegel" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span>Mikrofon</span><i><b id="mic-level"></b></i></div>' : ''}
    <div class="song-settings">
      <details data-panel="part" class="settings-panel"><summary>Songteil bearbeiten</summary><div class="part-editor">
        <label>Name<input class="part-name" aria-label="Name des Songteils" maxlength="24" value="${esc(selected.name)}" data-name="${id}" data-focus="name-${id}" ${off(locked)}></label>
        <label>Länge<select data-bars="${id}" data-focus="bars-${id}" aria-label="Länge des Songteils" ${vocal ? 'aria-describedby="part-length-hint"' : ''} ${off(locked)}><option value="4" ${selected.bars === 4 ? 'selected' : ''}>4 Takte</option><option value="8" ${selected.bars === 8 ? 'selected' : ''}>8 Takte</option></select></label>
        ${vocal ? '<p id="part-length-hint" class="part-length-note">Deine Aufnahme bleibt gespeichert. Sie spielt nur so lange wie der Songteil.</p>' : ''}
        <div class="part-actions"><button class="action-button" data-action="move-left" data-id="${id}" aria-label="${esc(selected.name)} nach links" ${off(locked || index === 0)}>← Links</button><button class="action-button" data-action="move-right" data-id="${id}" aria-label="${esc(selected.name)} nach rechts" ${off(locked || index === count - 1)}>Rechts →</button><button class="action-button" data-action="copy-part" data-id="${id}" ${off(locked || count >= 8)}>Kopieren</button><button class="action-button" data-action="edit-part" data-id="${id}" ${off(locked)}>Sounds ändern</button><button class="action-button" data-action="delete-part" data-id="${id}" ${off(locked)}>Entfernen</button></div>
      </div></details>
      <details data-panel="voice" class="settings-panel"><summary>Stimme &amp; Beat mischen</summary><div class="voice-mix-controls"><label>Beat<input type="range" min="0" max="100" value="${Math.round(project.beatLevel * 100)}" data-voice-control="beat" aria-label="Beat Lautstärke" data-focus="beat-level" ${off(locked)}></label><label>Meine Stimme<input type="range" min="0" max="100" value="${Math.round((vocal?.volume ?? .9) * 100)}" data-voice-control="volume" aria-label="Stimme Lautstärke" data-focus="voice-level" ${off(locked || !vocal)}></label>${vocal ? `<button class="action-button remove-voice" data-action="remove-vocal" ${off(locked)}>Aufnahme entfernen</button>` : ''}</div>
      ${vocal ? `<div class="voice-timing"><label><span>Früher</span><input type="range" min="-250" max="250" step="10" value="${vocal.shiftMs}" data-voice-control="timing" data-focus="voice-timing" aria-label="Stimme zeitlich verschieben" ${off(locked)}><span>Später</span><output id="timing-value">${vocal.shiftMs} ms</output></label><p>Falls deine Aufnahme etwas neben dem Beat sitzt.</p></div>` : ''}</details>
    </div>
  </section>`;
}
