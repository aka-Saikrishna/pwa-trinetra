const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const authMiddleware = require('../utils/authMiddleware');
const requireRole = require('../utils/requireRole');
const { validateInspectionJson, computeDerivedFields } = require('../tasks/task.prefill');
const { generatePDF } = require('../pdf/pdf.service');
const fs = require('fs');
const path = require('path');

/**
 * @route   GET /api/inspections
 * @desc    Get inspections based on user role
 * @access  Private
 */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { role, id: userId } = req.user;

    let inspections;

    if (role === 'ADMIN') {
      // Admin sees all inspections
      inspections = await prisma.inspection.findMany({
        include: {
          task: {
            select: {
              id: true,
              propertyId: true,
              clientName: true,
              propertyAddress: true,
              assignedToId: true
            }
          },
          performedBy: { select: { id: true, name: true, email: true } },
          approvedBy: { select: { id: true, name: true } }
        },
        orderBy: { createdAt: 'desc' }
      });
    } else if (role === 'INSPECTOR') {
      // Inspector sees only their inspections
      inspections = await prisma.inspection.findMany({
        where: { performedById: userId },
        include: {
          task: {
            select: {
              id: true,
              propertyId: true,
              clientName: true,
              propertyAddress: true
            }
          },
          approvedBy: { select: { id: true, name: true } }
        },
        orderBy: { createdAt: 'desc' }
      });
    }

    res.json({ success: true, data: inspections });
  } catch (error) {
    console.error('❌ Error fetching inspections:', error.message);
    console.error('Stack:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch inspections', error: error.message });
  }
});

/**
 * @route   GET /api/inspections/:inspectionId
 * @desc    Get specific inspection with prefill and submission data
 * @access  Private
 */
router.get('/:inspectionId', authMiddleware, async (req, res) => {
  try {
    const { inspectionId } = req.params;
    const { id: userId, role } = req.user;

    const inspection = await prisma.inspection.findUnique({
      where: { id: inspectionId },
      include: {
        task: true,
        performedBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
        auditLog: { orderBy: { createdAt: 'desc' } }
      }
    });

    if (!inspection) {
      return res.status(404).json({ success: false, message: 'Inspection not found' });
    }

    // Access control
    if (role === 'INSPECTOR' && inspection.performedById !== userId) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    res.json({ success: true, data: inspection });
  } catch (error) {
    console.error('Error fetching inspection:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch inspection' });
  }
});

/**
 * @route   GET /api/inspections/task/:taskId
 * @desc    Get or create inspection for a task
 * @access  Private (INSPECTOR - for assigned tasks)
 */
router.get('/task/:taskId', authMiddleware, async (req, res) => {
  try {
    const { taskId } = req.params;
    const { id: userId, role } = req.user;

    // Fetch task
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { assignedTo: true }
    });

    if (!task) {
      return res.status(404).json({ success: false, message: 'Task not found' });
    }

    // Access control - inspector can only see their assigned tasks
    if (role === 'INSPECTOR' && task.assignedToId !== userId) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    // Check for existing inspection
    let inspection = await prisma.inspection.findFirst({
      where: { taskId },
      include: {
        performedBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } }
      }
    });

    // If no inspection exists and this is inspector, create one
    if (!inspection && role === 'INSPECTOR') {
      const inspectionNumber = `INS-${Date.now()}`;
      inspection = await prisma.inspection.create({
        data: {
          inspectionNumber,
          taskId,
          performedById: userId,
          status: 'IN_PROGRESS',
          prefillJson: task.prefillJson,
          auditLog: {
            create: {
              action: 'CREATED',
              changedBy: userId
            }
          }
        },
        include: {
          performedBy: { select: { id: true, name: true } }
        }
      });
    }

    if (!inspection) {
      return res.status(404).json({ success: false, message: 'No inspection found' });
    }

    res.json({ success: true, data: inspection });
  } catch (error) {
    console.error('Error getting inspection for task:', error);
    res.status(500).json({ success: false, message: 'Failed to get inspection' });
  }
});

/**
 * @route   POST /api/inspections/:inspectionId/submit
 * @desc    Submit inspection with final JSON (locks editing)
 * @access  Private (INSPECTOR - only for own inspections)
 */
