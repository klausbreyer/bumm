import { expect, test } from 'bun:test';
import { listMicrophones, requestMicrophones } from '../src/audio/microphone-inputs';

function media(fail = false) {
  let stopped = false;
  const devices = {
    enumerateDevices: async () => {
      if (fail) throw new Error('devices unavailable');
      return [
        { kind: 'audioinput', deviceId: 'default', label: 'Default' },
        { kind: 'audioinput', deviceId: 'usb', label: 'USB microphone' },
        { kind: 'audioinput', deviceId: 'built-in', label: '' },
        { kind: 'audiooutput', deviceId: 'speaker', label: 'Speakers' },
      ];
    },
    getUserMedia: async () => ({ getTracks: () => [{ stop() { stopped = true; } }] }),
  };
  return { devices: devices as unknown as MediaDevices, stopped: () => stopped };
}

test('microphone choices exclude speakers and the duplicated system default', async () => {
  expect(await listMicrophones(media().devices)).toEqual([{ id: 'usb', label: 'USB microphone' }, { id: 'built-in', label: 'Mikrofon 2' }]);
});

test('device permission discovery always releases the microphone, including enumeration errors', async () => {
  for (const fail of [false, true]) {
    const fixture = media(fail);
    if (fail) await expect(requestMicrophones(fixture.devices)).rejects.toThrow('devices unavailable');
    else expect(await requestMicrophones(fixture.devices)).toHaveLength(2);
    expect(fixture.stopped()).toBe(true);
  }
});
