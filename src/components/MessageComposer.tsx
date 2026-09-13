import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Smile,
  Paperclip,
  Mic,
  Send,
  Square,
  X,
  Play,
  Pause,
  Lock,
  Image as ImageIcon,
  File as FileIcon,
  Loader2
} from 'lucide-react';
import { AppSettings, ChatMessage } from '../types';

interface MessageComposerProps {
  onSendMessage: (payload: {
    text?: string;
    type?: 'text' | 'image' | 'file' | 'voice';
    fileUrl?: string;
    fileName?: string;
    fileSize?: number;
    audioDuration?: number;
  }) => Promise<void>;
  onTyping: (isTyping: boolean) => void;
  onUpload: (file: File | Blob, name?: string) => Promise<{ fileUrl: string; fileName: string; fileSize: number }>;
  isExpired?: boolean;
  settings?: AppSettings;
  replyingTo?: ChatMessage | null;
  onCancelReply?: () => void;
}

const COMMON_EMOJIS = [
  '❤️', '✨', '🌙', '🔥', '😊', '🤍', '⭐', '🌸', '💫', '🌿',
  '☕', '🌌', '🦋', '🎈', '🎉', '👏', '🙌', '👀', '🥺', '🫂'
];

export const MessageComposer: React.FC<MessageComposerProps> = ({
  onSendMessage,
  onTyping,
  onUpload,
  isExpired = false,
  settings,
  replyingTo,
  onCancelReply,
}) => {
  const [text, setText] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  // Voice recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordedAudioBlob, setRecordedAudioBlob] = useState<Blob | null>(null);
  const [recordedAudioUrl, setRecordedAudioUrl] = useState<string | null>(null);
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<any>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const typingTimerRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const isMessagingDisabled = isExpired || settings?.featuresEnabled?.messages === false;
  const isVoiceDisabled = settings?.featuresEnabled?.voiceMessages === false;
  const isAttachmentDisabled = (settings?.featuresEnabled?.imageSharing === false) && (settings?.featuresEnabled?.fileSharing === false);

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    onTyping(true);

    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      onTyping(false);
    }, 2000);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSend = async () => {
    if (isMessagingDisabled) return;

    // Send recorded voice note
    if (recordedAudioBlob) {
      try {
        setIsUploading(true);
        const uploadResult = await onUpload(recordedAudioBlob, `voice_${Date.now()}.webm`);
        await onSendMessage({
          type: 'voice',
          fileUrl: uploadResult.fileUrl,
          fileName: 'Voice Note',
          fileSize: uploadResult.fileSize,
          audioDuration: recordingSeconds,
        });
        cancelVoiceRecording();
      } catch (err) {
        console.error('Failed to send voice note:', err);
      } finally {
        setIsUploading(false);
      }
      return;
    }

    // Send text message
    if (!text.trim()) return;
    const msgText = text;
    setText('');
    onTyping(false);
    try {
      await onSendMessage({ text: msgText, type: 'text' });
    } catch (err) {
      console.error('Failed to send message:', err);
    }
  };

  // Start Real Browser Voice Recording
  const startVoiceRecording = async () => {
    if (isVoiceDisabled || isMessagingDisabled) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const mediaRecorder = new MediaRecorder(stream);

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        setRecordedAudioBlob(audioBlob);
        setRecordedAudioUrl(URL.createObjectURL(audioBlob));
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start(100);
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);
      setRecordingSeconds(0);

      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      console.warn('Microphone permission denied or not available:', err);
    }
  };

  // Stop Recording to enter Preview state
  const stopVoiceRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    }
  };

  // Cancel voice recording completely
  const cancelVoiceRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
    }
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current = null;
    }
    setIsRecording(false);
    setRecordingSeconds(0);
    setRecordedAudioBlob(null);
    if (recordedAudioUrl) {
      URL.revokeObjectURL(recordedAudioUrl);
      setRecordedAudioUrl(null);
    }
    setIsPlayingPreview(false);
  };

  // Play/pause preview of recorded audio
  const togglePreviewAudio = () => {
    if (!recordedAudioUrl) return;
    if (!previewAudioRef.current) {
      const audio = new Audio(recordedAudioUrl);
      audio.onended = () => setIsPlayingPreview(false);
      previewAudioRef.current = audio;
    }

    if (isPlayingPreview) {
      previewAudioRef.current.pause();
      setIsPlayingPreview(false);
    } else {
      previewAudioRef.current.play();
      setIsPlayingPreview(true);
    }
  };

  // Handle file uploads
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isImage = file.type.startsWith('image/');
    setIsUploading(true);
    try {
      const uploadResult = await onUpload(file);
      await onSendMessage({
        type: isImage ? 'image' : 'file',
        fileUrl: uploadResult.fileUrl,
        fileName: file.name,
        fileSize: file.size,
      });
    } catch (err) {
      console.error('File upload failed:', err);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Locked or expired state
  if (isMessagingDisabled) {
    return (
      <div className="w-full p-4 bg-slate-950/80 border-t border-slate-800/80 flex items-center justify-center text-slate-400 text-sm font-medium gap-2">
        <Lock className="w-4 h-4 text-red-400" />
        <span>🔒 Messaging is currently disabled.</span>
      </div>
    );
  }

  return (
    <div className="relative w-full bg-slate-950/80 border-t border-slate-800/80 px-3 sm:px-6 py-3 backdrop-blur-xl">
      {/* Reply Banner */}
      {replyingTo && (
        <div className="mb-2 p-2.5 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between text-xs">
          <div className="flex-1 min-w-0 pr-2">
            <span className="font-semibold text-indigo-300">Replying to message:</span>
            <p className="line-clamp-1 text-slate-400 italic mt-0.5">"{replyingTo.text}"</p>
          </div>
          <button
            type="button"
            onClick={onCancelReply}
            className="p-1 text-slate-400 hover:text-white rounded-lg"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Emoji Picker Popover */}
      <AnimatePresence>
        {showEmojiPicker && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            className="absolute bottom-full left-4 mb-2 p-3 rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl z-30 max-w-xs"
          >
            <div className="grid grid-cols-5 gap-2 text-xl">
              {COMMON_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => {
                    setText((prev) => prev + emoji);
                    setShowEmojiPicker(false);
                  }}
                  className="p-1.5 hover:bg-slate-800 rounded-xl transition-transform hover:scale-125"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Voice Recording / Preview Mode */}
      {isRecording ? (
        <div className="flex items-center justify-between gap-3 py-1">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 rounded-full bg-red-500 animate-ping" />
            <span className="text-xs font-mono font-medium text-red-300">
              Recording Voice Note: {recordingSeconds}s
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={cancelVoiceRecording}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 text-slate-300 text-xs hover:bg-slate-700"
              title="Cancel recording"
            >
              <X className="w-4 h-4 text-red-400" />
              <span>Cancel</span>
            </button>

            <button
              type="button"
              onClick={stopVoiceRecording}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 text-white text-xs hover:bg-indigo-500 font-medium"
              title="Stop & preview"
            >
              <Square className="w-3.5 h-3.5" />
              <span>Stop</span>
            </button>
          </div>
        </div>
      ) : recordedAudioBlob ? (
        /* Recorded Audio Preview Tray */
        <div className="flex items-center justify-between gap-3 py-1">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={togglePreviewAudio}
              className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-white hover:bg-indigo-500 shadow-md"
            >
              {isPlayingPreview ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
            </button>
            <span className="text-xs font-mono text-slate-300">
              Voice Note ({recordingSeconds}s)
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={cancelVoiceRecording}
              className="p-2 rounded-xl text-slate-400 hover:text-red-400 hover:bg-slate-800"
              title="Discard note"
            >
              <X className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={handleSend}
              disabled={isUploading}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/30"
            >
              {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              <span>Send Voice</span>
            </button>
          </div>
        </div>
      ) : (
        /* Normal Typing Composer */
        <div className="flex items-end gap-2 sm:gap-3">
          {/* Emoji Trigger */}
          <button
            type="button"
            onClick={() => setShowEmojiPicker(!showEmojiPicker)}
            className="p-2.5 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-900 transition-colors shrink-0"
            title="Insert emoji"
          >
            <Smile className="w-5 h-5" />
          </button>

          {/* Attachment Trigger */}
          {!isAttachmentDisabled && (
            <>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                className="hidden"
                accept="image/*,.pdf,.doc,.docx,.zip,.txt"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="p-2.5 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-900 transition-colors shrink-0"
                title="Send file or photo"
              >
                {isUploading ? <Loader2 className="w-5 h-5 animate-spin text-indigo-400" /> : <Paperclip className="w-5 h-5" />}
              </button>
            </>
          )}

          {/* Text Area */}
          <div className="flex-1 relative">
            <textarea
              value={text}
              onChange={handleTextChange}
              onKeyDown={handleKeyDown}
              placeholder="Whisper into the private universe..."
              rows={1}
              className="w-full max-h-32 py-2.5 px-4 rounded-2xl bg-slate-900/90 border border-slate-800 text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:border-indigo-500/80 focus:ring-1 focus:ring-indigo-500/30 transition-all resize-none leading-relaxed"
            />
          </div>

          {/* Voice Record Button (or Send Button if text entered) */}
          {text.trim() ? (
            <button
              id="send-message-btn"
              type="button"
              onClick={handleSend}
              className="p-2.5 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white shadow-[0_0_15px_rgba(99,102,241,0.4)] transition-all shrink-0 active:scale-95"
              title="Send message"
            >
              <Send className="w-5 h-5" />
            </button>
          ) : !isVoiceDisabled ? (
            <button
              id="voice-record-btn"
              type="button"
              onClick={startVoiceRecording}
              className="p-2.5 rounded-2xl bg-slate-900 hover:bg-indigo-600 text-slate-300 hover:text-white border border-slate-800 transition-all shrink-0 active:scale-95"
              title="Record voice note"
            >
              <Mic className="w-5 h-5" />
            </button>
          ) : (
            <button
              disabled
              className="p-2.5 rounded-2xl bg-slate-900 text-slate-600 opacity-50 shrink-0"
            >
              <Send className="w-5 h-5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
};
