import { api } from './client-api';
import type { NotificationSettings } from './push-client';

export type FeedSettings = {
  configured: boolean;
  enabled: boolean;
  url: string | null;
  webcalUrl: string | null;
  blockedEvents: { id: string; reason: string }[];
};

type ResultHandler<T> = {
  ready: (value: T) => void;
  failed: (error: unknown) => void;
};

// Each section can become usable before the other request has finished.
export function loadDeliverySettings(
  handlers: {
    feed: ResultHandler<FeedSettings>;
    notifications: ResultHandler<NotificationSettings>;
    current: () => boolean;
  },
  read: <T>(path: string) => Promise<T> = api,
) {
  const load = async <T>(path: string, handler: ResultHandler<T>) => {
    try {
      const value = await read<T>(path);
      if (handlers.current()) handler.ready(value);
    } catch (error) {
      if (handlers.current()) handler.failed(error);
    }
  };
  return Promise.all([
    load('calendar/feed', handlers.feed),
    load('notifications', handlers.notifications),
  ]);
}
