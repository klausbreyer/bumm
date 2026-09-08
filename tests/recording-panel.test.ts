import { expect, test } from 'bun:test';
import { makeProject } from '../src/music/project';
import { recordingPanel } from '../src/ui/vocal-workspace';

const project = makeProject('techno');
project.vocals = [{ id: 'voice', takeId: 'take', startSeconds: 2, durationSeconds: 4, volume: .9, shiftMs: 0 }];
const state = {
  editingId: null, selectedVocalId: 'voice', session: null, waves: new Map(),
  locked: false, headphones: false, cursor: 2, microphone: '<select id="microphone-input"></select>',
  microphoneUnavailable: false, voiceSetup: false,
};

test('editing a recording shows its mix, delete and replacement without microphone setup', () => {
  const html = recordingPanel(project, state);
  expect(html).toContain('data-action="remove-vocal"');
  expect(html).toContain('data-action="prepare-replacement"');
  expect(html).toContain('Mix dieser Aufnahme');
  expect(html).not.toContain('microphone-input');
  expect(html).not.toContain('name="headphones"');
  expect(html).not.toContain('class="record-button"');
});

test('new and replacement recording setup shows capture options without clip editing', () => {
  for (const selectedVocalId of [null, 'voice']) {
    const html = recordingPanel(project, { ...state, selectedVocalId, voiceSetup: true });
    expect(html).toContain('microphone-input');
    expect(html).toContain('name="headphones"');
    expect(html).toContain('Aufnahme starten');
    expect(html).not.toContain('Mix dieser Aufnahme');
    expect(html).not.toContain('data-action="remove-vocal"');
    if (selectedVocalId) expect(html).toContain('data-action="cancel-setup"');
  }
});
