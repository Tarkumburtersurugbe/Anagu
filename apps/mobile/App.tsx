import React, { useEffect, useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API_BASE = process.env.EXPO_PUBLIC_ANAGU_API || 'http://localhost:3000';
const OFFLINE_QUEUE_KEY = 'anagu_mobile_offline_queue_v1';

interface QueuedSubmission {
  id: string;
  endpoint: string;
  payload: Record<string, unknown>;
  queuedAt: string;
}

export default function AnaguMobileApp() {
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState('citizen@anagu.ng');
  const [password, setPassword] = useState('Anagu@2026!');
  const [offlineMode, setOfflineMode] = useState(false);
  const [queue, setQueue] = useState<QueuedSubmission[]>([]);
  const [statusMessage, setStatusMessage] = useState('Ready');
  const [parcelLocation, setParcelLocation] = useState('');
  const [coordinatesText, setCoordinatesText] = useState('9.0765,7.3986; 9.0772,7.3986; 9.0772,7.3994; 9.0765,7.3994');

  useEffect(() => {
    AsyncStorage.getItem(OFFLINE_QUEUE_KEY).then((raw) => {
      if (raw) setQueue(JSON.parse(raw));
    });
  }, []);

  async function signIn() {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (res.ok) {
      setToken(data.token);
      setStatusMessage(`Signed in as ${data.user.fullName} (${data.user.role})`);
    } else {
      setStatusMessage(data.error || 'Authentication failed');
    }
  }

  async function submitFieldApplication() {
    const points = coordinatesText.split(';').map((pair) => {
      const [lat, lng] = pair.trim().split(',').map(Number);
      return [lat, lng];
    });
    const payload = {
      landLocation: parcelLocation || 'Plot 412, Maitama District, FCT Abuja',
      stateName: 'FCT Abuja',
      lgaName: 'AMAC',
      landSizeSqm: 950,
      ownershipCategory: 'Certificate of Occupancy',
      coordinates: points,
      submitNow: true,
    };

    if (offlineMode) {
      const next = [
        ...queue,
        { id: `mob-${Date.now()}`, endpoint: '/api/applications', payload, queuedAt: new Date().toISOString() },
      ];
      setQueue(next);
      await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(next));
      setStatusMessage('Saved to offline field queue (will sync on reconnect).');
      return;
    }

    const res = await fetch(`${API_BASE}/api/applications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    setStatusMessage(res.ok ? `Submitted ${data.application?.applicationRef}` : data.error);
  }

  async function syncOfflineQueue() {
    if (!token || queue.length === 0) return;
    const res = await fetch(`${API_BASE}/api/sync/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ items: queue }),
    });
    if (res.ok) {
      setQueue([]);
      await AsyncStorage.removeItem(OFFLINE_QUEUE_KEY);
      setStatusMessage('Offline queue synchronized with ANAGU Registry.');
    }
  }

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>ANAGU Mobile Field Companion</Text>
        <Text style={styles.subtitle}>Citizen & Surveyor Offline-First Client</Text>

        {!token ? (
          <View style={styles.card}>
            <TextInput style={styles.input} value={email} onChangeText={setEmail} placeholder="Email" autoCapitalize="none" />
            <TextInput style={styles.input} value={password} onChangeText={setPassword} placeholder="Password" secureTextEntry />
            <TouchableOpacity style={styles.button} onPress={signIn}>
              <Text style={styles.buttonText}>Sign In to ANAGU</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.card}>
            <TouchableOpacity style={styles.secondaryButton} onPress={() => setOfflineMode(!offlineMode)}>
              <Text style={styles.secondaryText}>Network Mode: {offlineMode ? 'OFFLINE (Queued)' : 'ONLINE (Live)'}</Text>
            </TouchableOpacity>
            <TextInput style={styles.input} value={parcelLocation} onChangeText={setParcelLocation} placeholder="Parcel Location (State, LGA, Plot)" />
            <TextInput style={styles.input} value={coordinatesText} onChangeText={setCoordinatesText} placeholder="Lat,Lng; Lat,Lng..." />
            <TouchableOpacity style={styles.button} onPress={submitFieldApplication}>
              <Text style={styles.buttonText}>Submit Parcel Coordinates</Text>
            </TouchableOpacity>
            {queue.length > 0 && !offlineMode && (
              <TouchableOpacity style={styles.button} onPress={syncOfflineQueue}>
                <Text style={styles.buttonText}>Sync {queue.length} Queued Item(s)</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        <Text style={styles.status}>{statusMessage}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8FAFC' },
  container: { padding: 20, gap: 16 },
  title: { fontSize: 22, fontWeight: '700', color: '#0F172A' },
  subtitle: { fontSize: 13, color: '#475569' },
  card: { backgroundColor: '#FFFFFF', padding: 16, borderRadius: 10, borderWidth: 1, borderColor: '#E2E8F0', gap: 12 },
  input: { borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 8, padding: 12, fontSize: 14 },
  button: { backgroundColor: '#0F766E', padding: 14, borderRadius: 8, alignItems: 'center' },
  buttonText: { color: '#FFFFFF', fontWeight: '600' },
  secondaryButton: { backgroundColor: '#F1F5F9', padding: 10, borderRadius: 8, alignItems: 'center' },
  secondaryText: { color: '#0F172A', fontWeight: '600', fontSize: 12 },
  status: { fontSize: 13, color: '#0F766E', marginTop: 8 },
});
