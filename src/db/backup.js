import { getDb, dbRun } from '../lib/db.js';
import { ENV } from '../config/env.js';
import { safeError, safeLog } from '../logging/logger.js';

const DB_PATH = ENV.DB_PATH;
const MAX_BACKUPS = 10;

export async function backupDatabase() {
  try {
    const fs = await import('fs');
    const path = await import('path');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(path.dirname(DB_PATH), 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const backupFile = path.join(backupDir, `cafe-${timestamp}.db`);

    const db = getDb();
    db.pragma('wal_checkpoint(TRUNCATE)');

    fs.copyFileSync(DB_PATH, backupFile);

    const backupDb = new (await import('better-sqlite3')).default(backupFile);
    const integrity = backupDb.pragma('integrity_check');
    backupDb.close();

    if (integrity !== 'ok') {
      fs.unlinkSync(backupFile);
      throw new Error(` integrity_check failed: ${integrity}`);
    }

    safeLog('[Backup] فایل پشتیبان ایجاد شد:', { file: backupFile });
    await pruneOldBackups(backupDir, MAX_BACKUPS);
    return backupFile;
  } catch (err) {
    safeError('[Backup] خطا در ایجاد پشتیبان:', { error: err.message });
    throw err;
  }
}

async function pruneOldBackups(backupDir, keepCount) {
  try {
    const fs = await import('fs');
    const path = await import('path');
    if (!fs.existsSync(backupDir)) return;
    const files = fs.readdirSync(backupDir)
      .filter(f => f.endsWith('.db'))
      .map(f => ({
        name: f,
        path: path.join(backupDir, f),
        mtime: fs.statSync(path.join(backupDir, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime);

    for (let i = keepCount; i < files.length; i++) {
      fs.unlinkSync(files[i].path);
      safeLog('[Backup] فایل پشتیبان قدیمی حذف شد:', { file: files[i].path });
    }
  } catch {
    // silent
  }
}

export async function listBackups() {
  try {
    const fs = await import('fs');
    const path = await import('path');
    const backupDir = path.join(path.dirname(DB_PATH), 'backups');
    if (!fs.existsSync(backupDir)) return [];
    return fs.readdirSync(backupDir)
      .filter(f => f.endsWith('.db'))
      .map(f => ({
        name: f,
        path: path.join(backupDir, f),
        size: fs.statSync(path.join(backupDir, f)).size,
      }));
  } catch {
    return [];
  }
}

export async function restoreBackup(backupPath) {
  try {
    const fs = await import('fs');
    if (!fs.existsSync(backupPath)) {
      throw new Error('فایل پشتیبان یافت نشد.');
    }
    fs.copyFileSync(backupPath, DB_PATH);
    safeLog('[Restore] پایگاه داده بازیابی شد:', { from: backupPath });
    return true;
  } catch (err) {
    safeError('[Restore] خطا در بازیابی:', { error: err.message });
    throw err;
  }
}

export function getDbPath() {
  return DB_PATH;
}
