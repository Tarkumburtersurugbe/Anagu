import crypto from 'crypto';
import type { Response } from 'express';
import { db } from './db.ts';

interface SseClient {
  id: string;
  userId: string;
  res: Response;
}

const clients = new Map<string, SseClient>();

export function registerMqttStreamClient(userId: string, res: Response): string {
  const clientId = `sse-${crypto.randomUUID().slice(0, 8)}`;
  clients.set(clientId, { id: clientId, userId, res });
  return clientId;
}

export function unregisterMqttStreamClient(clientId: string) {
  clients.delete(clientId);
}

export function publishMqttEvent(params: {
  topic: string;
  qos?: 0 | 1 | 2;
  payload: Record<string, unknown>;
  notifyUserIds?: string[];
  notificationTitle?: string;
  notificationMessage?: string;
  notificationCategory?: string;
}) {
  const id = `mq-${crypto.randomUUID().slice(0, 8)}`;
  const qos = params.qos ?? 1;
  const now = new Date().toISOString();
  const start = Date.now();

  const hasConnectedClients = clients.size > 0;
  const deliveryStatus = hasConnectedClients ? 'Delivered' : 'Published';
  const latencyMs = Math.max(8, Date.now() - start + (qos === 2 ? 18 : 11));

  db.prepare(`
    INSERT INTO mqtt_messages (id, topic, qos, payload, delivery_status, latency_ms, published_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, params.topic, qos, JSON.stringify(params.payload), deliveryStatus, latencyMs, now);

  if (params.notifyUserIds && params.notificationTitle && params.notificationMessage) {
    const insertNotif = db.prepare(`
      INSERT INTO notifications (id, user_id, title, message, category, is_read, created_at)
      VALUES (?, ?, ?, ?, ?, 0, ?)
    `);
    for (const uid of new Set(params.notifyUserIds)) {
      insertNotif.run(
        `ntf-${crypto.randomUUID().slice(0, 8)}`,
        uid,
        params.notificationTitle,
        params.notificationMessage,
        params.notificationCategory || 'Registry Update',
        now
      );
    }
  }

  const eventFrame = JSON.stringify({
    id,
    topic: params.topic,
    qos,
    payload: params.payload,
    deliveryStatus,
    latencyMs,
    publishedAt: now,
  });

  for (const client of clients.values()) {
    try {
      client.res.write(`event: mqtt\ndata: ${eventFrame}\n\n`);
    } catch {
      clients.delete(client.id);
    }
  }

  return { id, topic: params.topic, qos, deliveryStatus, latencyMs, publishedAt: now };
}
