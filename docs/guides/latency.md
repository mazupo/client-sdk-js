# Latency

The browser buffers a few hundred milliseconds of video before it plays. On a fast local network, that buffer only adds delay. `jitterBufferTarget` sets how much to buffer: less buffering means less delay, but more freezes.

## Set the buffer

```javascript
import { PiCamera } from '@mazupo/client';

const camera = new PiCamera({
  uid: 'your-custom-uid',
  mqttHost: 'your.mqtt.cloud',
  mqttPath: '/mqtt',
  mqttPort: 8884,
  mqttUsername: 'hakunamatata',
  mqttPassword: 'Wonderful',
  stunUrls: ['stun:stun1.l.google.com:19302'],
  jitterBufferTarget: 10,
});

camera.onStream = (stream) => {
  document.querySelector('#videoElement').srcObject = stream;
};

camera.connect();

// Buffer more when the network turns out to be worse.
document.querySelector('#buffer').oninput = (event) => {
  camera.setJitterBufferTarget(Number(event.target.value));
};
```

## Measure the result

The browser moves toward the target over several seconds. `getStats()` shows how much it really buffers, and `freezeCount` shows the cost.

```javascript
let last = null;

setInterval(async () => {
  const report = await camera.getStats();

  report?.forEach((stat) => {
    if (stat.type !== 'inbound-rtp' || stat.kind !== 'video') {
      return;
    }
    if (last && stat.jitterBufferEmittedCount > last.count) {
      const ms = (stat.jitterBufferDelay - last.delay) /
        (stat.jitterBufferEmittedCount - last.count) * 1000;
      console.log(`buffered ${ms.toFixed(0)}ms, ${stat.freezeCount} freezes`);
    }
    last = { delay: stat.jitterBufferDelay, count: stat.jitterBufferEmittedCount };
  });
}, 2000);
```

See [setJitterBufferTarget](../reference/methods.md#setjitterbuffertarget) for the browser support.
