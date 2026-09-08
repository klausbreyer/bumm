export interface MicrophoneInput { id: string; label: string }
type Devices = Pick<MediaDevices, 'enumerateDevices' | 'getUserMedia'>;

export async function listMicrophones(media: Devices): Promise<MicrophoneInput[]> {
  const devices = await media.enumerateDevices();
  return devices.filter(device => device.kind === 'audioinput' && device.deviceId && device.deviceId !== 'default')
    .map((device, index) => ({ id: device.deviceId, label: device.label || `Mikrofon ${index + 1}` }));
}

/** Ask for device names on a user gesture, then release the temporary stream. */
export async function requestMicrophones(media: Devices): Promise<MicrophoneInput[]> {
  const stream = await media.getUserMedia({ audio: true, video: false });
  try { return await listMicrophones(media); }
  finally { stream.getTracks().forEach(track => track.stop()); }
}
