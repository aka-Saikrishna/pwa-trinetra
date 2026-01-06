const express = require('express');
const path = require('path');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use('/uploads', express.static('uploads'));
// Serve Frontend Static Files
const clientPath = path.resolve(__dirname, '../../client');
app.use(express.static(clientPath));

// API Routes
app.use('/api/auth', require('./auth/auth.routes'));
app.use('/api/inspectors', require('./inspectors/inspector.routes'));
app.use('/api/tasks', require('./tasks/task.routes'));
app.use('/api/inspections', require('./inspections/inspection.workflow'));
app.use('/api/pdf', require('./pdf/pdf.routes'));
app.use('/api/users', require('./users/user.routes'));


// Fallback to app.html for SPA-like experience or root access
app.get('/', (req, res) => {
  res.sendFile(path.join(clientPath, 'app.html'));
});

module.exports = app;