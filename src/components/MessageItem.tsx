import React, { useState, useRef } from 'react';
import { motion } from 'motion/react';
import { ChatMessage } from '../types';
import {
  Play,
  Pause,
  Download,
  FileText,
  Smile,
  Reply,
  Pin,
  Edit2,
  Trash2,
  Copy,
  Check,
  CheckCheck,
  PinOff
} from 'lucide-react';

interface MessageItemProps {
  message: ChatMessage;
  currentUserId: string;
  senderName: string;
  senderPfp?: string;
  isOtherOnline?: boolean;
  onReact: (messageId: string, emoji: string) => void;
  onReply: (message: ChatMessage) => void;
  onPin: (messageId: string) => void;
  onEdit: (messageId: string, text: string) => void;
  onDelete: (messageId: string) => void;
  onOpenImage: (url: string) => void;
}

const QUICK_REACTIONS = ['❤️', '✨', '🌙', '🔥', '😊', '🤍'];

export const MessageItem: React.FC<MessageItemProps> = ({
  message,
  currentUserId,
  senderName,
  senderPfp,
  onReact,
  onReply,
  onPin,
  onEdit,
  onDelete,
  onOpenImage,
}) => {
  const isMe = message.senderId === currentUserId;
  const isSystem = message.senderId === 'system' || message.type === 'system';

  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(message.text || '');
  const [copied, setCopied] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  // System Message
  if (isSystem) {
    const isExpiration = message.text?.includes('ALLOWED COMMUNICATION TIME HAS ENDED');
    return (
    <div
      id={`msg-${message.id}`}
      className={`group relative flex w-full gap-2.5 sm:gap-3 my-2.5 px-1.5 sm:px-2 md:px-4 ${
        isMe ? 'flex-row-reverse' : 'flex-row'
      }`}
    >
      {/* Sender avatar: always visible, never covered by mobile actions */}
      <div className="shrink-0 pt-1 w-8 sm:w-9">
        <img
          src={
            senderPfp ||
            'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100'
          }
          alt={senderName}
          className="block w-8 h-8 sm:w-9 sm:h-9 rounded-full object-cover object-center aspect-square border border-slate-700/60 shadow-sm"
        />
      </div>

      <div
        className={`relative min-w-0 max-w-[calc(100%-44px)] sm:max-w-md md:max-w-lg flex flex-col ${
          isMe ? 'items-end' : 'items-start'
        }`}
      >
        {message.isPinned && (
          <div className="flex items-center gap-1 text-[10px] text-amber-400 font-mono uppercase tracking-wider mb-1 px-1">
            <Pin className="w-2.5 h-2.5 fill-amber-400" />
            <span>Pinned Message</span>
          </div>
        )}

        {message.replyTo && (
          <div
            className={`mb-1 p-2 rounded-xl text-xs flex flex-col border max-w-full ${
              isMe
                ? 'bg-indigo-950/40 border-indigo-800/40 text-indigo-200'
                : 'bg-slate-900/60 border-slate-800 text-slate-300'
            }`}
          >
            <span className="text-[10px] font-semibold text-slate-400">
              Replying to {message.replyTo.senderName}:
            </span>
            <p className="line-clamp-1 italic text-slate-300/80 break-words">
              "{message.replyTo.text}"
            </p>
          </div>
        )}

        {/* Main bubble is the mobile touch target */}
        <div
          onClick={() => {
            if (
              typeof window !== 'undefined' &&
              window.matchMedia('(max-width: 767px)').matches &&
              !message.deleted &&
              !isEditing
            ) {
              setShowActionsMenu((prev) => !prev);
              setShowReactionPicker(false);
            }
          }}
          className={`relative max-w-full p-3 sm:p-3.5 rounded-3xl text-sm leading-relaxed shadow-md break-words ${
            isMe
              ? 'bg-gradient-to-br from-indigo-950/90 via-indigo-900/80 to-blue-950/90 text-white rounded-tr-xs border border-indigo-400/40 shadow-[0_4px_25px_rgba(99,102,241,0.25)] backdrop-blur-xl'
              : 'bg-gradient-to-br from-slate-900/90 via-purple-950/60 to-slate-950/90 text-slate-100 rounded-tl-xs border border-purple-400/30 shadow-[0_4px_25px_rgba(168,85,247,0.18)] backdrop-blur-xl'
          }`}
        >
          {message.deleted ? (
            <p className="italic text-slate-400 text-xs flex items-center gap-1.5">
              <Trash2 className="w-3.5 h-3.5 text-slate-500" />
              <span>This message was deleted.</span>
            </p>
          ) : isEditing ? (
            <div className="w-[min(100%,420px)] min-w-0 space-y-2">
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                className="w-full p-2 text-[16px] sm:text-xs bg-slate-950/80 rounded-xl border border-slate-700 text-white focus:outline-none"
                rows={2}
                autoFocus
              />

              <div className="flex justify-end gap-2 text-xs">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsEditing(false);
                  }}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-800 text-slate-300"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    saveEdit();
                  }}
                  className="px-2.5 py-1.5 rounded-lg bg-indigo-500 text-white font-medium"
                >
                  Save
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Image */}
              {message.type === 'image' && message.fileUrl && (
                <div
                  className="mb-2 overflow-hidden rounded-2xl cursor-pointer max-w-full"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenImage(message.fileUrl!);
                  }}
                >
                  <img
                    src={message.fileUrl}
                    alt={message.fileName || 'Shared photo'}
                    className="block w-full max-w-[min(72vw,360px)] max-h-72 object-cover"
                    loading="lazy"
                  />
                </div>
              )}

              {/* Voice */}
              {message.type === 'voice' && message.fileUrl && (
                <div
                  className="flex items-center gap-2.5 py-1 min-w-0 w-[min(76vw,280px)]"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={togglePlayAudio}
                    className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                      isMe
                        ? 'bg-white text-indigo-700'
                        : 'bg-indigo-600 text-white'
                    }`}
                    aria-label={
                      isPlayingAudio
                        ? 'Pause voice message'
                        : 'Play voice message'
                    }
                  >
                    {isPlayingAudio ? (
                      <Pause className="w-4 h-4" />
                    ) : (
                      <Play className="w-4 h-4 ml-0.5" />
                    )}
                  </button>

                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="h-1.5 w-full bg-white/20 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-white"
                        style={{ width: `${audioProgress}%` }}
                      />
                    </div>

                    <div className="flex justify-between gap-2 text-[10px] font-mono opacity-80">
                      <span className="truncate">
                        Voice Note
                      </span>
                      <span className="shrink-0">
                        {message.audioDuration
                          ? `${Math.round(
                              message.audioDuration
                            )}s`
                          : '0:05'}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* File */}
              {message.type === 'file' && message.fileUrl && (
                <div
                  className="flex items-center gap-2.5 p-2.5 rounded-2xl bg-black/20 border border-white/10 mb-2 max-w-full"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="p-2 rounded-xl bg-white/10 text-white shrink-0">
                    <FileText className="w-5 h-5" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate text-white">
                      {message.fileName || 'Document'}
                    </p>
                    <p className="text-[10px] text-white/60">
                      {message.fileSize
                        ? `${Math.round(
                            message.fileSize / 1024
                          )} KB`
                        : 'File'}
                    </p>
                  </div>

                  <a
                    href={message.fileUrl}
                    download={message.fileName || 'file'}
                    onClick={(e) =>
                      e.stopPropagation()
                    }
                    className="p-1.5 rounded-lg text-white shrink-0"
                  >
                    <Download className="w-4 h-4" />
                  </a>
                </div>
              )}

              {/* Text */}
              {message.text && (
                <p className="whitespace-pre-wrap break-words">
                  {message.text}
                </p>
              )}
            </>
          )}

          {/* Footer */}
          <div
            className={`flex items-center gap-1.5 mt-1 text-[10px] ${
              isMe
                ? 'text-indigo-200/80 justify-end'
                : 'text-slate-400 justify-start'
            }`}
          >
            {message.isEdited && (
              <span className="italic">
                (edited)
              </span>
            )}

            <span>
              {formatTime(message.timestamp)}
            </span>

            {isMe && !message.deleted && (
              <span>
                {message.status === 'read' ? (
                  <CheckCheck className="w-3.5 h-3.5 text-cyan-300" />
                ) : message.status === 'delivered' ? (
                  <CheckCheck className="w-3.5 h-3.5 text-indigo-300/80" />
                ) : (
                  <Check className="w-3.5 h-3.5 text-indigo-300/60" />
                )}
              </span>
            )}
          </div>
        </div>

        {/* Existing reaction chips */}
        {message.reactions &&
          Object.keys(message.reactions).length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1 z-10">
              {Object.entries(message.reactions).map(
                ([uid, emoji]) => (
                  <button
                    key={uid}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onReact(message.id, emoji);
                    }}
                    className={`px-2 py-0.5 rounded-full text-xs flex items-center gap-1 border ${
                      uid === currentUserId
                        ? 'bg-indigo-950/80 border-indigo-500/50 text-indigo-200'
                        : 'bg-slate-900/80 border-slate-700 text-slate-300'
                    }`}
                  >
                    <span>{emoji}</span>
                  </button>
                )
              )}
            </div>
          )}

        {/* Mobile actions — inline, no dots, never covers PFP */}
        {!message.deleted &&
          showActionsMenu && (
            <div
              className={`md:hidden mt-1.5 flex flex-wrap items-center gap-1 p-1.5 rounded-2xl bg-slate-950 border border-slate-700/80 shadow-lg max-w-full ${
                isMe ? 'justify-end' : 'justify-start'
              }`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="relative">
                <button
                  type="button"
                  onClick={() =>
                    setShowReactionPicker(
                      (prev) => !prev
                    )
                  }
                  className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-300 bg-slate-900"
                  aria-label="Add reaction"
                >
                  <Smile className="w-4 h-4" />
                </button>

                {showReactionPicker && (
                  <div
                    className="absolute bottom-full left-0 mb-1 flex items-center gap-0.5 p-1.5 rounded-2xl bg-slate-950 border border-slate-700 shadow-xl z-50"
                    onClick={(e) =>
                      e.stopPropagation()
                    }
                  >
                    {QUICK_REACTIONS.map(
                      (emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onReact(
                              message.id,
                              emoji
                            );
                            setShowReactionPicker(
                              false
                            );
                            setShowActionsMenu(
                              false
                            );
                          }}
                          className="w-9 h-9 rounded-xl flex items-center justify-center text-base active:bg-slate-800"
                          aria-label={`React ${emoji}`}
                        >
                          {emoji}
                        </button>
                      )
                    )}
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => {
                  onReply(message);
                  setShowActionsMenu(false);
                  setShowReactionPicker(false);
                }}
                className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-300 bg-slate-900"
                aria-label="Reply"
              >
                <Reply className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => {
                  onPin(message.id);
                  setShowActionsMenu(false);
                  setShowReactionPicker(false);
                }}
                className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-300 bg-slate-900"
                aria-label={message.isPinned ? 'Unpin' : 'Pin'}
              >
                {message.isPinned ? (
                  <PinOff className="w-4 h-4 text-amber-400" />
                ) : (
                  <Pin className="w-4 h-4" />
                )}
              </button>

              {message.text && (
                <button
                  type="button"
                  onClick={async () => {
                    await handleCopy();
                    setShowActionsMenu(false);
                  }}
                  className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-300 bg-slate-900"
                  aria-label="Copy"
                >
                  {copied ? (
                    <Check className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
              )}

              {isMe &&
                message.type === 'text' && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsEditing(true);
                      setShowActionsMenu(false);
                      setShowReactionPicker(false);
                    }}
                    className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-300 bg-slate-900"
                    aria-label="Edit"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                )}

              {isMe && (
                <button
                  type="button"
                  onClick={() => {
                    onDelete(message.id);
                    setShowActionsMenu(false);
                    setShowReactionPicker(false);
                  }}
                  className="w-9 h-9 rounded-xl flex items-center justify-center text-red-300 bg-slate-900"
                  aria-label="Delete"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          )}

        {/* Desktop hover actions */}
        {!message.deleted && (
          <div
            className="hidden md:flex absolute top-0 opacity-0 group-hover:opacity-100 transition-opacity items-center gap-1 p-1 rounded-xl bg-slate-900/95 border border-slate-700/80 shadow-lg backdrop-blur-md z-20"
            style={
              isMe
                ? { right: '100%', marginRight: '0.5rem' }
                : { left: '100%', marginLeft: '0.5rem' }
            }
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative">
              <button
                type="button"
                onClick={() =>
                  setShowReactionPicker(
                    (prev) => !prev
                  )
                }
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                title="Add reaction"
              >
                <Smile className="w-3.5 h-3.5" />
              </button>

              {showReactionPicker && (
                <div className="absolute bottom-full left-0 mb-1 flex items-center gap-1 p-1.5 rounded-2xl bg-slate-900 border border-slate-700 shadow-xl z-30">
                  {QUICK_REACTIONS.map(
                    (emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => {
                          onReact(
                            message.id,
                            emoji
                          );
                          setShowReactionPicker(
                            false
                          );
                        }}
                        className="p-1 hover:scale-125 transition-transform text-sm"
                        title={`React ${emoji}`}
                      >
                        {emoji}
                      </button>
                    )
                  )}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => onReply(message)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              title="Reply"
            >
              <Reply className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={() => onPin(message.id)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-amber-300 hover:bg-slate-800"
              title={message.isPinned ? 'Unpin' : 'Pin'}
            >
              {message.isPinned ? (
                <PinOff className="w-3.5 h-3.5 text-amber-400" />
              ) : (
                <Pin className="w-3.5 h-3.5" />
              )}
            </button>

            {message.text && (
              <button
                type="button"
                onClick={() => void handleCopy()}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                title="Copy"
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
            )}

            {isMe &&
              message.type === 'text' && (
                <button
                  type="button"
                  onClick={() =>
                    setIsEditing(true)
                  }
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                  title="Edit"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
              )}

            {isMe && (
              <button
                type="button"
                onClick={() =>
                  onDelete(message.id)
                }
                className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-800"
                title="Delete"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
