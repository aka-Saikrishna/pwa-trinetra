const prisma = require('../config/prisma');

exports.logAction = async (userId, action, details = {}) => {
  try {
    await prisma.auditLog.create({
      data: {
        userId,
        action,
        details
      }
    });
  } catch (error) {
    console.error('Failed to create audit log:', error);
  }
};
