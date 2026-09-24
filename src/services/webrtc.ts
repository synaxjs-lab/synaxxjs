export type WebRTCCallType = 'voice' | 'video';

type ConnectionState = 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed';

type IceServer = RTCIceServer;

export class WebRTCManager {
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteDescriptionReady = false;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private currentIceGeneration = 0;

  onRemoteStream: ((stream: MediaStream) => void) | null = null;
  onConnectionState: ((state: ConnectionState) => void) | null = null;
  onIceCandidate: ((candidate: RTCIceCandidateInit) => void) | null = null;

  private getIceServers(): IceServer[] {
    const servers: IceServer[] = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
    ];

    // Optional TURN. These values are deliberately public runtime config because
    // browsers need the relay credentials; do not put a Supabase service key here.
    const turnUrl = (import.meta as any).env?.VITE_TURN_URL as string | undefined;
    const turnUsername = (import.meta as any).env?.VITE_TURN_USERNAME as string | undefined;
    const turnCredential = (import.meta as any).env?.VITE_TURN_CREDENTIAL as string | undefined;
    if (turnUrl && turnUsername && turnCredential) {
      servers.push({ urls: turnUrl, username: turnUsername, credential: turnCredential });
    }

    return servers;
  }

  private createPeerConnection(): RTCPeerConnection {
    if (this.pc) return this.pc;

    const pc = new RTCPeerConnection({
      iceServers: this.getIceServers(),
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    });

    const generation = ++this.currentIceGeneration;

    pc.ontrack = (event) => {
      const stream = event.streams?.[0] || new MediaStream([event.track]);
      this.onRemoteStream?.(stream);
    };

    pc.onicecandidate = (event) => {
      if (!event.candidate || generation !== this.currentIceGeneration) return;
      this.onIceCandidate?.(event.candidate.toJSON());
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState as ConnectionState;
      this.onConnectionState?.(state);
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        this.onConnectionState?.('connected');
      } else if (pc.iceConnectionState === 'checking') {
        this.onConnectionState?.('connecting');
      } else if (pc.iceConnectionState === 'failed') {
        this.onConnectionState?.('failed');
      } else if (pc.iceConnectionState === 'disconnected') {
        this.onConnectionState?.('disconnected');
      }
    };

    this.pc = pc;
    return pc;
  }

  private addLocalTracks(stream: MediaStream) {
    const pc = this.createPeerConnection();
    const existing = new Set(pc.getSenders().map((sender) => sender.track?.id).filter(Boolean));
    for (const track of stream.getTracks()) {
      if (!existing.has(track.id)) pc.addTrack(track, stream);
    }
  }

  async createOffer(_callType: WebRTCCallType, stream: MediaStream): Promise<RTCSessionDescriptionInit> {
    this.cleanupPeerOnly();
    this.localStream = stream;
    const pc = this.createPeerConnection();
    this.addLocalTracks(stream);

    this.onConnectionState?.('connecting');
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    // Include a complete ICE candidate set in the SDP as well as trickled
    // candidates. This is especially important for mobile-to-desktop calls:
    // if a candidate polling request is delayed, the peer still receives the
    // candidates gathered in the offer itself. Never wait forever.
    await this.waitForIceGatheringComplete(pc, 7000);
    return pc.localDescription?.toJSON() || offer;
  }

  async handleOfferAndCreateAnswer(
    offer: RTCSessionDescriptionInit,
    _callType: WebRTCCallType,
    stream: MediaStream
  ): Promise<RTCSessionDescriptionInit> {
    this.cleanupPeerOnly();
    this.localStream = stream;
    const pc = this.createPeerConnection();

    await pc.setRemoteDescription(offer);
    this.remoteDescriptionReady = true;
    await this.applyPendingCandidates();

    this.addLocalTracks(stream);
    this.onConnectionState?.('connecting');
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    // Return an answer containing gathered candidates too, so the caller can
    // establish ICE even if an individual candidate signal is delayed.
    await this.waitForIceGatheringComplete(pc, 7000);
    return pc.localDescription?.toJSON() || answer;
  }

  private async waitForIceGatheringComplete(pc: RTCPeerConnection, timeoutMs: number): Promise<void> {
    if (pc.iceGatheringState === 'complete') return;

    await new Promise<void>((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        window.clearTimeout(timeout);
        pc.removeEventListener('icegatheringstatechange', onState);
        resolve();
      };
      const onState = () => {
        if (pc.iceGatheringState === 'complete') finish();
      };
      const timeout = window.setTimeout(finish, timeoutMs);
      pc.addEventListener('icegatheringstatechange', onState);
      if (pc.iceGatheringState === 'complete') finish();
    });
  }

  async handleAnswer(sdp: RTCSessionDescriptionInit) {
    const pc = this.pc;
    if (!pc || !sdp) return;
    if (pc.signalingState === 'closed') return;
    await pc.setRemoteDescription(sdp);
    this.remoteDescriptionReady = true;
    await this.applyPendingCandidates();
  }

  async addIceCandidate(candidate: RTCIceCandidateInit) {
    if (!candidate) return;
    if (!this.pc || !this.remoteDescriptionReady) {
      this.pendingCandidates.push(candidate);
      return;
    }
    try {
      await this.pc.addIceCandidate(candidate);
    } catch (err) {
      console.warn('Failed to add ICE candidate:', err);
    }
  }

  private async applyPendingCandidates() {
    if (!this.pc || !this.remoteDescriptionReady) return;
    const candidates = this.pendingCandidates.splice(0);
    for (const candidate of candidates) {
      try { await this.pc.addIceCandidate(candidate); }
      catch (err) { console.warn('Failed to apply queued ICE candidate:', err); }
    }
  }

  toggleMute(muted: boolean) {
    this.localStream?.getAudioTracks().forEach((track) => { track.enabled = !muted; });
  }

  toggleCamera(disabled: boolean) {
    this.localStream?.getVideoTracks().forEach((track) => { track.enabled = !disabled; });
  }

  private cleanupPeerOnly() {
    this.currentIceGeneration += 1;
    if (this.pc) {
      try { this.pc.ontrack = null; } catch {}
      try { this.pc.onicecandidate = null; } catch {}
      try { this.pc.onconnectionstatechange = null; } catch {}
      try { this.pc.oniceconnectionstatechange = null; } catch {}
      try { this.pc.close(); } catch {}
    }
    this.pc = null;
    this.remoteDescriptionReady = false;
    this.pendingCandidates = [];
  }

  cleanup() {
    this.cleanupPeerOnly();
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
    }
    this.localStream = null;
    this.onIceCandidate = null;
  }
}
