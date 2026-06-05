require('dotenv').config();
const fs = require('fs');
const path = require('path');

let pgPool = null;
let sqliteDb = null;
let useJsonFallback = false;
let dbEngine = 'sqlite'; // 'postgres', 'sqlite', 'json'

const JSON_DB_PATH = path.join(__dirname, 'fitness_db.json');

// Helper to load/save JSON database if fallback is used
function readJsonDb() {
  if (!fs.existsSync(JSON_DB_PATH)) {
    fs.writeFileSync(JSON_DB_PATH, JSON.stringify({ users: [], workouts: [] }, null, 2), 'utf8');
  }
  try {
    return JSON.parse(fs.readFileSync(JSON_DB_PATH, 'utf8'));
  } catch (err) {
    return { users: [], workouts: [] };
  }
}

function writeJsonDb(data) {
  fs.writeFileSync(JSON_DB_PATH, JSON.stringify(data, null, 2), 'utf8');
}

// 1. Check if Neon/PostgreSQL DATABASE_URL is provided in environment variables
if (process.env.DATABASE_URL) {
  try {
    const { Pool } = require('pg');
    pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: {
        rejectUnauthorized: false // Required for secure cloud Neon connections
      }
    });

    dbEngine = 'postgres';
    console.log('DATABASE: Using Cloud PostgreSQL Database (Neon).');

    // Create tables in Postgres
    const initQueries = `
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS workouts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        mode VARCHAR(30) NOT NULL,
        reps INTEGER NOT NULL,
        avg_score REAL NOT NULL,
        duration_seconds INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;
    
    pgPool.query(initQueries)
      .then(() => console.log('DATABASE: PostgreSQL tables initialized successfully.'))
      .catch(err => {
        console.error('DATABASE: Error creating PostgreSQL tables, falling back to SQLite:', err.message);
        dbEngine = 'sqlite';
        initSqlite();
      });

  } catch (err) {
    console.warn('DATABASE: pg module failed to initialize. Falling back to local SQLite.', err.message);
    dbEngine = 'sqlite';
    initSqlite();
  }
} else {
  // Use SQLite by default
  dbEngine = 'sqlite';
  initSqlite();
}

function initSqlite() {
  try {
    const sqlite3 = require('sqlite3').verbose();
    const dbPath = path.join(__dirname, 'fitness.db');
    sqliteDb = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error('DATABASE: Failed to connect to SQLite. Using JSON fallback.', err.message);
        useJsonFallback = true;
        dbEngine = 'json';
      } else {
        console.log('DATABASE: Connected to SQLite database.');
        // Initialize tables
        sqliteDb.serialize(() => {
          sqliteDb.run(`
            CREATE TABLE IF NOT EXISTS users (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              username TEXT UNIQUE NOT NULL,
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
          `);
          sqliteDb.run(`
            CREATE TABLE IF NOT EXISTS workouts (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              user_id INTEGER NOT NULL,
              mode TEXT NOT NULL,
              reps INTEGER NOT NULL,
              avg_score REAL NOT NULL,
              duration_seconds INTEGER NOT NULL,
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
            )
          `);
        });
      }
    });
  } catch (err) {
    console.warn('DATABASE: sqlite3 module not found. Falling back to local JSON file database.', err.message);
    useJsonFallback = true;
    dbEngine = 'json';
  }
}

// Database helper API wrapping operations in Promises
const db = {
  getEngine: () => dbEngine,
  isUsingFallback: () => (dbEngine === 'json'),

  // --- Users Operations ---
  getUsers: () => {
    return new Promise((resolve, reject) => {
      if (dbEngine === 'postgres') {
        pgPool.query('SELECT * FROM users ORDER BY username ASC', [], (err, result) => {
          if (err) reject(err);
          else resolve(result.rows);
        });
      } else if (dbEngine === 'sqlite') {
        sqliteDb.all('SELECT * FROM users ORDER BY username ASC', [], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      } else {
        const data = readJsonDb();
        resolve(data.users);
      }
    });
  },

  createUser: (username) => {
    return new Promise((resolve, reject) => {
      const cleanUsername = username.trim();
      if (!cleanUsername) return reject(new Error('Username cannot be empty'));

      if (dbEngine === 'postgres') {
        pgPool.query(
          'INSERT INTO users (username) VALUES ($1) RETURNING *',
          [cleanUsername],
          (err, result) => {
            if (err) {
              if (err.message.includes('unique') || err.code === '23505') {
                reject(new Error('Username already exists'));
              } else {
                reject(err);
              }
            } else {
              resolve(result.rows[0]);
            }
          }
        );
      } else if (dbEngine === 'sqlite') {
        sqliteDb.run('INSERT INTO users (username) VALUES (?)', [cleanUsername], function(err) {
          if (err) {
            if (err.message.includes('UNIQUE')) {
              reject(new Error('Username already exists'));
            } else {
              reject(err);
            }
          } else {
            resolve({ id: this.lastID, username: cleanUsername, created_at: new Date().toISOString() });
          }
        });
      } else {
        const data = readJsonDb();
        const exists = data.users.find(u => u.username.toLowerCase() === cleanUsername.toLowerCase());
        if (exists) {
          return reject(new Error('Username already exists'));
        }
        const newUser = {
          id: data.users.length > 0 ? Math.max(...data.users.map(u => u.id)) + 1 : 1,
          username: cleanUsername,
          created_at: new Date().toISOString()
        };
        data.users.push(newUser);
        writeJsonDb(data);
        resolve(newUser);
      }
    });
  },

  getUserByUsername: (username) => {
    return new Promise((resolve, reject) => {
      if (dbEngine === 'postgres') {
        pgPool.query('SELECT * FROM users WHERE username = $1', [username.trim()], (err, result) => {
          if (err) reject(err);
          else resolve(result.rows[0] || null);
        });
      } else if (dbEngine === 'sqlite') {
        sqliteDb.get('SELECT * FROM users WHERE username = ?', [username.trim()], (err, row) => {
          if (err) reject(err);
          else resolve(row || null);
        });
      } else {
        const data = readJsonDb();
        const user = data.users.find(u => u.username.toLowerCase() === username.trim().toLowerCase());
        resolve(user || null);
      }
    });
  },

  // --- Workouts Operations ---
  getWorkouts: (userId) => {
    return new Promise((resolve, reject) => {
      const uId = parseInt(userId);
      if (dbEngine === 'postgres') {
        pgPool.query(
          'SELECT * FROM workouts WHERE user_id = $1 ORDER BY created_at DESC',
          [uId],
          (err, result) => {
            if (err) reject(err);
            else resolve(result.rows);
          }
        );
      } else if (dbEngine === 'sqlite') {
        sqliteDb.all('SELECT * FROM workouts WHERE user_id = ? ORDER BY created_at DESC', [uId], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      } else {
        const data = readJsonDb();
        const userWorkouts = data.workouts
          .filter(w => w.user_id === uId)
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        resolve(userWorkouts);
      }
    });
  },

  saveWorkout: (workout) => {
    return new Promise((resolve, reject) => {
      const { user_id, mode, reps, avg_score, duration_seconds } = workout;
      const uId = parseInt(user_id);
      
      if (dbEngine === 'postgres') {
        pgPool.query(
          'INSERT INTO workouts (user_id, mode, reps, avg_score, duration_seconds) VALUES ($1, $2, $3, $4, $5) RETURNING *',
          [uId, mode, reps, avg_score, duration_seconds],
          (err, result) => {
            if (err) reject(err);
            else resolve(result.rows[0]);
          }
        );
      } else if (dbEngine === 'sqlite') {
        sqliteDb.run(
          'INSERT INTO workouts (user_id, mode, reps, avg_score, duration_seconds) VALUES (?, ?, ?, ?, ?)',
          [uId, mode, reps, avg_score, duration_seconds],
          function(err) {
            if (err) reject(err);
            else {
              resolve({
                id: this.lastID,
                user_id: uId,
                mode,
                reps,
                avg_score,
                duration_seconds,
                created_at: new Date().toISOString()
              });
            }
          }
        );
      } else {
        const data = readJsonDb();
        const userExists = data.users.some(u => u.id === uId);
        if (!userExists) return reject(new Error('User does not exist'));

        const newWorkout = {
          id: data.workouts.length > 0 ? Math.max(...data.workouts.map(w => w.id)) + 1 : 1,
          user_id: uId,
          mode,
          reps: parseInt(reps),
          avg_score: parseFloat(avg_score),
          duration_seconds: parseInt(duration_seconds),
          created_at: new Date().toISOString()
        };
        data.workouts.push(newWorkout);
        writeJsonDb(data);
        resolve(newWorkout);
      }
    });
  },

  deleteWorkout: (id) => {
    return new Promise((resolve, reject) => {
      const wId = parseInt(id);
      if (dbEngine === 'postgres') {
        pgPool.query('DELETE FROM workouts WHERE id = $1', [wId], (err, result) => {
          if (err) reject(err);
          else resolve(result.rowCount > 0);
        });
      } else if (dbEngine === 'sqlite') {
        sqliteDb.run('DELETE FROM workouts WHERE id = ?', [wId], function(err) {
          if (err) reject(err);
          else resolve(this.changes > 0);
        });
      } else {
        const data = readJsonDb();
        const index = data.workouts.findIndex(w => w.id === wId);
        if (index !== -1) {
          data.workouts.splice(index, 1);
          writeJsonDb(data);
          resolve(true);
        } else {
          resolve(false);
        }
      }
    });
  },

  // --- Stats Aggregations ---
  getUserStats: (userId) => {
    return new Promise((resolve, reject) => {
      const uId = parseInt(userId);
      if (dbEngine === 'postgres') {
        const stats = {
          total_reps: 0,
          avg_score: 0,
          total_workouts: 0,
          by_mode: {
            twist: { reps: 0, count: 0, avg_score: 0 },
            squat: { reps: 0, count: 0, avg_score: 0 },
            sidebend: { reps: 0, count: 0, avg_score: 0 }
          },
          recent: []
        };

        pgPool.query(
          'SELECT SUM(reps) as total_reps, AVG(avg_score) as avg_score, COUNT(*) as total_workouts FROM workouts WHERE user_id = $1',
          [uId],
          (err, result) => {
            if (err) return reject(err);
            const overall = result.rows[0];
            if (overall && overall.total_workouts > 0) {
              stats.total_reps = parseInt(overall.total_reps) || 0;
              stats.avg_score = parseFloat(parseFloat(overall.avg_score || 0).toFixed(1));
              stats.total_workouts = parseInt(overall.total_workouts) || 0;
            }

            pgPool.query(
              'SELECT mode, SUM(reps) as reps, COUNT(*) as count, AVG(avg_score) as avg_score FROM workouts WHERE user_id = $1 GROUP BY mode',
              [uId],
              (err, modeResult) => {
                if (err) return reject(err);
                modeResult.rows.forEach(row => {
                  if (stats.by_mode[row.mode]) {
                    stats.by_mode[row.mode].reps = parseInt(row.reps) || 0;
                    stats.by_mode[row.mode].count = parseInt(row.count) || 0;
                    stats.by_mode[row.mode].avg_score = parseFloat(parseFloat(row.avg_score || 0).toFixed(1));
                  }
                });

                pgPool.query(
                  'SELECT * FROM (SELECT * FROM workouts WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10) sub ORDER BY created_at ASC',
                  [uId],
                  (err, recentResult) => {
                    if (err) return reject(err);
                    stats.recent = recentResult.rows;
                    resolve(stats);
                  }
                );
              }
            );
          }
        );

      } else if (dbEngine === 'sqlite') {
        const stats = {
          total_reps: 0,
          avg_score: 0,
          total_workouts: 0,
          by_mode: {
            twist: { reps: 0, count: 0, avg_score: 0 },
            squat: { reps: 0, count: 0, avg_score: 0 },
            sidebend: { reps: 0, count: 0, avg_score: 0 }
          },
          recent: []
        };

        sqliteDb.get(
          `SELECT SUM(reps) as total_reps, AVG(avg_score) as avg_score, COUNT(*) as total_workouts 
           FROM workouts WHERE user_id = ?`,
          [uId],
          (err, overall) => {
            if (err) return reject(err);

            if (overall && overall.total_workouts > 0) {
              stats.total_reps = overall.total_reps || 0;
              stats.avg_score = parseFloat((overall.avg_score || 0).toFixed(1));
              stats.total_workouts = overall.total_workouts || 0;
            }

            sqliteDb.all(
              `SELECT mode, SUM(reps) as reps, COUNT(*) as count, AVG(avg_score) as avg_score 
               FROM workouts WHERE user_id = ? GROUP BY mode`,
              [uId],
              (err, modeRows) => {
                if (err) return reject(err);

                modeRows.forEach(row => {
                  if (stats.by_mode[row.mode]) {
                    stats.by_mode[row.mode].reps = row.reps || 0;
                    stats.by_mode[row.mode].count = row.count || 0;
                    stats.by_mode[row.mode].avg_score = parseFloat((row.avg_score || 0).toFixed(1));
                  }
                });

                sqliteDb.all(
                  `SELECT * FROM (
                    SELECT * FROM workouts WHERE user_id = ? ORDER BY created_at DESC LIMIT 10
                  ) ORDER BY created_at ASC`,
                  [uId],
                  (err, recentRows) => {
                    if (err) return reject(err);
                    stats.recent = recentRows;
                    resolve(stats);
                  }
                );
              }
            );
          }
        );
      } else {
        const data = readJsonDb();
        const userWorkouts = data.workouts.filter(w => w.user_id === uId);
        
        const summary = {
          total_reps: userWorkouts.reduce((sum, w) => sum + w.reps, 0),
          avg_score: userWorkouts.length > 0 
            ? parseFloat((userWorkouts.reduce((sum, w) => sum + w.avg_score, 0) / userWorkouts.length).toFixed(1)) 
            : 0,
          total_workouts: userWorkouts.length,
          by_mode: {
            twist: { reps: 0, count: 0, avg_score: 0 },
            squat: { reps: 0, count: 0, avg_score: 0 },
            sidebend: { reps: 0, count: 0, avg_score: 0 }
          },
          recent: userWorkouts
            .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
            .slice(-10)
        };

        userWorkouts.forEach(w => {
          if (summary.by_mode[w.mode]) {
            summary.by_mode[w.mode].reps += w.reps;
            summary.by_mode[w.mode].count += 1;
            summary.by_mode[w.mode].avg_score += w.avg_score;
          }
        });

        Object.keys(summary.by_mode).forEach(mode => {
          const m = summary.by_mode[mode];
          if (m.count > 0) {
            m.avg_score = parseFloat((m.avg_score / m.count).toFixed(1));
          }
        });

        resolve(summary);
      }
    });
  }
};

module.exports = db;
