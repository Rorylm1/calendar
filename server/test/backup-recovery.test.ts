import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.ts';

const project = fileURLToPath(new URL('../../', import.meta.url));
const backupScript = join(project, 'ops/backup-calendar.py');
const verifyScript = join(project, 'ops/verify-backup.mjs');
const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'calendar-backup-test-')); const source = join(directory, 'live.sqlite');
  const key = randomBytes(32).toString('hex'); const store = new Store(source, key);
  store.db.exec('PRAGMA wal_autocheckpoint=0;');
  store.put('events', 'synthetic-event', { title: 'Secret synthetic dinner', date: '2026-09-18' });
  store.put('credentials', 'default', { refresh_token: 'synthetic-private-token' });
  store.db.prepare('INSERT INTO sources(id,status,captured_at,updated_at,payload,audit) VALUES(?,?,?,?,?,?)').run('synthetic-source', 'processing', '2026-09-07', '2026-09-07', store.vault.seal({ text: 'Secret synthetic message' }, 'source:synthetic-source'), store.vault.seal({ reason: 'Synthetic evidence' }, 'audit:synthetic-source'));
  store.createOAuthState('synthetic-state', 'synthetic-owner', 'synthetic-verifier');
  const destination = join(directory, 'backups'); const reports = join(directory, 'reports'); const verificationTemp = join(directory, 'verify-temp');
  mkdirSync(verificationTemp, { mode: 0o700 });
  const backup = (args: string[] = []) => {
    const result = spawnSync('python3', [backupScript, '--source', source, '--destination', destination, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return join(destination, JSON.parse(result.stdout).backupId as string);
  };
  const verify = (path: string, overrideKey = key, reportName = 'verified.json') => spawnSync(process.execPath, [verifyScript, '--backup', path, '--report', join(reports, reportName)], { env: { ...process.env, CALENDAR_ENCRYPTION_KEY: overrideKey, TMPDIR: verificationTemp }, encoding: 'utf8' });
  const close = () => { store.close(); rmSync(directory, { recursive: true, force: true }); };
  return { directory, source, key, store, destination, reports, verificationTemp, backup, verify, close };
}

test('online backup captures committed WAL data while preserving the live processing state and separate key', () => {
  const f = fixture();
  try {
    assert.ok(statSync(f.source + '-wal').size > 0);
    const original = digest(f.source); const originalWal = digest(f.source + '-wal');
    const bundle = f.backup();
    assert.equal(digest(f.source), original); assert.equal(digest(f.source + '-wal'), originalWal);
    assert.equal(f.store.db.prepare('SELECT status FROM sources').get()!.status, 'processing');
    assert.deepEqual(readdirSync(bundle).sort(), ['calendar.sqlite', 'manifest.json']);
    for (const file of ['calendar.sqlite', 'manifest.json']) assert.equal(statSync(join(bundle, file)).mode & 0o777, 0o600);
    assert.equal(statSync(bundle).mode & 0o777, 0o700);
    const manifest = JSON.parse(readFileSync(join(bundle, 'manifest.json'), 'utf8'));
    assert.equal(manifest.requiredKey.included, false); assert.equal(manifest.requiredKey.separateBackupRequired, true); assert.equal(manifest.restoreVerification, 'pending');
    assert.equal(readFileSync(join(bundle, 'calendar.sqlite')).includes(Buffer.from('Secret synthetic')), false);
    assert.equal(JSON.stringify(manifest).includes(f.key), false);
  } finally { f.close(); }
});

test('isolated restore verifies every encrypted storage class and leaves the backup and live files untouched', () => {
  const f = fixture();
  try {
    const bundle = f.backup(); const before = digest(join(bundle, 'calendar.sqlite')); const live = digest(f.source); const wal = digest(f.source + '-wal');
    const result = f.verify(bundle); assert.equal(result.status, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout), { ok: true, verified: true, reportWritten: true });
    const report = JSON.parse(readFileSync(join(f.reports, 'verified.json'), 'utf8'));
    assert.equal(report.encryptedRecords, 2); assert.equal(report.sourcePayloads, 1); assert.equal(report.sourceAudits, 1); assert.equal(report.oauthStates, 1);
    assert.equal(report.productionRestorePerformed, false); assert.equal(report.separateKeyBackupVerified, false); assert.equal(report.providerCalls, 0);
    assert.equal(digest(join(bundle, 'calendar.sqlite')), before); assert.equal(digest(f.source), live); assert.equal(digest(f.source + '-wal'), wal);
    assert.equal(f.store.db.prepare('SELECT status FROM sources').get()!.status, 'processing'); assert.deepEqual(readdirSync(f.verificationTemp), []);
    assert.equal(statSync(join(f.reports, 'verified.json')).mode & 0o777, 0o600);
    assert.equal(JSON.stringify(report).includes('Secret synthetic'), false); assert.equal((result.stdout + result.stderr).includes(f.key), false);
  } finally { f.close(); }
});

