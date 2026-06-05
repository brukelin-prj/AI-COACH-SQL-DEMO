const express = require('express');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware for parsing JSON requests
app.use(express.json());

// Serve static frontend files from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Log database status
console.log(`Database engine loaded. Fallback JSON mode active: ${db.isUsingFallback()}`);

// --- REST API ROUTES ---

// 1. Users endpoints
app.get('/api/users', async (req, res) => {
  try {
    const users = await db.getUsers();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users', async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }
    const newUser = await db.createUser(username);
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

app.delete('/api/workouts/:id', async (req, res) => {
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

// Start listening
app.listen(PORT, () => {
  console.log(`AI Fitness Coach Server is running at http://localhost:${PORT}`);
});
