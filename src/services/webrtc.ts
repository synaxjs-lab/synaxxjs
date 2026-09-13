import { socketService } from './socket';

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ],
  iceCandidatePoolSize: 10,
};

export class WebRTCManager {
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream = new MediaStream();
  private callType: 'voice' | 'video' = 'voice';
  private iceCandidateQueue: RTCIceCandidateInit[] = [];

  public onRemoteStream?: (stream: MediaStream) => void;
  public onConnectionState?: (state: RTCPeerConnectionState) => void;
  public onError?: (err: any) => void;

  private initPeerConnection() {
    // Close only the previous peer connection here. Do not clear localStream,
    // because createOffer()/handleOfferAndCreateAnswer() set it immediately
    // before initializing the new peer connection.
    if (this.pc) {
      this.pc.ontrack = null;
      this.pc.onicecandidate = null;
      this.pc.onconnectionstatechange = null;
      this.pc.close();
      this.pc = null;
    }
    this.remoteStream = new MediaStream();
    this.iceCandidateQueue = [];
    this.pc = new RTCPeerConnection(RTC_CONFIG);

    this.pc.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        if (this.onRemoteStream) {
          this.onRemoteStream(event.streams[0]);
        }
      } else {
        this.remoteStream.addTrack(event.track);
        if (this.onRemoteStream) {
          this.onRemoteStream(this.remoteStream);
        }
      }
    };

    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        socketService.sendCallSignal({
          type: 'call:ice-candidate',
          candidate: event.candidate,
        });
      }
    };

    this.pc.onconnectionstatechange = () => {
      if (this.pc && this.onConnectionState) {
        this.onConnectionState(this.pc.connectionState);
      }
    };
  }

  async createOffer(callType: 'voice' | 'video', localStream: MediaStream): Promise<RTCSessionDescriptionInit> {
    this.callType = callType;
    this.localStream = localStream;
    this.initPeerConnection();

    this.localStream.getTracks().forEach((track) => {
      if (this.pc && this.localStream) {
        this.pc.addTrack(track, this.localStream);
      }
    });

    const offer = await this.pc!.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: callType === 'video',
    });

    await this.pc!.setLocalDescription(offer);
    return offer;
  }

  async handleOfferAndCreateAnswer(
    offer: RTCSessionDescriptionInit,
    callType: 'voice' | 'video',
    localStream: MediaStream
  ): Promise<RTCSessionDescriptionInit> {
    this.callType = callType;
    this.localStream = localStream;
    this.initPeerConnection();

    this.localStream.getTracks().forEach((track) => {
      if (this.pc && this.localStream) {
        this.pc.addTrack(track, this.localStream);
      }
    });

    await this.pc!.setRemoteDescription(new RTCSessionDescription(offer));
    await this.drainQueuedCandidates();
    const answer = await this.pc!.createAnswer();
    await this.pc!.setLocalDescription(answer);
    return answer;
  }

  async handleAnswer(answer: RTCSessionDescriptionInit) {
    if (this.pc && this.pc.signalingState !== 'closed') {
      await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
      await this.drainQueuedCandidates();
    }
  }

  async addIceCandidate(candidate: RTCIceCandidateInit) {
    if (!candidate) return;
    if (this.pc && this.pc.remoteDescription && this.pc.remoteDescription.type) {
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.warn('Error adding ICE candidate directly:', err);
      }
    } else {
      this.iceCandidateQueue.push(candidate);
    }
  }

  private async drainQueuedCandidates() {
    if (!this.pc || !this.pc.remoteDescription) return;
    while (this.iceCandidateQueue.length > 0) {
      const cand = this.iceCandidateQueue.shift();
      if (cand) {
        try {
          await this.pc.addIceCandidate(new RTCIceCandidate(cand));
        } catch (err) {
          console.warn('Error applying queued ICE candidate:', err);
        }
      }
    }
  }

  toggleMute(muted: boolean) {
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((track) => {
        track.enabled = !muted;
      });
    }
  }

  toggleCamera(cameraOff: boolean) {
    if (this.localStream) {
      this.localStream.getVideoTracks().forEach((track) => {
        track.enabled = !cameraOff;
      });
    }
  }

  cleanup() {
    if (this.pc) {
      this.pc.ontrack = null;
      this.pc.onicecandidate = null;
      this.pc.onconnectionstatechange = null;
      this.pc.close();
      this.pc = null;
    }
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }
    this.remoteStream = new MediaStream();
  }
}
