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
