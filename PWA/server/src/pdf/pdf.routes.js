const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const authMiddleware = require('../utils/authMiddleware');
const requireRole = require('../utils/requireRole');
const { generatePDF } = require('./pdf.service');
const fs = require('fs');
const path = require('path');

/**
 * @route   POST /api/pdf/generate
 * @desc    Generate PDF from submitted inspection JSON (admin only)
 * @access  Private (ADMIN)
 * 
 * Request body:
 * {
 *   "inspectionId": "string",
 *   "clientName": "string",
 *   "clientAddress": "string", 
 *   "verifierName": "string"
 * }
 */
router.post('/generate', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    const { inspectionId, clientName, clientAddress, verifierName } = req.body;

    // Validation
    if (!inspectionId) {
      return res.status(400).json({
        success: false,
        message: 'inspectionId is required'
      });
    }

    // Fetch inspection
    const inspection = await prisma.inspection.findUnique({
      where: { id: inspectionId },
      include: {
        task: true,
        performedBy: { select: { id: true, name: true } }
      }
    });

    if (!inspection) {
      return res.status(404).json({
        success: false,
        message: 'Inspection not found'
      });
    }

    // ✅ CRITICAL: Only allow PDF generation if status is FINAL or COMPLETED
    if (inspection.status !== 'FINAL' && inspection.status !== 'COMPLETED') {
      return res.status(403).json({
        success: false,
        message: `Cannot generate PDF for inspection with status "${inspection.status}". Inspection must be marked as FINAL by inspector before PDF generation.`,
        current_status: inspection.status,
        allowed_statuses: ['FINAL', 'COMPLETED']
      });
    }

    // Verify inspection has been submitted
    if (!inspection.inspectionJson) {
      return res.status(400).json({
        success: false,
        message: 'Inspection data not available. Ensure inspection has been submitted.'
      });
    }

    // Prepare data for PDF generation
    const reportData = {
      inspection_id: inspection.inspectionNumber,
      client_name: clientName || inspection.task.clientName,
      property_address: clientAddress || inspection.task.propertyAddress,
      verifier_name: verifierName || inspection.performedBy.name,
      inspection_date: inspection.submittedAt ? new Date(inspection.submittedAt).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
      overall_score: inspection.overallScore,
      severity_counts: inspection.severityCounts,
      inspection_data: inspection.inspectionJson
    };

    // Generate PDF
    const pdfPath = path.join(__dirname, '../../uploads/pdfs', `${inspection.inspectionNumber}.pdf`);
    
    // Create directory if it doesn't exist
    const pdfDir = path.dirname(pdfPath);
    if (!fs.existsSync(pdfDir)) {
      fs.mkdirSync(pdfDir, { recursive: true });
    }

    // Generate PDF using existing service
    await generatePDF(reportData, pdfPath);

    // Update inspection with PDF path
    const updated = await prisma.inspection.update({
      where: { id: inspectionId },
      data: {
        pdfPath: pdfPath,
        pdfUrl: `/uploads/pdfs/${inspection.inspectionNumber}.pdf`,
        auditLog: {
          create: {
            action: 'PDF_GENERATED',
            changedBy: req.user.id
          }
        }
      },
      include: {
        task: true,
        performedBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } }
      }
    });

    // Return PDF file
    if (fs.existsSync(pdfPath)) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${inspection.inspectionNumber}.pdf"`);
      res.sendFile(pdfPath);
    } else {
      res.json({
        success: true,
        message: 'PDF generation initiated',
        data: updated
      });
    }
  } catch (error) {
    console.error('Error generating PDF:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate PDF',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/pdf/download/:inspectionId
 * @desc    Download previously generated PDF
 * @access  Private
 */
router.get('/download/:inspectionId', authMiddleware, async (req, res) => {
  try {
    const { inspectionId } = req.params;

    const inspection = await prisma.inspection.findUnique({
      where: { id: inspectionId }
    });

    if (!inspection) {
      return res.status(404).json({ success: false, message: 'Inspection not found' });
    }

    if (!inspection.pdfPath || !fs.existsSync(inspection.pdfPath)) {
      return res.status(404).json({
        success: false,
        message: 'PDF not found. Please generate it first.'
      });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${inspection.inspectionNumber}.pdf"`);
    res.sendFile(inspection.pdfPath);
  } catch (error) {
    console.error('Error downloading PDF:', error);
    res.status(500).json({ success: false, message: 'Failed to download PDF' });
  }
});

/**
 * @route   DELETE /api/pdf/:inspectionId
 * @desc    Delete PDF (admin only)
 * @access  Private (ADMIN)
 */
router.delete('/:inspectionId', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    const { inspectionId } = req.params;

    const inspection = await prisma.inspection.findUnique({
      where: { id: inspectionId }
    });

    if (!inspection) {
      return res.status(404).json({ success: false, message: 'Inspection not found' });
    }

    // Delete PDF file if exists
    if (inspection.pdfPath && fs.existsSync(inspection.pdfPath)) {
      fs.unlinkSync(inspection.pdfPath);
    }

    // Update database
    const updated = await prisma.inspection.update({
      where: { id: inspectionId },
      data: {
        pdfPath: null,
        pdfUrl: null,
        auditLog: {
          create: {
            action: 'PDF_DELETED',
            changedBy: req.user.id
          }
        }
      }
    });

    res.json({
      success: true,
      message: 'PDF deleted successfully',
      data: updated
    });
  } catch (error) {
    console.error('Error deleting PDF:', error);
    res.status(500).json({ success: false, message: 'Failed to delete PDF' });
  }
});

module.exports = router;
