const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const bcrypt = require('bcryptjs');
const authMiddleware = require('../utils/authMiddleware');
const requireRole = require('../utils/requireRole');

/**
 * @route   GET /api/inspectors
 * @desc    Get all inspectors (admin only)
 * @access  Private (ADMIN)
 */
router.get('/', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    const inspectors = await prisma.user.findMany({
      where: { role: 'INSPECTOR' },
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
        _count: {
          select: { assignedTasks: true }
        }
      }
    });
    res.json({
      success: true,
      data: inspectors
    });
  } catch (error) {
    console.error('❌ Error fetching inspectors:', error.message);
    console.error('Stack:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch inspectors', error: error.message });
  }
});

/**
 * @route   GET /api/inspectors/search
 * @desc    Search inspectors by name or email (admin only)
 * @access  Private (ADMIN)
 */
router.get('/search', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    const { q } = req.query;

    if (!q || q.length < 2) {
      return res.json({ success: true, data: [] });
    }

    const inspectors = await prisma.user.findMany({
      where: {
        role: 'INSPECTOR',
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } }
        ]
      },
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true
      },
      take: 10
    });

    res.json({ success: true, data: inspectors });
  } catch (error) {
    console.error('Error searching inspectors:', error);
    res.status(500).json({ success: false, message: 'Search failed' });
  }
});

/**
 * @route   GET /api/inspectors/:id
 * @desc    Get single inspector by ID (admin only)
 * @access  Private (ADMIN)
 */
router.get('/:id', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    const { id } = req.params;

    const inspector = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
        _count: {
          select: { assignedTasks: true }
        }
      }
    });

    if (!inspector || inspector.role !== 'INSPECTOR') {
      return res.status(404).json({
        success: false,
        message: 'Inspector not found'
      });
    }

    res.json({ success: true, data: inspector });
  } catch (error) {
    console.error('Error fetching inspector:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch inspector' });
  }
});

/**
 * @route   POST /api/inspectors
 * @desc    Create new inspector (admin only)
 * @access  Private (ADMIN)
 */
router.post('/', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Validation
    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, and password are required'
      });
    }

    // Check if inspector already exists
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'Inspector with this email already exists'
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Generate ID
    const inspectorId = `INP-${Date.now()}`;

    // Create inspector
    const inspector = await prisma.user.create({
      data: {
        id: inspectorId,
        name,
        email,
        password: hashedPassword,
        role: 'INSPECTOR'
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true
      }
    });

    res.status(201).json({
      success: true,
      message: 'Inspector created successfully',
      data: inspector
    });
  } catch (error) {
    console.error('Error creating inspector:', error);
    res.status(500).json({ success: false, message: 'Failed to create inspector' });
  }
});

/**
 * @route   PUT /api/inspectors/:id
 * @desc    Update inspector details (admin only)
 * @access  Private (ADMIN)
 */
router.put('/:id', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, password } = req.body;

    // Check if inspector exists
    const inspector = await prisma.user.findUnique({ where: { id } });
    if (!inspector || inspector.role !== 'INSPECTOR') {
      return res.status(404).json({
        success: false,
        message: 'Inspector not found'
      });
    }

    // Build update data
    const updateData = {};
    if (name) updateData.name = name;
    if (email) updateData.email = email;
    if (password) updateData.password = await bcrypt.hash(password, 10);

    const updated = await prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        updatedAt: true
      }
    });

    res.json({
      success: true,
      message: 'Inspector updated successfully',
      data: updated
    });
  } catch (error) {
    console.error('Error updating inspector:', error);
    res.status(500).json({ success: false, message: 'Failed to update inspector' });
  }
});

/**
 * @route   DELETE /api/inspectors/:id
 * @desc    Delete inspector (admin only)
 * @access  Private (ADMIN)
 */
router.delete('/:id', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    const { id } = req.params;

    // Check if inspector exists
    const inspector = await prisma.user.findUnique({ where: { id } });
    if (!inspector || inspector.role !== 'INSPECTOR') {
      return res.status(404).json({
        success: false,
        message: 'Inspector not found'
      });
    }

    // Delete inspector (will cascade delete tasks and inspections)
    await prisma.user.delete({ where: { id } });

    res.json({
      success: true,
      message: 'Inspector deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting inspector:', error);
    res.status(500).json({ success: false, message: 'Failed to delete inspector' });
  }
});

module.exports = router;
