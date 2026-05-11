import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { MessageCircle, Check, Loader2, X, Bell, BellOff } from 'lucide-react';
import { api } from '../../lib/api';

interface TelegramPanelProps {
  jwt: string;
  telegramChatId: string | null;
  notifyOnExec: boolean;
  notifyOnFail: boolean;
  onLinked: () => void;
}

export function TelegramPanel({
  jwt,
  telegramChatId,
  notifyOnExec,
  notifyOnFail,
  onLinked,
}: TelegramPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLinking, setIsLinking] = useState(false);
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [botUsername, setBotUsername] = useState<string>('archon_agent_bot');
  const [error, setError] = useState<string | null>(null);
  const [savingExec, setSavingExec] = useState(false);
  const [savingFail, setSavingFail] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isLinked = telegramChatId !== null;

  // Poll for link completion while modal is open
  useEffect(() => {
    if (!isOpen || !deepLink) {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      return;
    }

    pollingRef.current = setInterval(() => {
      void (async () => {
        try {
          const res = await api.get<{ ok: boolean; data: { telegramChatId: string | null } }>(
            '/api/notifications/settings',
            jwt,
          );
          if (res.ok && res.data.telegramChatId) {
            setIsOpen(false);
            setDeepLink(null);
            onLinked();
          }
        } catch {
          // non-fatal
        }
      })();
    }, 2000);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [isOpen, deepLink, jwt, onLinked]);

  const handleConnect = async () => {
    setIsLinking(true);
    setError(null);
    try {
      const res = await api.post<{ ok: boolean; data: { deepLink: string; botUsername: string } }>(
        '/api/notifications/telegram/link',
        {},
        jwt,
      );
      setDeepLink(res.data.deepLink);
      setBotUsername(res.data.botUsername);
      setIsOpen(true);
    } catch {
      setError('Failed to generate link. Check that TELEGRAM_BOT_TOKEN is configured.');
    } finally {
      setIsLinking(false);
    }
  };

  const handleUnlink = async () => {
    try {
      await api.del('/api/notifications/telegram/unlink', jwt);
      onLinked();
    } catch {
      // non-fatal
    }
  };

  const updateSetting = async (key: 'notifyOnExec' | 'notifyOnFail', value: boolean) => {
    const setSaving = key === 'notifyOnExec' ? setSavingExec : setSavingFail;
    setSaving(true);
    try {
      await api.put('/api/notifications/settings', { [key]: value }, jwt);
      onLinked();
    } catch {
      // non-fatal
    } finally {
      setSaving(false);
    }
  };

  const closeModal = () => {
    setIsOpen(false);
    onLinked();
  };

  return (
    <div className="phantom-card">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <MessageCircle size={18} className={isLinked ? 'text-[#2AABEE]' : 'text-black/30'} />
          <div>
            <h3 className="text-sm font-black tracking-tight leading-none mb-0.5">Telegram Alerts</h3>
            <p className="text-[10px] text-black/40 font-bold uppercase tracking-wider">
              {isLinked ? 'Connected' : 'Not connected'}
            </p>
          </div>
        </div>
        {isLinked ? (
          <button
            onClick={() => void handleUnlink()}
            className="text-[10px] font-bold text-black/30 hover:text-brand-stop flex items-center gap-1 transition-colors"
          >
            <X size={12} /> Unlink
          </button>
        ) : (
          <button
            onClick={() => void handleConnect()}
            disabled={isLinking}
            className="text-[10px] font-black uppercase tracking-wider px-4 py-2 rounded-xl bg-[#2AABEE] text-white hover:bg-[#1a9de0] transition-colors disabled:opacity-60 flex items-center gap-1.5"
          >
            {isLinking ? <Loader2 size={12} className="animate-spin" /> : null}
            Connect
          </button>
        )}
      </div>

      {isLinked ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between px-3 py-2.5 rounded-2xl bg-black/[0.02] border border-black/[0.04]">
            <div className="flex items-center gap-2">
              <Bell size={12} className="text-black/30" />
              <span className="text-[11px] font-bold text-black/60">Alert on execution</span>
            </div>
            <button
              onClick={() => void updateSetting('notifyOnExec', !notifyOnExec)}
              disabled={savingExec}
              className={`relative w-9 h-5 rounded-full transition-colors ${notifyOnExec ? 'bg-brand-safe' : 'bg-black/15'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${notifyOnExec ? 'translate-x-4' : ''}`} />
            </button>
          </div>
          <div className="flex items-center justify-between px-3 py-2.5 rounded-2xl bg-black/[0.02] border border-black/[0.04]">
            <div className="flex items-center gap-2">
              <BellOff size={12} className="text-black/30" />
              <span className="text-[11px] font-bold text-black/60">Alert on failure</span>
            </div>
            <button
              onClick={() => void updateSetting('notifyOnFail', !notifyOnFail)}
              disabled={savingFail}
              className={`relative w-9 h-5 rounded-full transition-colors ${notifyOnFail ? 'bg-brand-safe' : 'bg-black/15'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${notifyOnFail ? 'translate-x-4' : ''}`} />
            </button>
          </div>
        </div>
      ) : (
        <p className="text-[11px] text-black/40 font-medium leading-relaxed">
          Get instant messages when your rules execute or fail.
        </p>
      )}

      {error && (
        <p className="mt-3 text-[11px] text-brand-stop font-medium">{error}</p>
      )}

      {createPortal(
        <AnimatePresence>
          {isOpen && deepLink && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm px-4"
              onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                transition={{ type: 'spring', duration: 0.3 }}
                className="bg-white rounded-[28px] p-8 w-full max-w-sm shadow-2xl text-center"
              >
                <div className="w-16 h-16 rounded-[24px] bg-[#2AABEE] flex items-center justify-center mx-auto mb-5">
                  <MessageCircle size={32} className="text-white" />
                </div>
                <h2 className="text-xl font-black tracking-tight mb-2">Open Telegram Bot</h2>
                <p className="text-xs text-black/40 font-medium mb-6 leading-relaxed">
                  Click the link below, then send{' '}
                  <code className="bg-black/5 px-1 py-0.5 rounded font-mono">/start</code>{' '}
                  to the bot. The app will connect automatically. Link expires in 10 minutes.
                </p>
                <a
                  href={deepLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex w-full h-12 rounded-2xl bg-[#2AABEE] text-white text-sm font-black hover:bg-[#1a9de0] transition-colors items-center justify-center gap-2 mb-4"
                >
                  <MessageCircle size={16} /> Open @{botUsername}
                </a>
                <div className="flex items-center justify-center gap-2 text-[10px] text-black/30 font-medium mb-4">
                  <Loader2 size={11} className="animate-spin" />
                  Waiting for you to send /start…
                </div>
                <button
                  onClick={closeModal}
                  className="text-xs text-black/30 font-bold hover:text-black/60 transition-colors flex items-center gap-1 mx-auto"
                >
                  <Check size={12} /> Done, close
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}
