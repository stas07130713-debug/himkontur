import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isNewerRelease, parseLatestYml } from './update-metadata.mjs';

describe('Windows release metadata', () => {
  it('detects a newer semantic application version', () => {
    assert.equal(isNewerRelease('0.3.57', '0.3.56'), true);
    assert.equal(isNewerRelease('0.3.56', '0.3.56'), false);
    assert.equal(isNewerRelease('0.3.55', '0.3.56'), false);
  });

  it('reads the installer and checksum from electron-builder latest.yml', () => {
    assert.deepEqual(parseLatestYml("version: 0.3.57\npath: HIMKONTUR-0.3.57-x64-Setup.exe\nsha512: abc123=\n"), {
      version: '0.3.57',
      path: 'HIMKONTUR-0.3.57-x64-Setup.exe',
      sha512: 'abc123=',
    });
  });
});

describe('sandboxed preload', () => {
  it('exposes updater, replays status and removes event listeners', async () => {
    const exposed = {};
    const listeners = new Map();
    const ipcRenderer = {
      invoke: async (channel) => channel === 'himkontur:update-status-current' ? { state: 'available', version: '0.3.99' } : null,
      on: (channel, listener) => listeners.set(channel, listener),
      removeListener: (channel, listener) => { if (listeners.get(channel) === listener) listeners.delete(channel); },
    };
    runInNewContext(readFileSync(new URL('./preload.cjs', import.meta.url), 'utf8'), {
      require: (name) => {
        assert.equal(name, 'electron');
        return { ipcRenderer, contextBridge: { exposeInMainWorld: (name, value) => { exposed[name] = value; } } };
      },
    });
    assert.equal(exposed.himkonturUpdates.platform, 'windows');
    assert.equal((await exposed.himkonturUpdates.getStatus()).version, '0.3.99');
    let received;
    const unsubscribe = exposed.himkonturUpdates.onStatus((value) => { received = value; });
    listeners.get('himkontur:update-status')({}, { state: 'available', version: '0.3.99' });
    assert.equal(received.version, '0.3.99');
    unsubscribe();
    assert.equal(listeners.size, 0);
    assert.equal(typeof exposed.himkonturWeather.getForecast, 'function');
  });
});