router.post('/:inspectionId/submit', authMiddleware, requireRole('INSPECTOR'), async (req, res) => {
  try {
    const { inspectionId } = req.params;
    const { id: userId } = req.user;
    const { inspectionJson } = req.body;

    // Fetch inspection
    const inspection = await prisma.inspection.findUnique({
      where: { id: inspectionId },
      include: { task: true }
    });

    if (!inspection) {
      return res.status(404).json({ success: false, message: 'Inspection not found' });
    }

    // Verify ownership
    if (inspection.performedById !== userId) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    // Verify status is IN_PROGRESS
    if (inspection.status !== 'IN_PROGRESS') {
      return res.status(400).json({
        success: false,
        message: `Cannot submit inspection with status ${inspection.status}`
      });
    }

    // Validate against prefill schema
    const validation = validateInspectionJson(inspectionJson, inspection.prefillJson);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validation.errors
      });
    }

    // Compute derived fields
    const derivedFields = computeDerivedFields(inspectionJson);

    // Update inspection with submitted data
    const submitted = await prisma.inspection.update({
      where: { id: inspectionId },
      data: {
        status: 'SUBMITTED',
        inspectionJson,
        overallScore: derivedFields.overall_score,
        severityCounts: derivedFields.severity_counts,
        submittedAt: new Date(),
        auditLog: {
          create: {
            action: 'SUBMITTED',
            changedFields: {
              status: 'IN_PROGRESS -> SUBMITTED',
              overall_score: derivedFields.overall_score
            },
            changedBy: userId
          }
        }
      },
      include: {
        task: true,
        performedBy: { select: { id: true, name: true } },
        auditLog: { orderBy: { createdAt: 'desc' } }
      }
    });

    // Update task status
    await prisma.task.update({
      where: { id: inspection.taskId },
      data: { status: 'COMPLETED' }
    });

    res.json({
      success: true,
      message: 'Inspection submitted successfully. You can still make edits. Mark as FINAL when done.',
      data: submitted
    });
  } catch (error) {
    console.error('Error submitting inspection:', error);
    res.status(500).json({ success: false, message: 'Failed to submit inspection' });
  }
});

/**
 * @route   POST /api/inspections/:inspectionId/mark-final
 * @desc    Mark inspection as FINAL (allows admin to generate PDF)
 * @access  Private (INSPECTOR - only for own inspections in SUBMITTED status)
 */
router.post('/:inspectionId/mark-final', authMiddleware, requireRole('INSPECTOR'), async (req, res) => {
  try {
    const { inspectionId } = req.params;
    const { id: userId } = req.user;

    const inspection = await prisma.inspection.findUnique({
      where: { id: inspectionId }
    });

    if (!inspection) {
      return res.status(404).json({ success: false, message: 'Inspection not found' });
    }

    // Verify ownership
    if (inspection.performedById !== userId) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    // Only mark as final if status is SUBMITTED
    if (inspection.status !== 'SUBMITTED') {
      return res.status(400).json({
        success: false,
        message: `Can only mark SUBMITTED inspections as FINAL. Current status: ${inspection.status}`
      });
    }

    // Mark as FINAL
    const finalized = await prisma.inspection.update({
      where: { id: inspectionId },
      data: {
        status: 'FINAL',
        auditLog: {
          create: {
            action: 'MARKED_FINAL',
            changedFields: {
              status: 'SUBMITTED -> FINAL'
            },
            changedBy: userId
          }
        }
      },
      include: {
        task: true,
        performedBy: { select: { id: true, name: true } }
      }
    });

    res.json({
      success: true,
      message: 'Inspection marked as FINAL. Admin can now generate PDF.',
      data: finalized
    });
  } catch (error) {
    console.error('Error marking inspection as final:', error);
    res.status(500).json({ success: false, message: 'Failed to mark inspection as final' });
  }
});

/**
 * @route   PATCH /api/inspections/:inspectionId
 * @desc    Update inspection data (if IN_PROGRESS or SUBMITTED)
 * @access  Private (INSPECTOR - only for own inspections)
 */
router.patch('/:inspectionId', authMiddleware, requireRole('INSPECTOR'), async (req, res) => {
  try {
    const { inspectionId } = req.params;
    const { id: userId } = req.user;
    const { inspectionJson } = req.body;

    const inspection = await prisma.inspection.findUnique({
      where: { id: inspectionId }
    });

    if (!inspection) {
      return res.status(404).json({ success: false, message: 'Inspection not found' });
    }

    // Verify ownership
    if (inspection.performedById !== userId) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    // Allow updates if status is IN_PROGRESS or SUBMITTED (inspector can still edit)
    if (inspection.status !== 'IN_PROGRESS' && inspection.status !== 'SUBMITTED') {
      return res.status(400).json({
        success: false,
        message: `Cannot update inspection with status ${inspection.status}. Only IN_PROGRESS or SUBMITTED inspections can be edited.`
      });
    }

    // Update with new data
    const updated = await prisma.inspection.update({
      where: { id: inspectionId },
      data: {
        inspectionJson,
        auditLog: {
          create: {
            action: 'MODIFIED',
            changedBy: userId
          }
        }
      },
      include: {
        task: true,
        performedBy: { select: { id: true, name: true } }
      }
    });

    res.json({
      success: true,
      message: 'Inspection updated successfully',
      data: updated
    });
  } catch (error) {
    console.error('Error updating inspection:', error);
    res.status(500).json({ success: false, message: 'Failed to update inspection' });
  }
});

/**
 * @route   POST /api/inspections/:inspectionId/approve
 * @desc    Approve inspection (admin only)
 * @access  Private (ADMIN)
 */
