const router = require('express').Router();
const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');
const bcrypt = require('bcryptjs');

router.post('/login', async (req, res) => {
  let { employeeId, password } = req.body;

  // Trim inputs to avoid whitespace issues
  if (employeeId) employeeId = employeeId.trim();
  if (password) password = password.trim();

  try {
    console.log(`[LOGIN ATTEMPT] ID: ${employeeId}`);

    // 1. Check DB for user
    // We assume 'employeeId' field from frontend sends the email or ID
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: employeeId },
          { id: employeeId }
        ]
      }
    });

    if (user) {
      console.log(`[LOGIN] User found in DB: ${user.email}`);
      const isPlaintextMatch = user.password === password;
      const isBcryptMatch = await bcrypt.compare(password, user.password).catch(() => false);
      if (isPlaintextMatch || isBcryptMatch) {
        const token = jwt.sign(
          { id: user.id, role: user.role, name: user.name },
          process.env.JWT_SECRET || 'secret',
          { expiresIn: '1d' }
        );
        return res.json({
          token,
          user: { id: user.id, name: user.name, role: user.role }
        });
      }
    }

    res.status(401).json({ message: 'Invalid credentials' });
  } catch (error) {
    console.error('Login Error:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

module.exports = router;
