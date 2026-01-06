require('dotenv').config();
const app = require('./app');
const prisma = require('./config/prisma');
const bcrypt = require('bcryptjs');

const PORT = process.env.PORT || 5001;

const server = app.listen(PORT, () => {
  console.log('House Inspection Backend running on port', PORT);
  ensureAdminUser().catch(err => console.error('Admin bootstrap error:', err));
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err, promise) => {
  console.log(`Error: ${err.message}`);
  console.error(err);
  // Close server & exit process
  // server.close(() => process.exit(1));
});

process.on('uncaughtException', (err) => {
  console.log(`Uncaught Exception: ${err.message}`);
  console.error(err);
});

async function ensureAdminUser() {
  try {
    const existingAdmin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
    if (existingAdmin) {
      return; 
    }
    const hash = await bcrypt.hash('admin123', 10);
    const admin = await prisma.user.create({
      data: {
        id: 'admin',
        email: 'admin@example.com',
        password: hash,
        name: 'Administrator',
        role: 'ADMIN'
      }
    });
    console.log('[Bootstrap] Admin user created:', admin.email);
  } catch (e) {
    console.error('[Bootstrap] Failed to ensure admin user:', e.message);
  }
}
