const router = require('express').Router();
const prisma = require('../config/prisma');
const authMiddleware = require('../utils/authMiddleware');

// List all users (ADMIN only) - used by admin dashboard
router.get('/', authMiddleware, async (req, res) => {
  if (req.user.role !== 'ADMIN') return res.sendStatus(403);

  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true }
  });

  res.json(users);
});

// Create user (ADMIN only) - used by admin dashboard "Create New User" form
router.post('/', authMiddleware, async (req, res) => {
  if (req.user.role !== 'ADMIN') return res.sendStatus(403);

  try {
    const { id, name, email, password, role } = req.body;
    const user = await prisma.user.create({
      data: { id, name, email, password, role }
    });
    res.json(user);
  } catch (e) {
    console.error(e);
    res.status(400).json({ message: 'Failed to create user' });
  }
});

// Existing helper route to fetch inspectors by role (kept for compatibility)
router.get('/inspectors', authMiddleware, async (req, res) => {
  if (req.user.role !== 'ADMIN') return res.sendStatus(403);

  const users = await prisma.user.findMany({
    where: { role: 'INSPECTOR' },
    select: { id: true, name: true }
  });
  const mapped = users.map(u => ({ ...u, employeeId: u.id }));
  res.json(mapped);
});

module.exports = router;
