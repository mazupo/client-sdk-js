import { RtcPeer, RtcPeerConfig } from "./rtc-peer";

/**
 * A cf-sfu-worker room's one PeerConnection to the SFU. The room decides when to offer, groups
 * tracks by the device their mid belongs to, and starts over with a new session when the
 * connection fails, so this peer neither offers nor restarts ICE on its own.
 */
export class CloudflarePeer extends RtcPeer {
  /** A track arrived. The room maps it to a device by its mid. */
  onTrack?: (event: RTCTrackEvent) => void;

  constructor(config: RtcPeerConfig) {
    super(config);
  }

  protected override restartsIce(): boolean {
    return false;
  }

  protected override onNegotiationNeeded(): void {
  }

  protected override handleTrack(event: RTCTrackEvent): void {
    this.applyJitterBufferTarget(event.receiver);
    if (event.track.kind === "audio") {
      event.track.enabled = this.options.isSpeakerOn ?? true;
    }
    this.onTrack?.(event);
  }

  /** Our own offer, set as the local description. */
  async offer(): Promise<string> {
    await this.peer.setLocalDescription(await this.peer.createOffer());
    return this.peer.localDescription?.sdp ?? "";
  }

  /** Answers the SFU's offer. */
  async answer(sdp: string): Promise<string> {
    await this.peer.setRemoteDescription({ type: "offer", sdp });
    const answer = await this.peer.createAnswer();
    await this.peer.setLocalDescription(answer);
    return answer.sdp ?? "";
  }

  /** The SFU's answer to our own offer. */
  async applyAnswer(sdp: string): Promise<void> {
    await this.peer.setRemoteDescription({ type: "answer", sdp });
  }

  /** A channel negotiated on the id the worker gave, or `server-events` on id 0. */
  openChannel(label: string, id: number, init: RTCDataChannelInit = {}): RTCDataChannel {
    const channel = this.peer.createDataChannel(label, { ...init, negotiated: true, id });
    channel.binaryType = "arraybuffer";
    return channel;
  }

  transceivers(): RTCRtpTransceiver[] {
    return this.peer.getTransceivers();
  }
}
