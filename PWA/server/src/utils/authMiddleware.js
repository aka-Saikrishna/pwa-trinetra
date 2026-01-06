const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
  const authHeader = req.headers.authorization;
  console.log('🔐 Auth middleware - Authorization header:', authHeader ? 'Present' : 'Missing');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.error('❌ No valid Bearer token');
    return res.status(401).json({ message: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];

  try {
    // Keep fallback in sync with auth.routes.js signing default to avoid invalid token errors when env var is missing.
    const secret = process.env.JWT_SECRET || 'secret';
    const decoded = jwt.verify(token, secret);
    console.log('✅ Token verified for user:', decoded.id);
    req.user = decoded;
    next();
  } catch (error) {
    console.error('❌ Token verification failed:', error.message);
    return res.status(401).json({ message: 'Invalid token' });
  }
};
