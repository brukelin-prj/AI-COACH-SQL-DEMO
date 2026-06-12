const express = require('express');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware for parsing JSON requests
app.use(express.json());

// Basic Authentication Middleware
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin Access"');
    return res.status(401).send('Authentication required');
  }
  const auth = Buffer.from(authHeader.split(' ')[1], 'base64').toString().split(':');
  const user = auth[0];
  const pass = auth[1];
  if (user === 'admin' && pass === 'admin888') {
    next();
  } else {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin Access"');
    return res.status(401).send('Authentication failed');
  }
};

// Route to protect admin.html
app.get('/admin.html', authMiddleware, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Serve static frontend files from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Log database status
console.log(`Database engine loaded. Fallback JSON mode active: ${db.isUsingFallback()}`);

// --- REST API ROUTES ---

const isAlphanumeric = (str) => /^[a-zA-Z0-9]+$/.test(str);

// 1. Users endpoints
app.get('/api/users', async (req, res) => {
  try {
    const users = await db.getUsers();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users/login', async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }
    if (!isAlphanumeric(username)) {
      return res.status(400).json({ error: 'Username must be alphanumeric (英數字)' });
    }
    const user = await db.getUserByUsername(username);
    if (user) {
      res.json({ exists: true, user });
    } else {
      res.json({ exists: false });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users', async (req, res) => {
  try {
    const { username, age, height, weight } = req.body;
    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }
    if (!isAlphanumeric(username)) {
      return res.status(400).json({ error: 'Username must be alphanumeric (英數字)' });
    }
    if (age !== undefined && age !== '' && isNaN(parseInt(age))) {
      return res.status(400).json({ error: 'Age must be a number' });
    }
    if (height !== undefined && height !== '' && isNaN(parseFloat(height))) {
      return res.status(400).json({ error: 'Height must be a number' });
    }
    if (weight !== undefined && weight !== '' && isNaN(parseFloat(weight))) {
      return res.status(400).json({ error: 'Weight must be a number' });
    }
    const newUser = await db.createUser(username, age, height, weight);
    res.status(201).json(newUser);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 2. Workouts endpoints
app.get('/api/workouts', async (req, res) => {
  try {
    const { user_id } = req.query;
    if (!user_id) {
      return res.status(400).json({ error: 'User ID parameter is required' });
    }
    const workouts = await db.getWorkouts(user_id);
    res.json(workouts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/workouts', async (req, res) => {
  try {
    const { user_id, mode, reps, avg_score, duration_seconds } = req.body;
    if (!user_id || !mode || reps === undefined || avg_score === undefined || duration_seconds === undefined) {
      return res.status(400).json({ error: 'Missing required workout session details' });
    }
    const newWorkout = await db.saveWorkout({ user_id, mode, reps, avg_score, duration_seconds });
    res.status(201).json(newWorkout);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/workouts/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await db.deleteWorkout(id);
    if (deleted) {
      res.json({ success: true, message: 'Workout session log deleted successfully' });
    } else {
      res.status(404).json({ error: 'Workout session log not found' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. User statistics summary and trend endpoint
app.get('/api/stats', async (req, res) => {
  try {
    const { user_id } = req.query;
    if (!user_id) {
      return res.status(400).json({ error: 'User ID parameter is required' });
    }
    const stats = await db.getUserStats(user_id);
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Admin summary endpoint
app.get('/api/admin/summary', authMiddleware, async (req, res) => {
  try {
    const summary = await db.getAdminSummary();
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start listening
app.listen(PORT, () => {
  console.log(`AI Fitness Coach Server is running at http://localhost:${PORT}`);
});
