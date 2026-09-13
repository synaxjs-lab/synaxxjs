import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  UserProfile,
  ChatMessage,
  AppSettings,
  TimeStatus
} from '../types';
import { MessageItem } from './MessageItem';
import { MessageComposer } from './MessageComposer';
import { TimeBanner, TimeRemainingPill } from './TimeBanner';
import { LogoMark } from './LogoMark';
import {
  Phone,
  Video,
  Search,
  Pin,
  Settings,
  LogOut,
  X
} from 'lucide-react';
import { ApiService } from '../services/api';
import { socketService } from '../services/socket';
import { SoundEffects } from '../services/sound';

interface ChatRoomProps {
  currentUser: UserProfile;
  otherUser: UserProfile;
  initialMessages: ChatMessage[];
  settings: AppSettings;
  timeStatus: TimeStatus | null;
  onLogout: () => void;
  onOpenProfile: () => void;
  onStartCall: (callType: 'voice' | 'video') => void;
}

export const ChatRoom: React.FC<ChatRoomProps> = ({
  currentUser,
  otherUser,
  initialMessages,
  settings,
  timeStatus,
  onLogout,
  onOpenProfile,
  onStartCall,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>(
    initialMessages || []
  );

  const [otherPresence, setOtherPresence] = useState<{
    isOnline: boolean;
    lastSeen: number;
  }>({
    isOnline: false,
    lastSeen: otherUser.lastActiveTimestamp || Date.now(),
  });

  const [isOtherTyping, setIsOtherTyping] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = (
    behavior: ScrollBehavior = 'smooth'
  ) => {
    messagesEndRef.current?.scrollIntoView({
      behavior,
      block: 'end',
    });
  };

  useEffect(() => {
    scrollToBottom('auto');
  }, []);

  useEffect(() => {
    scrollToBottom('smooth');
  }, [messages.length, isOtherTyping]);

  // =========================================================
  // WEBSOCKET LISTENERS
  // =========================================================
  useEffect(() => {
    const unsubMsg = socketService.on(
      'chat:new_message',
      (data) => {
        if (!data.message) return;

        setMessages((prev) => {
          if (prev.some((m) => m.id === data.message.id)) {
            return prev;
          }

          return [...prev, data.message];
        });

        if (data.message.senderId === otherUser.id) {
          SoundEffects.playReceived();
          ApiService.markMessagesAsRead();
          socketService.sendMarkRead();
        }
      }
    );

    const unsubRead = socketService.on(
      'chat:messages_read',
      (data) => {
        if (data.readerId !== otherUser.id) return;

        setMessages((prev) =>
          prev.map((m) =>
            m.senderId === currentUser.id
              ? { ...m, status: 'read' }
              : m
          )
        );
      }
    );

    const unsubDelivered = socketService.on(
      'chat:messages_delivered',
      (data) => {
        if (data.recipientId !== otherUser.id) return;

        setMessages((prev) =>
          prev.map((m) =>
            m.senderId === currentUser.id &&
            m.status === 'sent'
              ? { ...m, status: 'delivered' }
              : m
          )
        );
      }
    );

    const unsubReaction = socketService.on(
      'chat:reaction_update',
      (data) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === data.messageId
              ? {
                  ...m,
                  reactions: data.reactions,
                }
              : m
          )
        );
      }
    );

    const unsubEdit = socketService.on(
      'chat:message_edited',
      (data) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === data.messageId
              ? {
                  ...m,
                  text: data.text,
                  isEdited: true,
                }
              : m
          )
        );
      }
    );

    const unsubDelete = socketService.on(
      'chat:message_deleted',
      (data) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === data.messageId
              ? {
                  ...m,
                  deleted: true,
                  text: 'This message was deleted',
                }
              : m
          )
        );
      }
    );

    const unsubPin = socketService.on(
      'chat:message_pinned',
      (data) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === data.messageId
              ? {
                  ...m,
                  isPinned: data.isPinned,
                }
              : m
          )
        );
      }
    );

    const unsubTyping = socketService.on(
      'typing:update',
      (data) => {
        if (data.userId === otherUser.id) {
          setIsOtherTyping(!!data.isTyping);
        }
      }
    );

    const unsubPresence = socketService.on(
      'presence:update',
      (data) => {
        if (!data.presence) return;

        const isOnline =
          otherUser.id === 'person_1'
            ? data.presence.person_1
            : data.presence.person_2;

        const lastSeen =
          otherUser.id === 'person_1'
            ? data.presence.lastSeen_1
            : data.presence.lastSeen_2;

        setOtherPresence({
          isOnline,
          lastSeen,
        });
      }
    );

    const unsubCleared = socketService.on(
      'chat:history_cleared',
      () => {
        setMessages([
          {
            id: `msg_clr_${Date.now()}`,
            senderId: 'system',
            type: 'system',
            text:
              '✦ Chat history was cleared by the Administrator. A fresh chapter begins.',
            timestamp: Date.now(),
            status: 'read',
            reactions: {},
          },
        ]);
      }
    );

    ApiService.markMessagesAsRead();
    socketService.sendMarkRead();

    return () => {
      unsubMsg();
      unsubRead();
      unsubDelivered();
      unsubReaction();
      unsubEdit();
      unsubDelete();
      unsubPin();
      unsubTyping();
      unsubPresence();
      unsubCleared();
    };
  }, [otherUser.id, currentUser.id]);

  // =========================================================
  // MESSAGE HANDLERS
  // =========================================================
  const handleSendMessage = async (payload: any) => {
    try {
      await ApiService.sendMessage({
        ...payload,
        replyTo: replyingTo
          ? {
              id: replyingTo.id,
              text: replyingTo.text || 'Attachment',
              senderName:
                replyingTo.senderId === currentUser.id
                  ? 'You'
                  : otherUser.name,
            }
          : undefined,
      });

      setReplyingTo(null);
      SoundEffects.playSent();
    } catch (err) {
      console.error(
        'Failed to send message:',
        err
      );
    }
  };

  const handleTyping = (isTyping: boolean) => {
    socketService.sendTyping(isTyping);
  };

  const handleUpload = async (
    file: File | Blob,
    name?: string
  ) => {
    return await ApiService.uploadFile(file, name);
  };

  const handleReact = async (
    messageId: string,
    emoji: string
  ) => {
    await ApiService.toggleReaction(
      messageId,
      emoji
    );
  };

  const handlePin = async (messageId: string) => {
    await ApiService.togglePin(messageId);
  };

  const handleEdit = async (
    messageId: string,
    text: string
  ) => {
    await ApiService.editMessage(
      messageId,
      text
    );
  };

  const handleDelete = async (
    messageId: string
  ) => {
    await ApiService.deleteMessage(
      messageId
    );
  };

  // =========================================================
  // FILTERS
  // =========================================================
  const filteredMessages = searchQuery.trim()
    ? messages.filter((m) =>
        m.text
          ?.toLowerCase()
          .includes(
            searchQuery.toLowerCase()
          )
      )
    : messages;

  const pinnedMessage = messages.find(
    (m) => m.isPinned && !m.deleted
  );

  const formatLastSeen = (
    timestamp: number
  ) => {
    if (!timestamp) return 'Recently';

    const d = new Date(timestamp);

    return `Last seen ${d.toLocaleTimeString(
      [],
      {
        hour: '2-digit',
        minute: '2-digit',
      }
    )}`;
  };

  return (
    <div
      id="synax-chat-room"
      className="fixed inset-0 z-10 w-full h-[100dvh] min-h-0 flex flex-col bg-[#04060c]/95 backdrop-blur-sm text-slate-100 overflow-hidden select-none"
    >
      {/* =====================================================
          TOP SERVER TIMER
      ====================================================== */}
      <div className="shrink-0">
        <TimeBanner
          timeStatus={timeStatus}
        />
      </div>

      {/* =====================================================
          HEADER
          Fixed inside chat layout - never scrolls
      ====================================================== */}
      <header className="shrink-0 w-full bg-slate-950/98 border-b border-slate-800/80 backdrop-blur-xl z-30">
        <div className="w-full min-w-0 px-2 sm:px-4 md:px-6 py-2 flex items-center gap-2">
          {/* Partner identity */}
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {/* PFP */}
            <div className="relative shrink-0 w-10 h-10 sm:w-11 sm:h-11">
              <div className="w-full h-full rounded-full overflow-hidden">
                <img
                  src={
                    otherUser.pfpUrl ||
                    'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=200'
                  }
                  alt={otherUser.name}
                  className="block w-full h-full object-cover object-center aspect-square"
                />
              </div>

              <span
                className={`absolute bottom-0 right-0 w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full border-2 border-slate-950 ${
                  otherPresence.isOnline
                    ? 'bg-emerald-500 shadow-[0_0_8px_#10b981]'
                    : 'bg-slate-500'
                }`}
              />
            </div>

            {/* Name + status */}
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1.5">
                <h2 className="min-w-0 max-w-[105px] xs:max-w-[145px] sm:max-w-[240px] md:max-w-none truncate text-sm sm:text-base font-bold text-white font-cinzel tracking-anime-header text-shadow-anime-glow">
                  {otherUser.nickname ||
                    otherUser.name}
                </h2>

                {/* Partner logo */}
                <div
                  className="shrink-0 flex items-center justify-center"
                  title={`Personal Mark: ${otherUser.logo.name}`}
                >
                  <LogoMark
                    logo={otherUser.logo}
                    size="sm"
                    glow={false}
                    className="opacity-80"
                  />
                </div>
              </div>

              <p className="text-[9px] sm:text-[11px] font-sans-celestial tracking-wide truncate">
                {isOtherTyping ? (
                  <span className="text-indigo-400 animate-pulse font-medium">
                    typing...
                  </span>
                ) : otherPresence.isOnline ? (
                  <span className="text-emerald-400">
                    Online
                  </span>
                ) : (
                  <span className="text-slate-400">
                    {formatLastSeen(
                      otherPresence.lastSeen
                    )}
                  </span>
                )}
              </p>
            </div>
          </div>

          {/* Header controls */}
          <div className="shrink-0 flex items-center gap-1 sm:gap-2">
            {timeStatus && (
              <div className="shrink-0">
                <TimeRemainingPill
                  secondsLeft={
                    timeStatus.remainingSeconds
                  }
                  isExpired={
                    timeStatus.isExpired
                  }
                />
              </div>
            )}

            {settings.featuresEnabled.voiceCalls && (
              <button
                id="start-voice-call-btn"
                type="button"
                onClick={() =>
                  onStartCall('voice')
                }
                disabled={
                  !!(
                    timeStatus?.isExpired &&
                    settings
                      .restrictionsOnExpire
                      .disableVoiceCalls
                  )
                }
                className="w-9 h-9 sm:w-auto sm:h-auto sm:px-3 sm:py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-indigo-300 border border-slate-700/80 flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                title="Start encrypted voice call"
              >
                <Phone className="w-4 h-4" />

                <span className="hidden xl:inline">
                  Call
                </span>
              </button>
            )}

            {settings.featuresEnabled.videoCalls && (
              <button
                id="start-video-call-btn"
                type="button"
                onClick={() =>
                  onStartCall('video')
                }
                disabled={
                  !!(
                    timeStatus?.isExpired &&
                    settings
                      .restrictionsOnExpire
                      .disableVideoCalls
                  )
                }
                className="w-9 h-9 sm:w-auto sm:h-auto sm:px-3 sm:py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-pink-300 border border-slate-700/80 flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                title="Start private video call"
              >
                <Video className="w-4 h-4" />

                <span className="hidden xl:inline">
                  Video
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={() =>
                setIsSearching(
                  (prev) => !prev
                )
              }
              className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${
                isSearching
                  ? 'bg-indigo-600 border-indigo-500 text-white'
                  : 'bg-slate-900 border-slate-800 text-slate-400'
              }`}
              title="Search conversation"
            >
              <Search className="w-4 h-4" />
            </button>

            <button
              id="open-profile-settings-btn"
              type="button"
              onClick={onOpenProfile}
              className="w-9 h-9 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-white flex items-center justify-center shrink-0"
              title="Change your PFP & Profile"
            >
              <Settings className="w-4 h-4" />
            </button>

            <button
              id="user-logout-btn"
              type="button"
              onClick={onLogout}
              className="w-9 h-9 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-red-400 flex items-center justify-center shrink-0"
              title="Lock & Exit Sanctuary"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* =====================================================
          SEARCH
      ====================================================== */}
      <AnimatePresence>
        {isSearching && (
          <motion.div
            initial={{
              height: 0,
              opacity: 0,
            }}
            animate={{
              height: 'auto',
              opacity: 1,
            }}
            exit={{
              height: 0,
              opacity: 0,
            }}
            className="shrink-0 w-full bg-slate-900/98 border-b border-slate-800 px-2.5 sm:px-4 py-2 flex items-center gap-2 z-20"
          >
            <Search className="w-4 h-4 text-slate-400 shrink-0" />

            <input
              type="text"
              value={searchQuery}
              onChange={(e) =>
                setSearchQuery(
                  e.target.value
                )
              }
              placeholder="Search private messages..."
              autoFocus
              className="min-w-0 flex-1 bg-transparent text-[16px] sm:text-xs text-white placeholder-slate-500 focus:outline-none"
            />

            {searchQuery && (
              <button
                type="button"
                onClick={() =>
                  setSearchQuery('')
                }
                className="text-slate-400 hover:text-white text-xs shrink-0"
              >
                Clear
              </button>
            )}

            <button
              type="button"
              onClick={() =>
                setIsSearching(false)
              }
              className="text-slate-400 hover:text-white p-1 shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* =====================================================
          PINNED MESSAGE
      ====================================================== */}
      {pinnedMessage && (
        <div className="shrink-0 w-full bg-slate-950/95 border-b border-indigo-500/20 px-2.5 sm:px-4 py-2 flex items-center justify-between text-[10px] sm:text-xs text-indigo-200 z-10">
          <div className="flex min-w-0 items-center gap-2 truncate">
            <Pin className="w-3.5 h-3.5 text-amber-400 fill-amber-400 shrink-0" />

            <span className="font-semibold text-slate-300 shrink-0">
              Pinned:
            </span>

            <span className="truncate italic">
              "{pinnedMessage.text}"
            </span>
          </div>

          <button
            type="button"
            onClick={() =>
              handlePin(
                pinnedMessage.id
              )
            }
            className="text-[11px] text-slate-400 hover:text-white shrink-0 ml-2"
          >
            Unpin
          </button>
        </div>
      )}

      {/* =====================================================
          ONLY THIS AREA SCROLLS
      ====================================================== */}
      <main
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain px-2 sm:px-4 py-2 sm:py-4"
        style={{
          WebkitOverflowScrolling: 'touch',
        }}
      >
        <div className="min-h-full w-full space-y-1 pb-2">
          {/* Welcome Card */}
          <div className="w-full max-w-lg mx-auto my-3 sm:my-6 p-4 sm:p-6 rounded-3xl bg-slate-950/75 border border-slate-800/80 text-center shadow-xl backdrop-blur-md">
            <div className="flex items-center justify-center gap-3 sm:gap-4 mb-2.5 sm:mb-3">
              <LogoMark
                logo={currentUser.logo}
                size="sm"
                glow={true}
              />

              <span className="text-indigo-400 text-xs">
                ✦
              </span>

              <LogoMark
                logo={otherUser.logo}
                size="sm"
                glow={true}
              />
            </div>

            <h3 className="text-base sm:text-lg font-bold text-white font-cinzel tracking-anime-title text-shadow-cinematic mb-1">
              {settings.worldTitle ||
                'SYNAX'}
            </h3>

            <p className="text-[11px] sm:text-xs leading-relaxed text-slate-300/80 italic font-sans-celestial tracking-wide">
              {settings.welcomeMessage ||
                'Welcome to your private sanctuary. Every conversation belongs solely to you two.'}
            </p>
          </div>

          {/* Messages */}
          {filteredMessages.map((msg) => {
            const sender =
              msg.senderId === currentUser.id
                ? currentUser
                : otherUser;

            return (
              <MessageItem
                key={msg.id}
                message={msg}
                currentUserId={
                  currentUser.id
                }
                senderName={sender.name}
                senderPfp={
                  sender.pfpUrl ||
                  'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100'
                }
                onReact={handleReact}
                onReply={(m) =>
                  setReplyingTo(m)
                }
                onPin={handlePin}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onOpenImage={(url) =>
                  setLightboxImage(url)
                }
              />
            );
          })}

          {/* Typing */}
          {isOtherTyping && (
            <motion.div
              initial={{
                opacity: 0,
                y: 5,
              }}
              animate={{
                opacity: 1,
                y: 0,
              }}
              className="flex items-center gap-2 px-2.5 sm:px-4 py-2 text-xs text-slate-400"
            >
              <div className="w-6 h-6 rounded-full overflow-hidden shrink-0">
                <img
                  src={
                    otherUser.pfpUrl ||
                    'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=100'
                  }
                  alt={otherUser.name}
                  className="block w-full h-full object-cover object-center aspect-square"
                />
              </div>

              <div className="flex gap-1 items-center px-3 py-1.5 rounded-full bg-slate-900 border border-slate-800">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" />
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce [animation-delay:0.2s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce [animation-delay:0.4s]" />
              </div>
            </motion.div>
          )}

          <div
            ref={messagesEndRef}
            className="h-px"
          />
        </div>
      </main>

      {/* =====================================================
          BOTTOM COMPOSER
          Stays outside scrolling area
      ====================================================== */}
      <div className="shrink-0 w-full z-30">
        <MessageComposer
          onSendMessage={handleSendMessage}
          onTyping={handleTyping}
          onUpload={handleUpload}
          isExpired={
            timeStatus?.isExpired
          }
          settings={settings}
          replyingTo={replyingTo}
          onCancelReply={() =>
            setReplyingTo(null)
          }
        />
      </div>

      {/* =====================================================
          IMAGE LIGHTBOX
      ====================================================== */}
      <AnimatePresence>
        {lightboxImage && (
          <motion.div
            initial={{
              opacity: 0,
            }}
            animate={{
              opacity: 1,
            }}
            exit={{
              opacity: 0,
            }}
            onClick={() =>
              setLightboxImage(null)
            }
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-xl"
          >
            <img
              src={lightboxImage}
              alt="Preview"
              className="max-w-full max-h-[90vh] object-contain rounded-2xl shadow-2xl"
            />

            <button
              type="button"
              onClick={() =>
                setLightboxImage(null)
              }
              className="absolute top-6 right-6 p-2 rounded-full bg-slate-900/80 text-white"
            >
              <X className="w-6 h-6" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
