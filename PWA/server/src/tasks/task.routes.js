const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const authMiddleware = require('../utils/authMiddleware');
const requireRole = require('../utils/requireRole');
const { generatePrefillJson } = require('./task.prefill');

/**
 * @route   GET /api/tasks
 * @desc    Get tasks based on user role (admin sees all, inspector sees assigned)
 * @access  Private
 */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { role, id: userId } = req.user;

    let tasks;

    if (role === 'ADMIN') {
      // Admin sees all tasks
      tasks = await prisma.task.findMany({
        include: {
          assignedTo: { select: { id: true, name: true, email: true } },
          createdBy: { select: { id: true, name: true } },
          inspections: {
            select: {
              id: true,
              status: true,
              inspectionNumber: true,
              submittedAt: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      });
    } else if (role === 'INSPECTOR') {
      // Inspector sees only assigned tasks
      tasks = await prisma.task.findMany({
        where: { assignedToId: userId },
        include: {
          createdBy: { select: { id: true, name: true } },
          inspections: {
            select: {
              id: true,
              status: true,
              inspectionNumber: true,
              submittedAt: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      });
    }

    res.json({ success: true, data: tasks });
  } catch (error) {
    console.error('Error fetching tasks:', error.message);
    console.error('Stack:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch tasks', error: error.message });
  }
});

/**
 * @route   GET /api/tasks/:taskId
 * @desc    Get specific task details
 * @access  Private
 */
router.get('/:taskId', authMiddleware, async (req, res) => {
  try {
    const { taskId } = req.params;
    const { id: userId, role } = req.user;

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        assignedTo: { select: { id: true, name: true, email: true } },
        createdBy: { select: { id: true, name: true } },
        inspections: {
          include: {
            performedBy: { select: { id: true, name: true } },
            approvedBy: { select: { id: true, name: true } }
          }
        }
      }
    });

    if (!task) {
      return res.status(404).json({ success: false, message: 'Task not found' });
    }

    // Check access: inspector can only see assigned tasks
    if (role === 'INSPECTOR' && task.assignedToId !== userId) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    res.json({ success: true, data: task });
  } catch (error) {
    console.error('Error fetching task:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch task' });
  }
});

/**
 * @route   POST /api/tasks
 * @desc    Create new inspection task (admin only)
 * @access  Private (ADMIN)
 */
router.post('/', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    const { propertyId, clientName, clientEmail, clientPhone, propertyAddress, description, assignedToId } = req.body;
    const { id: adminId } = req.user;

    console.log('📝 Creating task - adminId:', adminId, 'assignedToId:', assignedToId);

    // Validation
    if (!propertyId || !clientName || !propertyAddress || !assignedToId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: propertyId, clientName, propertyAddress, assignedToId'
      });
    }

    // Verify admin user exists
    const adminUser = await prisma.user.findUnique({
      where: { id: adminId }
    });
    if (!adminUser) {
      console.error('❌ Admin user not found:', adminId);
      return res.status(401).json({
        success: false,
        message: 'Admin user not found. Please log out and log in again.'
      });
    }

    // Verify inspector exists
    const inspector = await prisma.user.findUnique({
      where: { id: assignedToId }
    });
    if (!inspector || inspector.role !== 'INSPECTOR') {
      return res.status(404).json({
        success: false,
        message: 'Inspector not found'
      });
    }

    // Check if task already exists for this property-inspector combination
    const existing = await prisma.task.findUnique({
      where: {
        propertyId_assignedToId: { propertyId, assignedToId }
      }
    });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'Task already exists for this property and inspector'
      });
    }

    // Generate prefill JSON
    const prefillJson = await generatePrefillJson({ propertyId, clientName, inspector: inspector.name });

    // Create task
    const task = await prisma.task.create({
      data: {
        propertyId,
        clientName,
        clientEmail: clientEmail || null,
        clientPhone: clientPhone || null,
        propertyAddress,
        description: description || null,
        assignedToId,
        createdById: adminId,
        prefillJson,
        status: 'PENDING'
      },
      include: {
        assignedTo: { select: { id: true, name: true, email: true } },
        createdBy: { select: { id: true, name: true } }
      }
    });

    res.status(201).json({
      success: true,
      message: 'Task created and assigned successfully',
      data: task
    });
  } catch (error) {
    console.error('Error creating task:', error);
    res.status(500).json({ success: false, message: 'Failed to create task' });
  }
});

