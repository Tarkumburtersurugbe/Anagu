import { useEffect, useState } from 'react';
import { Check, Radio, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import {
  apiRequest,
  clearOfflineQueue,
  getOfflineQueue,
  isOfflineSimulated,
  setOfflineSimulated,
} from '../lib/api';
import type { MqttMessage, OfflineQueueItem } from '../types/anagu';

interface MqttSyncViewProps {
  onRefresh: () => void;
  onNotify: (msg: string, tone?: 'success' | 'error') => void;
}

export function MqttSyncView({ onRefresh, onNotify }: MqttSyncViewProps) {
  const [messages, setMessages] = useState<MqttMessage[]>([]);
  const [offline, setOffline] = useState(isOfflineSimulated());
  const [queue, setQueue] = useState<OfflineQueueItem[]>(getOfflineQueue());
  const [syncing, setSyncing] = useState(false);

  async function loadMessages() {
    try {
      const res = await apiRequest<{ messages: MqttMessage[] }>('/api/mqtt/messages');
      setMessages(res.messages);
    } catch {
      // Ignore if currently offline
    }
  }

  useEffect(() => {
    loadMessages();
    setQueue(getOfflineQueue());
  }, []);

  async function toggleOfflineMode() {
    const next = !offline;
    setOfflineSimulated(next);
    setOffline(next);
    onNotify(
      next
        ? 'Offline Mode Enabled: New field submissions will queue locally.'
        : 'Network Reconnected: Ready to synchronise queued items.'
    );
    if (!next && getOfflineQueue().length > 0) {
      await syncNow();
    }
  }

  async function syncNow() {
    const items = getOfflineQueue();
    if (items.length === 0) return;
    setSyncing(true);
    try {
      const res = await apiRequest<{ synced: Array<{ id: string; detail: string }> }>('/api/sync/batch', {
        method: 'POST',
        body: JSON.stringify({ items }),
      });
      clearOfflineQueue();
      setQueue([]);
      onNotify(`Synchronised ${res.synced.length} offline submission(s) to ANAGU Registry.`);
      await loadMessages();
      onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Sync failed', 'error');
    } finally {
      setSyncing(false);
    }
  }

  async function acknowledgeMessage(id: string) {
    try {
      await apiRequest(`/api/mqtt/ack/${id}`, { method: 'POST' });
      await loadMessages();
      onNotify('MQTT delivery acknowledged (QoS ACK recorded).');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'ACK failed', 'error');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 rounded-lg border border-slate-200 bg-white p-5 sm:flex-row sm:items-center">
        <div>
          <h1 className="font-display text-lg font-bold text-slate-900">
            MQTT Real-Time Messaging &amp; Offline Synchronisation
          </h1>
          <p className="text-xs text-slate-500">
            QoS delivery tracking, real-time SSE topic stream, and resilient offline field submission queue.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={toggleOfflineMode}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
              offline
                ? 'border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
                : 'border border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
            }`}
          >
            {offline ? <WifiOff className="h-3.5 w-3.5" /> : <Wifi className="h-3.5 w-3.5" />}
            {offline ? 'Simulated Offline Mode (Click to Reconnect)' : 'Online (Click to Test Offline Mode)'}
          </button>

          <button
            type="button"
            disabled={syncing || queue.length === 0 || offline}
            onClick={syncNow}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
            Sync Queue ({queue.length})
          </button>
        </div>
      </div>

      {/* Offline Submission Queue */}
      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-sm font-bold text-slate-900">Offline Field Submission Queue</h2>
          <span className="font-mono text-xs text-slate-500 tabular-nums">{queue.length} queued</span>
        </div>
        {queue.length === 0 ? (
          <p className="mt-2 text-xs text-slate-500">
            No pending offline submissions. Enable Offline Mode above and submit a land registration application to test
            local queuing and automatic reconnection sync.
          </p>
        ) : (
          <div className="mt-3 divide-y divide-slate-100 text-xs">
            {queue.map((item) => (
              <div key={item.id} className="flex items-center justify-between py-2.5">
                <div>
                  <span className="font-semibold text-slate-900">{item.label}</span>
                  <span className="ml-2 font-mono text-[11px] text-slate-500">
                    Queued {new Date(item.queuedAt).toLocaleString()}
                  </span>
                </div>
                <span className="font-semibold text-amber-700">Waiting for Reconnection</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* MQTT Communication Logs */}
      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-display text-sm font-bold text-slate-900">
            <Radio className="h-4 w-4 text-emerald-700" />
            MQTT Communication Event Log
          </h2>
          <button
            type="button"
            onClick={loadMessages}
            className="text-xs font-semibold text-emerald-700 hover:underline"
          >
            Refresh Log
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 text-slate-500">
              <tr>
                <th className="py-2 pr-3 font-semibold">Topic</th>
                <th className="py-2 pr-3 font-semibold">QoS</th>
                <th className="py-2 pr-3 font-semibold">Payload</th>
                <th className="py-2 pr-3 font-semibold">Delivery</th>
                <th className="py-2 pr-3 text-right font-semibold">Latency</th>
                <th className="py-2 text-right font-semibold">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {messages.map((m) => (
                <tr key={m.id} className="hover:bg-slate-50">
                  <td className="py-2.5 pr-3 font-mono font-semibold text-slate-900">{m.topic}</td>
                  <td className="py-2.5 pr-3 font-mono text-slate-700 tabular-nums">QoS {m.qos}</td>
                  <td className="max-w-xs truncate py-2.5 pr-3 font-mono text-[11px] text-slate-600">{m.payload}</td>
                  <td className="py-2.5 pr-3 font-semibold text-emerald-700">{m.delivery_status}</td>
                  <td className="py-2.5 pr-3 text-right font-mono text-slate-700 tabular-nums">{m.latency_ms} ms</td>
                  <td className="py-2.5 text-right">
                    {m.delivery_status !== 'Acknowledged' ? (
                      <button
                        type="button"
                        onClick={() => acknowledgeMessage(m.id)}
                        className="inline-flex items-center gap-1 font-semibold text-emerald-700 hover:underline"
                      >
                        <Check className="h-3 w-3" />
                        ACK
                      </button>
                    ) : (
                      <span className="text-slate-400">Acked</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
