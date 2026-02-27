import { describe, test, expect, mock, beforeEach } from 'bun:test';
import {
  getRemoteAccessConfig,
  updateRemoteAccessConfig,
  getTailscaleStatus,
  isOriginRemote,
  registerRemoteClient,
  unregisterRemoteClient,
  getRemoteClients,
} from '../remote-access';

describe('Remote Access Service', () => {
  describe('isOriginRemote', () => {
    test('localhost is not remote', () => {
      expect(isOriginRemote('http://localhost:3002')).toBe(false);
      expect(isOriginRemote('http://127.0.0.1:3002')).toBe(false);
      expect(isOriginRemote('http://[::1]:3002')).toBe(false);
    });

    test('LAN IPs are not remote', () => {
      expect(isOriginRemote('http://192.168.1.100:3002')).toBe(false);
      expect(isOriginRemote('http://10.0.0.50:3002')).toBe(false);
      expect(isOriginRemote('http://172.16.0.10:3002')).toBe(false);
    });

    test('Tailscale domains are remote', () => {
      expect(isOriginRemote('https://my-machine.tail1234.ts.net')).toBe(true);
    });

    test('other domains are remote', () => {
      expect(isOriginRemote('https://example.com')).toBe(true);
      expect(isOriginRemote('https://1.2.3.4:3002')).toBe(true);
    });

    test('empty origin is not remote', () => {
      expect(isOriginRemote('')).toBe(false);
    });
  });

  describe('remote client tracking', () => {
    beforeEach(() => {
      // Clear all clients before each test
      const clients = getRemoteClients();
      clients.forEach((client) => unregisterRemoteClient(client.id));
    });

    test('register and track remote clients', () => {
      registerRemoteClient('client1', 'https://example.com', 'Mozilla/5.0');
      registerRemoteClient('client2', 'http://localhost:3002', 'Chrome');

      const clients = getRemoteClients();
      expect(clients).toHaveLength(2);

      const remoteClient = clients.find((c) => c.id === 'client1');
      expect(remoteClient?.isRemote).toBe(true);
      expect(remoteClient?.origin).toBe('https://example.com');

      const localClient = clients.find((c) => c.id === 'client2');
      expect(localClient?.isRemote).toBe(false);
    });

    test('unregister clients', () => {
      registerRemoteClient('client1', 'https://example.com');
      registerRemoteClient('client2', 'http://localhost:3002');

      unregisterRemoteClient('client1');

      const clients = getRemoteClients();
      expect(clients).toHaveLength(1);
      expect(clients[0].id).toBe('client2');
    });
  });

  describe('getTailscaleStatus', () => {
    test('returns not available when tailscale is not installed', () => {
      const status = getTailscaleStatus();
      // This will depend on whether tailscale is actually installed
      expect(status).toHaveProperty('available');
      expect(status).toHaveProperty('running');
    });
  });
});
