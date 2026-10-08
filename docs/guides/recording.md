# Recording

Start and stop the device's recorder, and download recorded files. Both use the DataChannel, so they need the `mqtt` signaling.

## Start and stop recording

The device must run with `--record-mode=on-demand` (or `both`). Recording runs until you call `stopRecording()`. Nothing ends the file on its own. `onRecording` reports each change, with the path of the file.

```javascript
import { ChannelRole, PiCamera } from '@mazupo/client';

const camera = new PiCamera({
  uid: 'your-custom-uid',
  mqttHost: 'your.mqtt.cloud',
  mqttPath: '/mqtt',
  mqttPort: 8884,
  mqttUsername: 'hakunamatata',
  mqttPassword: 'Wonderful',
  stunUrls: ['stun:stun1.l.google.com:19302'],
  datachannelOnly: true,
});

camera.onDatachannel = (role) => {
  if (role === ChannelRole.Command) {
    camera.startRecording();

    // Here a 10-second timer stops the recording. In your app, use a button, a motion event
    // or a page unload instead.
    setTimeout(() => camera.stopRecording(), 10000);
  }
};

camera.onRecording = (res) => {
  console.log('isRecording:', res.isRecording);
  console.log('filepath:', res.filepath);
};

camera.connect();
```

## Download a recorded file

This lists the recordings, downloads the newest file, and saves it as a normal browser download. `onProgress` reports the bytes as they arrive.

```javascript
import { PiCamera } from '@mazupo/client';

const camera = new PiCamera({
  uid: 'your-custom-uid',
  mqttHost: 'your.mqtt.cloud',
  mqttPath: '/mqtt',
  mqttPort: 8884,
  mqttUsername: 'hakunamatata',
  mqttPassword: 'Wonderful',
  datachannelOnly: true,
  stunUrls: ['stun:stun1.l.google.com:19302'],
});

camera.onDatachannel = () => {
  camera.fetchVideoList();
};

camera.onVideoListLoaded = (res) => {
  camera.downloadVideoFile(res.files[0].filepath);
};

camera.onProgress = (received, total, type) => {
  console.log('progress', { received, total, type });
};

camera.onVideoDownloaded = (file) => {
  const blob = new Blob([file], { type: 'video/mp4' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = 'video_filename.mp4';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);

  camera.terminate();
};

camera.connect();
```

To page through older files, see [fetchVideoList](../reference/methods.md#fetchvideolist). For the files on the device, see [Recording in the pi-webrtc docs](https://mazupo.com/docs/pi-webrtc/recording).
