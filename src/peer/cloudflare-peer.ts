import { RtcPeer, RtcPeerConfig } from "./rtc-peer";

/** A cf-sfu-worker room's PeerConnection. The room decides when to offer, so this peer neither offers nor restarts ICE. */
export class CloudflarePeer extends RtcPeer {
  /** A track arrived. The room maps it to a device by its mid. */
  onTrack?: (event: RTCTrackEvent) => void;

  private microphone?: RTCRtpTransceiver;

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

  get signalingState(): RTCSignalingState {
    return this.peer.signalingState;
  }

  /** Our own offer with the microphone added, sendonly. Returns it with the microphone's mid. */
  async offerMicrophone(track: MediaStreamTrack, stream: MediaStream): Promise<{ sdp: string; mid: string }> {
    this.microphone = this.peer.addTransceiver(track, { direction: "sendonly", streams: [stream] });
    await this.peer.setLocalDescription(await this.peer.createOffer());
    return { sdp: this.peer.localDescription?.sdp ?? "", mid: this.microphone.mid ?? "" };
  }

  /** Takes back a microphone offer the worker refused. */
  async rollbackMicrophone(): Promise<void> {
    if (this.peer.signalingState === "have-local-offer") {
      await this.peer.setLocalDescription({ type: "rollback" });
    }
    this.microphone?.stop();
    this.microphone = undefined;
  }
}