/**
 * @route   PUT /api/tasks/:taskId
 * @desc    Update task (admin only)
 * @access  Private (ADMIN)
 */
router.put('/:taskId', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    const { taskId } = req.params;
    const { clientName, clientEmail, clientPhone, propertyAddress, description, status } = req.body;

    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) {
      return res.status(404).json({ success: false, message: 'Task not found' });
    }

    // Build update data
    const updateData = {};
    if (clientName) updateData.clientName = clientName;
    if (clientEmail !== undefined) updateData.clientEmail = clientEmail;
    if (clientPhone !== undefined) updateData.clientPhone = clientPhone;
    if (propertyAddress) updateData.propertyAddress = propertyAddress;
    if (description !== undefined) updateData.description = description;
    if (status) updateData.status = status;

    const updated = await prisma.task.update({
      where: { id: taskId },
      data: updateData,
      include: {
        assignedTo: { select: { id: true, name: true, email: true } },
        createdBy: { select: { id: true, name: true } }
      }
    });

    res.json({
      success: true,
      message: 'Task updated successfully',
      data: updated
    });
  } catch (error) {
    console.error('Error updating task:', error);
    res.status(500).json({ success: false, message: 'Failed to update task' });
  }
});

/**
 * @route   DELETE /api/tasks/:taskId
 * @desc    Delete task (admin only)
 * @access  Private (ADMIN)
 */
router.delete('/:taskId', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    const { taskId } = req.params;

    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) {
      return res.status(404).json({ success: false, message: 'Task not found' });
    }

    await prisma.task.delete({ where: { id: taskId } });

    res.json({ success: true, message: 'Task deleted successfully' });
  } catch (error) {
    console.error('Error deleting task:', error);
    res.status(500).json({ success: false, message: 'Failed to delete task' });
  }
});


/**
 * @route   POST /api/tasks/:taskId/inspections
 * @desc    Start or retrieve an inspection for a task
 * @access  Private (INSPECTOR)
 */
router.post('/:taskId/inspections', authMiddleware, requireRole('INSPECTOR'), async (req, res) => {
  try {
    const { taskId } = req.params;
    const { id: userId } = req.user;

    // 1. Find the task and verify ownership
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { inspections: true }
    });

    if (!task) {
      return res.status(404).json({ success: false, message: 'Task not found' });
    }
    if (task.assignedToId !== userId) {
      return res.status(403).json({ success: false, message: 'You are not assigned to this task' });
    }

    // 2. Check if an inspection already exists
    if (task.inspections && task.inspections.length > 0) {
      // Return the first existing inspection
      return res.json({ success: true, data: task.inspections[0], message: 'Existing inspection retrieved.' });
    }

    // 3. If not, create a new inspection
    const inspectionNumber = `INS-${Date.now()}`; // Simple unique number
    const { inspectionJson } = req.body; // Extract inspectionJson if provided

    const newInspection = await prisma.inspection.create({
      data: {
        task: { connect: { id: taskId } },
        performedBy: { connect: { id: userId } },
        status: 'IN_PROGRESS',
        inspectionNumber: inspectionNumber,
        inspectionJson: inspectionJson || undefined
      }
    });

    // 4. Update task status to 'IN_PROGRESS'
    await prisma.task.update({
      where: { id: taskId },
      data: { status: 'IN_PROGRESS' }
    });

    res.status(201).json({ success: true, data: newInspection, message: 'New inspection created.' });

  } catch (error) {
    console.error('Error starting inspection for task:', error);
    res.status(500).json({ success: false, message: 'Failed to start inspection' });
  }
});

module.exports = router;
