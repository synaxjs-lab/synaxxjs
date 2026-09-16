import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Phone,
  PhoneOff,
  Video,
  VideoOff,
  Mic,
  MicOff,
  Maximize2,
  Minimize2,
  AlertCircle,
  Volume2
} from 'lucide-react';
import { WebRTCManager } from '../services/webrtc';
import { SoundEffects } from '../services/sound';
import { socketService } from '../services/socket';

export interface ActiveCallState {
  role: 'caller' | 'callee';
  status: 'calling' | 'ringing' | 'connected' | 'ended';
  callType: 'voice' | 'video';
  otherUserId: string;
  otherUserName: string;
  otherUserPfp: string;
  offerSdp?: RTCSessionDescriptionInit;
}

interface CallModalProps {
  callState: ActiveCallState;
  onClose: () => void;
}

export const CallModal: React.FC<CallModalProps> = ({ callState, onClose }) => {
  const [status, setStatus] = useState<'calling' | 'ringing' | 'connected' | 'ended'>(callState.status);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [connectionMessage, setConnectionMessage] = useState<string>('Initializing WebRTC...');
  const [hasError, setHasError] = useState<string | null>(null);

  const displayOtherUserName = callState.otherUserName?.trim() || 'Unknown Caller';
  const displayOtherUserPfp = callState.otherUserPfp?.trim() || '';

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rtcRef = useRef<WebRTCManager | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  // Sound ring controllers
  useEffect(() => {
    let stopRing: (() => void) | null = null;
    if (status === 'ringing') {
      stopRing = SoundEffects.startIncomingRing();
    } else if (status === 'calling') {
      stopRing = SoundEffects.startOutgoingRing();
    }

    return () => {
      if (stopRing) stopRing();
    };
  }, [status]);

  // Call duration counter
  useEffect(() => {
    let timer: any = null;
    if (status === 'connected') {
      timer = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [status]);

  // WebRTC Setup
  useEffect(() => {
    const rtc = new WebRTCManager();
    rtcRef.current = rtc;

    rtc.onRemoteStream = (stream) => {
      if (callState.callType === 'video' && remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = stream;
        remoteVideoRef.current.play().catch((err) => {
          console.warn('Autoplay prevented for remote video:', err);
        });
      }
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = stream;
        remoteAudioRef.current.play().catch((err) => {
          console.warn('Autoplay prevented for remote audio:', err);
        });
      }
    };

    rtc.onConnectionState = (state) => {
      if (state === 'connected') {
        setStatus('connected');
        setConnectionMessage('Connected (WebRTC Peer-to-Peer)');
      } else if (state === 'connecting') {
        setConnectionMessage('Establishing P2P link...');
      } else if (state === 'disconnected' || state === 'failed') {
        setConnectionMessage('Connection lost or failed');
      }
    };

    // Listen to signaling messages
    const unsubSignal = socketService.on('call:answer', async (data) => {
      if (data.sdp && rtcRef.current) {
        await rtcRef.current.handleAnswer(data.sdp);
      }
    });

    const unsubCandidate = socketService.on('call:ice-candidate', async (data) => {
      if (data.candidate && rtcRef.current) {
        await rtcRef.current.addIceCandidate(data.candidate);
      }
    });

    const unsubReject = socketService.on('call:reject', () => {
      setStatus('ended');
      setConnectionMessage('Call was declined');
      setTimeout(onClose, 2000);
    });

    const unsubEnd = socketService.on('call:end', () => {
      setStatus('ended');
      setConnectionMessage('Call ended');
      setTimeout(onClose, 1500);
    });

    const unsubError = socketService.on('call:error', (data) => {
      setHasError(data.error || 'Sanctuary call error occurred.');
      setStatus('ended');
      setTimeout(onClose, 2500);
    });

    // If caller, initiate media and create offer immediately
    if (callState.role === 'caller') {
      initiateCallerMedia(rtc);
    }

    return () => {
      unsubSignal();
      unsubCandidate();
      unsubReject();
      unsubEnd();
      unsubError();
      rtc.cleanup();
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  // Get local media for caller with fallback
  const initiateCallerMedia = async (rtc: WebRTCManager) => {
    try {
      setConnectionMessage('Requesting media devices...');
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: callState.callType === 'video',
        });
      } catch (err) {
        if (callState.callType === 'video') {
          console.warn('Video stream failed, attempting audio fallback...');
          stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        } else {
          throw err;
        }
      }

      localStreamRef.current = stream;

      if (callState.callType === 'video' && localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      setConnectionMessage('Ringing remote sanctuary...');
      const offer = await rtc.createOffer(callState.callType, stream);

      socketService.sendCallSignal({
        type: 'call:offer',
        callType: callState.callType,
        sdp: offer,
      });
    } catch (err: any) {
      console.error('Media permission failed:', err);
      setHasError(err.message || 'Permission denied for camera/microphone');
      setStatus('ended');
    }
  };

  // Callee accepts incoming call with fallback
  const handleAcceptCall = async () => {
    if (!rtcRef.current || !callState.offerSdp) return;
    try {
      setConnectionMessage('Accessing media devices...');
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: callState.callType === 'video',
        });
      } catch (err) {
        if (callState.callType === 'video') {
          console.warn('Video stream failed on answer, attempting audio fallback...');
          stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        } else {
          throw err;
        }
      }

      localStreamRef.current = stream;

      if (callState.callType === 'video' && localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      const answer = await rtcRef.current.handleOfferAndCreateAnswer(
        callState.offerSdp,
        callState.callType,
        stream
      );

      socketService.sendCallSignal({
        type: 'call:answer',
        callType: callState.callType,
        sdp: answer,
      });

      setStatus('connected');
    } catch (err: any) {
      console.error('Failed to answer call:', err);
      setHasError(err.message || 'Media permission failed');
    }
  };

  const handleRejectCall = () => {
    socketService.sendCallSignal({ type: 'call:reject' });
    setStatus('ended');
    onClose();
  };

  const handleEndCall = () => {
    socketService.sendCallSignal({ type: 'call:end' });
    if (rtcRef.current) rtcRef.current.cleanup();
    setStatus('ended');
    onClose();
  };

  const toggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    if (rtcRef.current) rtcRef.current.toggleMute(next);
  };

  const toggleVideo = () => {
    const next = !isVideoOff;
    setIsVideoOff(next);
    if (rtcRef.current) rtcRef.current.toggleCamera(next);
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!isFullscreen) {
      if (containerRef.current.requestFullscreen) {
        containerRef.current.requestFullscreen();
        setIsFullscreen(true);
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
        setIsFullscreen(false);
      }
    }
  };

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <motion.div
      ref={containerRef}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 select-none backdrop-blur-2xl"
    >
      {/* Invisible audio element for remote WebRTC audio */}
      <audio ref={remoteAudioRef} autoPlay playsInline />

      <div className="relative w-full max-w-4xl h-[85vh] max-h-[720px] rounded-3xl bg-slate-950 border border-slate-800 flex flex-col overflow-hidden shadow-[0_0_80px_rgba(0,0,0,0.9)]">
        {/* Top Header Bar */}
        <div className="absolute top-0 inset-x-0 z-30 p-4 sm:p-6 flex items-center justify-between bg-gradient-to-b from-black/80 to-transparent">
          <div className="flex items-center gap-3">
            {displayOtherUserPfp ? (
              <img
                src={displayOtherUserPfp}
                alt={displayOtherUserName}
                className="w-10 h-10 rounded-full object-cover border border-indigo-500/50"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                  const fallback = e.currentTarget.nextElementSibling as HTMLElement | null;
                  if (fallback) fallback.style.display = 'flex';
                }}
              />
            ) : null}
            <div
              className="w-10 h-10 rounded-full border border-indigo-500/50 bg-slate-900 items-center justify-center text-indigo-200 font-semibold"
              style={{ display: displayOtherUserPfp ? 'none' : 'flex' }}
              aria-hidden="true"
            >
              {displayOtherUserName.charAt(0).toUpperCase()}
            </div>
            <div>
              <h3 className="text-sm font-bold text-white font-cinzel tracking-wider">
                {displayOtherUserName}
              </h3>
              <p className="text-[11px] text-slate-400 font-mono">
                {status === 'connected' ? `Duration: ${formatDuration(callDuration)}` : connectionMessage}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleFullscreen}
              className="p-2 rounded-full bg-slate-900/80 text-slate-300 hover:text-white border border-slate-800"
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Video Canvas or Voice Calling Atmosphere */}
        <div className="relative flex-1 w-full h-full flex items-center justify-center bg-[#07090e] overflow-hidden">
          {callState.callType === 'video' ? (
            <>
              {/* Remote Video Feed */}
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                className="w-full h-full object-cover"
              />

              {/* If remote video not receiving yet, show glowing avatar placeholder */}
              {status !== 'connected' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/90 gap-4">
                  <div className="relative">
                    <img
                      src={displayOtherUserPfp}
                      alt={displayOtherUserName}
                      className="w-24 h-24 rounded-full object-cover border-2 border-indigo-500 shadow-[0_0_40px_rgba(99,102,241,0.5)]"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                        const fallback = e.currentTarget.nextElementSibling as HTMLElement | null;
                        if (fallback) fallback.style.display = 'flex';
                      }}
                    />
                    <div
                      className="w-24 h-24 rounded-full border-2 border-indigo-500 bg-slate-900 items-center justify-center text-2xl font-semibold text-indigo-200"
                      style={{ display: displayOtherUserPfp ? 'none' : 'flex' }}
                    >
                      {displayOtherUserName.charAt(0).toUpperCase()}
                    </div>
                    <div className="absolute -inset-2 rounded-full border border-indigo-500/40 animate-ping" />
                  </div>
                  <p className="text-sm text-slate-300 font-cinzel tracking-wider">
                    {connectionMessage}
                  </p>
                </div>
              )}

              {/* Picture-in-Picture Local Video Feed */}
              <div className="absolute bottom-24 right-4 sm:right-6 w-32 sm:w-48 h-24 sm:h-36 rounded-2xl overflow-hidden border-2 border-slate-700 bg-slate-900 shadow-2xl z-20">
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
                {isVideoOff && (
                  <div className="absolute inset-0 bg-slate-950 flex items-center justify-center text-xs text-slate-500">
                    Camera Off
                  </div>
                )}
              </div>
            </>
          ) : (
            /* Voice Calling Screen with Pulsing Visualizer */
            <div className="flex flex-col items-center justify-center gap-6 text-center z-10 px-4">
              <div className="relative">
                <img
                  src={displayOtherUserPfp}
                  alt={displayOtherUserName}
                  className="w-32 h-32 rounded-full object-cover border-4 border-indigo-500/60 shadow-[0_0_60px_rgba(99,102,241,0.4)]"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                    const fallback = e.currentTarget.nextElementSibling as HTMLElement | null;
                    if (fallback) fallback.style.display = 'flex';
                  }}
                />
                <div
                  className="w-32 h-32 rounded-full border-4 border-indigo-500/60 bg-slate-900 items-center justify-center text-4xl font-semibold text-indigo-200"
                  style={{ display: displayOtherUserPfp ? 'none' : 'flex' }}
                >
                  {displayOtherUserName.charAt(0).toUpperCase()}
                </div>
                <motion.div
                  animate={{ scale: [1, 1.25, 1], opacity: [0.3, 0.7, 0.3] }}
                  transition={{ duration: 2.5, repeat: Infinity }}
                  className="absolute -inset-4 rounded-full border border-indigo-400/50 pointer-events-none"
                />
              </div>

              <div>
                <h2 className="text-2xl font-bold text-white font-cinzel tracking-widest">
                  {displayOtherUserName}
                </h2>
                <p className="text-xs uppercase tracking-[0.25em] text-indigo-400 font-mono mt-1">
                  Private Voice Frequency
                </p>
                <p className="text-sm text-slate-300 mt-2 font-mono">
                  {status === 'connected' ? formatDuration(callDuration) : connectionMessage}
                </p>
              </div>

              {hasError && (
                <div className="flex items-center gap-2 p-3 rounded-xl bg-red-950/60 border border-red-500/40 text-red-200 text-xs">
                  <AlertCircle className="w-4 h-4 text-red-400" />
                  <span>{hasError}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Bottom Call Control Bar */}
        <div className="absolute bottom-0 inset-x-0 z-30 p-4 sm:p-6 flex items-center justify-center gap-4 bg-gradient-to-t from-black/90 to-transparent">
          {/* Callee Ringing Actions: Accept or Reject */}
          {callState.role === 'callee' && status === 'ringing' ? (
            <div className="flex items-center gap-6">
              <button
                type="button"
                onClick={handleRejectCall}
                className="flex items-center gap-2 px-6 py-3 rounded-2xl bg-red-600 hover:bg-red-500 text-white font-semibold text-sm shadow-[0_0_25px_rgba(239,68,68,0.5)] transition-all active:scale-95"
              >
                <PhoneOff className="w-5 h-5" />
                <span>Decline</span>
              </button>

              <button
                type="button"
                onClick={handleAcceptCall}
                className="flex items-center gap-2 px-6 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm shadow-[0_0_25px_rgba(16,185,129,0.5)] transition-all active:scale-95"
              >
                <Phone className="w-5 h-5" />
                <span>
                  Accept {displayOtherUserName}'s{' '}
                  {callState.callType === 'video' ? 'Video Call' : 'Call'}
                </span>
              </button>
            </div>
          ) : (
            /* Active Call Controls */
            <div className="flex items-center gap-3 sm:gap-4">
              {/* Mute Button */}
              <button
                type="button"
                onClick={toggleMute}
                className={`p-3.5 rounded-2xl border transition-all ${
                  isMuted
                    ? 'bg-red-600/80 border-red-500 text-white'
                    : 'bg-slate-900/80 border-slate-700 text-slate-200 hover:bg-slate-800'
                }`}
                title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
              >
                {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>

              {/* Video Toggle (If Video Call) */}
              {callState.callType === 'video' && (
                <button
                  type="button"
                  onClick={toggleVideo}
                  className={`p-3.5 rounded-2xl border transition-all ${
                    isVideoOff
                      ? 'bg-red-600/80 border-red-500 text-white'
                      : 'bg-slate-900/80 border-slate-700 text-slate-200 hover:bg-slate-800'
                  }`}
                  title={isVideoOff ? 'Turn on camera' : 'Turn off camera'}
                >
                  {isVideoOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
                </button>
              )}

              {/* Hangup / End Call */}
              <button
                type="button"
                onClick={handleEndCall}
                className="px-6 py-3.5 rounded-2xl bg-red-600 hover:bg-red-500 text-white font-semibold text-xs uppercase tracking-wider shadow-[0_0_25px_rgba(239,68,68,0.4)] flex items-center gap-2 active:scale-95 transition-all"
              >
                <PhoneOff className="w-5 h-5" />
                <span>End Call</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
};
