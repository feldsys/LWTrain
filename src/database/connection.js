const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'lottery.db');

let db;

function getDb() {
    if (!db) {
        db = new Database(dbPath);
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');
        db.pragma('busy_timeout = 5000');
        db.pragma('synchronous = NORMAL');
        db.pragma('cache_size = -20000');
        db.pragma('temp_store = MEMORY');
    }
    return db;
}

function closeDb() {
    if (db) {
        db.close();
        db = null;
    }
}

module.exports = { getDb, closeDb };