router.post('/:inspectionId/approve', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    const { inspectionId } = req.params;
    const { id: adminId } = req.user;

    const inspection = await prisma.inspection.findUnique({
      where: { id: inspectionId }
    });

    if (!inspection) {
      return res.status(404).json({ success: false, message: 'Inspection not found' });
    }

    // Only approve SUBMITTED inspections
    if (inspection.status !== 'SUBMITTED') {
      return res.status(400).json({
        success: false,
        message: `Can only approve SUBMITTED inspections. Current status: ${inspection.status}`
      });
    }

    const approved = await prisma.inspection.update({
      where: { id: inspectionId },
      data: {
        status: 'COMPLETED',
        approvedById: adminId,
        approvedAt: new Date(),
        auditLog: {
          create: {
            action: 'APPROVED',
            changedBy: adminId
          }
        }
      },
      include: {
        task: true,
        performedBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } }
      }
    });

    res.json({
      success: true,
      message: 'Inspection approved successfully',
      data: approved
    });
  } catch (error) {
    console.error('Error approving inspection:', error);
    res.status(500).json({ success: false, message: 'Failed to approve inspection' });
  }
});

/**
 * @route   POST /api/inspections/:inspectionId/reject
 * @desc    Reject inspection and allow re-submission (admin only)
 * @access  Private (ADMIN)
 */
router.post('/:inspectionId/reject', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    const { inspectionId } = req.params;
    const { id: adminId } = req.user;
    const { reason } = req.body;

    const inspection = await prisma.inspection.findUnique({
      where: { id: inspectionId }
    });

    if (!inspection) {
      return res.status(404).json({ success: false, message: 'Inspection not found' });
    }

    const rejected = await prisma.inspection.update({
      where: { id: inspectionId },
      data: {
        status: 'REJECTED',
        auditLog: {
          create: {
            action: 'REJECTED',
            changedFields: { rejection_reason: reason },
            changedBy: adminId
          }
        }
      },
      include: {
        task: true,
        performedBy: { select: { id: true, name: true } }
      }
    });

    res.json({
      success: true,
      message: 'Inspection rejected. Inspector can re-submit.',
      data: rejected
    });
  } catch (error) {
    console.error('Error rejecting inspection:', error);
    res.status(500).json({ success: false, message: 'Failed to reject inspection' });
  }
});

/**
 * @route   POST /api/inspections/:inspectionId/report
 * @desc    Generate PDF Report from inspection data
 * @access  Private (ADMIN or INSPECTOR)
 */
router.post('/:inspectionId/report', authMiddleware, async (req, res) => {
  try {
    const { inspectionId } = req.params;
    const { id: userId, role } = req.user;

    const inspection = await prisma.inspection.findUnique({
      where: { id: inspectionId },
      include: {
        task: true,
        performedBy: { select: { id: true, name: true, email: true } }
      }
    });

    if (!inspection) {
      return res.status(404).json({ success: false, message: 'Inspection not found' });
    }

    // Access Control: Admin or the Inspector who performed it
    if (role !== 'ADMIN' && inspection.performedById !== userId) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    // Status check - allow SUBMITTED, FINAL, REPORT_GENERATED, COMPLETED
    const allowedStatuses = ['SUBMITTED', 'FINAL', 'REPORT_GENERATED', 'COMPLETED'];
    if (!allowedStatuses.includes(inspection.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot generate report for status: ${inspection.status}. Must be SUBMITTED or FINAL.`
      });
    }

    // Prepare data for PDF service
    // Merge inspection DB fields with JSON data to ensure templates have all variables
    const json = inspection.inspectionJson || {};
    const reportData = {
      ...json,
      inspection_id: inspection.inspectionNumber,
      client_name: inspection.task?.clientName || json.client_name,
      property_address: inspection.task?.propertyAddress || json.property_address,
      performedBy: inspection.performedBy, // Pass full object
      inspectorName: inspection.performedBy?.name || json.inspector_name,
      inspection_date: inspection.submittedAt || inspection.updatedAt,
      overall_score: inspection.overallScore,
      severity_counts: inspection.severityCounts,
      metadata: {
        ...json.metadata,
        client_name: inspection.task?.clientName,
        property_address: inspection.task?.propertyAddress
      }
    };

    // Generate PDF
    // We define path relative to server root: uploads/pdfs/<number>.pdf
    const filename = `${inspection.inspectionNumber}.pdf`;
    const pdfPath = path.resolve(__dirname, '../../uploads/pdfs', filename);
    const pdfUrl = `/uploads/pdfs/${filename}`;

    // Ensure directory exists
    const pdfDir = path.dirname(pdfPath);
    if (!fs.existsSync(pdfDir)) {
      fs.mkdirSync(pdfDir, { recursive: true });
    }

    await generatePDF(reportData, pdfPath);

    // Update inspection record
    await prisma.inspection.update({
      where: { id: inspectionId },
      data: {
        pdfPath: pdfPath,
        pdfUrl: pdfUrl,
        auditLog: {
          create: {
            action: 'REPORT_GENERATED',
            changedBy: userId
          }
        }
      }
    });

    // Send the file directly to the client
    if (fs.existsSync(pdfPath)) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.sendFile(pdfPath);
    } else {
      throw new Error('PDF file was not created on disk');
    }

  } catch (error) {
    console.error('Error generating report:', error);
    res.status(500).json({ success: false, message: 'Failed to generate report', error: error.message });
  }
});

module.exports = router;
