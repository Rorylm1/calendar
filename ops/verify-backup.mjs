#!/usr/bin/env node
// This deliberately imports no application modules and never constructs Store.
import { createDecipheriv, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, copyFileSync, constants, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const fail = code => { const error = new Error(code); error.safeCode = code; throw error; };
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');
function privateFile(path) {
  const value = lstatSync(path);
  if (!value.isFile() || value.isSymbolicLink() || (value.mode & 0o077) || value.uid !== process.getuid()) fail('private_file_required');
}
function privateDirectory(path) {
  const value = lstatSync(path);
  if (!value.isDirectory() || value.isSymbolicLink() || (value.mode & 0o077) || value.uid !== process.getuid()) fail('private_directory_required');
}
function keyBytes(value) {
  if (typeof value !== 'string' || !(/^[a-fA-F0-9]{64}$/.test(value) || /^[A-Za-z0-9+/]+={0,2}$/.test(value))) fail('invalid_key');
  const key = Buffer.from(value, /^[a-fA-F0-9]{64}$/.test(value) ? 'hex' : 'base64');
  if (key.length !== 32) fail('invalid_key');
  return key;
}
function decrypt(value, context, key) {
  try {
    const parts = value.split('.');
    if (parts.length !== 4 || parts[0] !== 'v1') fail('decryption_failed');
    const nonce = Buffer.from(parts[1], 'base64'); const tag = Buffer.from(parts[2], 'base64');
    if (nonce.length !== 12 || tag.length !== 16) fail('decryption_failed');
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAAD(Buffer.from(context)); decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64')), decipher.final()]);
    try { JSON.parse(plaintext.toString('utf8')); } finally { plaintext.fill(0); }
  } catch { fail('decryption_failed'); }
}

export function verifyBackup(backupDirectory, encodedKey, reportPath) {
  const backup = resolve(backupDirectory); const report = resolve(reportPath);
  privateDirectory(backup);
  const database = join(backup, 'calendar.sqlite'); const manifestPath = join(backup, 'manifest.json');
  privateFile(database); privateFile(manifestPath);
  if (readdirSync(backup).some(name => /^calendar\.sqlite-/.test(name))) fail('snapshot_sidecars_present');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.format !== 'calendar-online-backup-v1' || manifest.databaseFile !== 'calendar.sqlite' || manifest.integrity !== 'ok' || !/^[a-f0-9]{64}$/.test(manifest.sha256) || !/^calendar-\d{8}T\d{6}Z-[a-f0-9]{8}$/.test(manifest.backupId)) fail('invalid_manifest');
  const before = digest(database);
  if (before !== manifest.sha256) fail('checksum_failed');
  const key = keyBytes(encodedKey);
  const temporary = mkdtempSync(join(tmpdir(), 'calendar-restore-check-'));
  chmodSync(temporary, 0o700);
  let db;
  try {
    const copy = join(temporary, 'restored.sqlite');
    copyFileSync(database, copy, constants.COPYFILE_EXCL); chmodSync(copy, 0o600);
    db = new DatabaseSync(copy, { readOnly: true });
    db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF;');
    const integrity = db.prepare('PRAGMA integrity_check').all();
    if (integrity.length !== 1 || Object.values(integrity[0])[0] !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) fail('integrity_failed');
    const expected = ['fingerprints', 'oauth_states', 'records', 'sources', 'usage'];
    const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.name);
    if (JSON.stringify(tables) !== JSON.stringify(expected)) fail('unsupported_schema');
    const counts = { encryptedRecords: 0, sourcePayloads: 0, sourceAudits: 0, oauthStates: 0 };
    for (const row of db.prepare('SELECT bucket,id,payload FROM records').iterate()) { decrypt(row.payload, `${row.bucket}:${row.id}`, key); counts.encryptedRecords++; }
    for (const row of db.prepare('SELECT id,payload,audit FROM sources').iterate()) {
      if (row.payload !== null) { decrypt(row.payload, `source:${row.id}`, key); counts.sourcePayloads++; }
      if (row.audit !== null) { decrypt(row.audit, `audit:${row.id}`, key); counts.sourceAudits++; }
    }
    for (const row of db.prepare('SELECT hash,payload FROM oauth_states').iterate()) { decrypt(row.payload, `oauth:${row.hash}`, key); counts.oauthStates++; }
    if (Object.values(counts).reduce((a, b) => a + b, 0) === 0) fail('no_encrypted_payloads_to_verify');
    const tableCounts = Object.fromEntries(expected.map(table => [table, Number(db.prepare(`SELECT COUNT(*) count FROM "${table}"`).get().count)]));
    db.close(); db = undefined;
    if (digest(database) !== before) fail('backup_changed_during_verification');
    mkdirSync(dirname(report), { recursive: true, mode: 0o700 }); privateDirectory(dirname(report));
    const result = { verified: true, verifiedAt: new Date().toISOString(), backupId: manifest.backupId, sha256: before, integrity: 'ok', ...counts, tableCounts, originalBackupUnchanged: true, isolatedReadOnlyCopy: true, providerCalls: 0, productionRestorePerformed: false, separateKeyBackupVerified: false };
    writeFileSync(report, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    return result;
  } finally {
    db?.close(); key.fill(0); rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] === '-' || (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  try {
    if (args.length !== 4 || args[0] !== '--backup' || args[2] !== '--report') fail('usage_requires_backup_and_private_report');
    verifyBackup(args[1], process.env.CALENDAR_ENCRYPTION_KEY, args[3]);
    console.log(JSON.stringify({ ok: true, verified: true, reportWritten: true }));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error.safeCode || 'backup_verification_failed' }));
    process.exitCode = 1;
  }
}
