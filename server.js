const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// BC Ferries API base URL
const BC_FERRIES_API = 'https://www.bcferriesapi.ca';

// API Routes
app.get('/api/capacity', async (req, res) => {
  try {
    const response = await fetch(`${BC_FERRIES_API}/api/`);
    if (!response.ok) {
      throw new Error(`BC Ferries API responded with status: ${response.status}`);
    }
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Error fetching capacity data:', error);
    res.status(500).json({
      error: 'Failed to fetch ferry data',
      message: error.message
    });
  }
});

// Get specific route data
app.get('/api/route/:from/:to', async (req, res) => {
  try {
    const { from, to } = req.params;
    const response = await fetch(`${BC_FERRIES_API}/api/`);
    if (!response.ok) {
      throw new Error(`BC Ferries API responded with status: ${response.status}`);
    }
    const data = await response.json();

    // Filter for specific route
    const route = data.routes.find(r =>
      r.fromTerminal === from.toUpperCase() &&
      r.toTerminal === to.toUpperCase()
    );

    if (route) {
      res.json(route);
    } else {
      res.status(404).json({ error: 'Route not found' });
    }
  } catch (error) {
    console.error('Error fetching route data:', error);
    res.status(500).json({
      error: 'Failed to fetch route data',
      message: error.message
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`BC Ferry Tracker server running on port ${PORT}`);
  console.log(`Visit http://localhost:${PORT} to view the application`);
});
