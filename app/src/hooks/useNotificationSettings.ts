import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';

export interface NotificationSettings {
  telegramChatId: string | null;
  notifyOnExec: boolean;
  notifyOnFail: boolean;
}

export function useNotificationSettings(jwt: string | null) {
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchSettings = useCallback(async () => {
    if (!jwt) return;
    setIsLoading(true);
    try {
      const res = await api.get<{ ok: boolean; data: NotificationSettings }>(
        '/api/notifications/settings',
        jwt,
      );
      if (res.ok) setSettings(res.data);
    } catch {
      // non-fatal
    } finally {
      setIsLoading(false);
    }
  }, [jwt]);

  useEffect(() => {
    void fetchSettings();
  }, [fetchSettings]);

  return { settings, isLoading, refetch: fetchSettings };
}