test('wrong keys fail closed without reports, decrypted output, or leftover restore copies', () => {
  const f = fixture();
  try {
    const bundle = f.backup(); const before = digest(join(bundle, 'calendar.sqlite'));
    const result = f.verify(bundle, randomBytes(32).toString('hex'));
    assert.equal(result.status, 1); assert.match(result.stderr, /decryption_failed/); assert.equal(result.stdout, '');
    assert.equal((result.stdout + result.stderr).includes('Secret synthetic'), false); assert.equal((result.stdout + result.stderr).includes(f.key), false);
    assert.equal(digest(join(bundle, 'calendar.sqlite')), before); assert.deepEqual(readdirSync(f.verificationTemp), []);
  } finally { f.close(); }
});

test('checksum corruption and authenticated-payload tampering both reject a restore', () => {
  const f = fixture();
  try {
    const bundle = f.backup(); const damaged = join(f.directory, 'damaged'); cpSync(bundle, damaged, { recursive: true }); chmodSync(damaged, 0o700);
    const database = join(damaged, 'calendar.sqlite');
    const db = new DatabaseSync(database); db.prepare("UPDATE records SET payload=? WHERE bucket='credentials'").run('v1.YWFh.YWFh.YWFh'); db.close();
    assert.match(f.verify(damaged).stderr, /checksum_failed/);
    const manifestPath = join(damaged, 'manifest.json'); const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')); manifest.sha256 = digest(database); writeFileSync(manifestPath, JSON.stringify(manifest));
    assert.match(f.verify(damaged).stderr, /decryption_failed/); assert.deepEqual(readdirSync(f.verificationTemp), []);
  } finally { f.close(); }
});

test('retention keeps its minimum recovery set and ignores unmanaged directories and symlinks', () => {
  const f = fixture();
  try {
    for (let i = 0; i < 5; i++) {
      const bundle = f.backup(['--keep-days', '365']); const manifestPath = join(bundle, 'manifest.json'); const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      manifest.createdAt = new Date(Date.now() - (40 - i) * 86400000).toISOString(); writeFileSync(manifestPath, JSON.stringify(manifest));
    }
    const unmanaged = join(f.destination, 'operator-notes'); mkdirSync(unmanaged); writeFileSync(join(unmanaged, 'keep.txt'), 'keep');
    const outside = join(f.directory, 'outside'); mkdirSync(outside); writeFileSync(join(outside, 'keep.txt'), 'keep');
    symlinkSync(outside, join(f.destination, 'calendar-20000101T000000Z-aaaaaaaa'));
    f.backup();
    const managed = readdirSync(f.destination).filter(name => /^calendar-/.test(name) && !name.endsWith('-aaaaaaaa'));
    assert.equal(managed.length, 3); assert.equal(readFileSync(join(unmanaged, 'keep.txt'), 'utf8'), 'keep'); assert.equal(readFileSync(join(outside, 'keep.txt'), 'utf8'), 'keep');
  } finally { f.close(); }
});

test('missing databases are never created and overexposed backup files are rejected', () => {
  const f = fixture();
  try {
    const missing = join(f.directory, 'missing.sqlite');
    const result = spawnSync('python3', [backupScript, '--source', missing, '--destination', f.destination], { encoding: 'utf8' });
    assert.equal(result.status, 1); assert.equal(readdirSync(f.directory).includes('missing.sqlite'), false);
    const bundle = f.backup(); chmodSync(join(bundle, 'calendar.sqlite'), 0o644);
    assert.match(f.verify(bundle).stderr, /private_file_required/);
  } finally { f.close(); }
});
