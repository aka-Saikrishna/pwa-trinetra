const prisma = require('../config/prisma');
const { generatePrefill } = require('./inspection.prefill');
const { validateInspection } = require('./inspection.validate');
const { computeDerived } = require('./inspection.compute');
const { generatePdf } = require('../pdf/pdf.service');

exports.createInspection = async (req, res) => {
  if (req.user.role !== 'ADMIN') return res.sendStatus(403);

  const { inspectorId, technician, metadata } = req.body;
  
  let finalInspectorId = inspectorId;
  
  // If inspectorId provided, validate it exists
  if (inspectorId) {
    const inspector = await prisma.user.findUnique({
      where: { id: inspectorId },
      select: { id: true, role: true }
    });
    
    if (!inspector) {
      return res.status(400).json({ message: `Inspector with ID "${inspectorId}" not found in database` });
    }
    
    if (inspector.role !== 'INSPECTOR') {
      return res.status(400).json({ message: `User "${inspectorId}" is not an INSPECTOR` });
    }
  } else {
    // No inspectorId provided - find first available inspector
    const firstInspector = await prisma.user.findFirst({
      where: { role: 'INSPECTOR' },
      select: { id: true }
    });
    
    if (!firstInspector) {
      return res.status(400).json({ 
        message: 'No inspectors found in database. Please create at least one INSPECTOR user before creating inspections.' 
      });
    }
    
    finalInspectorId = firstInspector.id;
    console.log(`[AUTO-ASSIGN] No inspector specified, assigning to: ${finalInspectorId}`);
  }
  
  // Validate creator exists in database
  const creator = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { id: true }
  });
  
  if (!creator) {
    return res.status(400).json({ 
      message: `Your user account (ID: "${req.user.id}") does not exist in the database. Please log in with a valid database user account.` 
    });
  }
  
  const json = await generatePrefill({ technician, metadata });

  // Allow metadata override after prefill
  if (metadata) {
    json.metadata = { ...json.metadata, ...metadata };
  }

  try {
    const inspection = await prisma.inspection.create({
      data: {
        id: json.inspection_id,
        status: 'DRAFT',
        inspectionJson: json,
        assignedToId: finalInspectorId, // Always use valid inspector ID
        createdById: req.user.id
      }
    });

    res.json(inspection);
  } catch (error) {
    console.error('Create inspection error:', error);
    if (error.code === 'P2003') {
      // Check which foreign key failed
      const failedField = error.meta?.field_name || 'unknown';
      if (failedField.includes('assignedToId')) {
        return res.status(400).json({ 
          message: `Inspector ID "${finalInspectorId}" does not exist in database. Please ensure the inspector user exists.` 
        });
      } else if (failedField.includes('createdById')) {
        return res.status(400).json({ 
          message: `Creator ID "${req.user.id}" does not exist in database. Please ensure you are logged in with a valid user account.` 
        });
      }
      return res.status(400).json({ 
        message: 'Foreign key constraint failed. Please ensure all user IDs exist in the database.' 
      });
    }
    res.status(500).json({ message: 'Failed to create inspection', error: error.message });
  }
};

exports.getAssignedInspections = async (req, res) => {
  if (req.user.role !== 'INSPECTOR') return res.sendStatus(403);

  const inspections = await prisma.inspection.findMany({
    where: { assignedToId: req.user.id },
    select: {
      id: true,
      status: true,
      updatedAt: true,
      inspectionJson: true
    }
  });

  // Extract metadata for list display
  const mapped = inspections.map(i => ({
    id: i.id,
    status: i.status,
    date: i.updatedAt,
    address: i.inspectionJson?.metadata?.property_address || 'Unknown Address',
    client: i.inspectionJson?.metadata?.client_name || 'Unknown Client',
    inspectionJson: i.inspectionJson
  }));

  res.json(mapped);
};

exports.getAllInspections = async (req, res) => {
  if (req.user.role !== 'ADMIN') return res.sendStatus(403);

  const inspections = await prisma.inspection.findMany({
    include: {
      assignedTo: true,
      task: {
        select: {
          clientName: true,
          propertyAddress: true
        }
      },
      performedBy: {
        select: {
          name: true
        }
      }
    },
    orderBy: { updatedAt: 'desc' }
  });

  // Return full inspection objects for admin (they need all data for edit/delete)
  const mapped = inspections.map(i => ({
    id: i.id,
    status: i.status,
    date: i.updatedAt,
    updatedAt: i.updatedAt,
    inspector: i.assignedTo?.name || 'Unassigned',
    assignedTo: i.assignedTo,
    address: i.inspectionJson?.metadata?.property_address || 'Unknown Address',
    client: i.inspectionJson?.metadata?.client_name || 'Unknown Client',
    inspectionJson: i.inspectionJson,
    reportPath: i.reportPath
  }));

  res.json(mapped);
};

// Aggregated stats for admin dashboard
exports.getInspectionStats = async (req, res) => {
  if (req.user.role !== 'ADMIN') return res.sendStatus(403);

  const inspections = await prisma.inspection.findMany({
    include: { assignedTo: true }
  });

  const total = inspections.length;

  // Count by status
  const statusCounts = {};
  inspections.forEach(i => {
    statusCounts[i.status] = (statusCounts[i.status] || 0) + 1;
  });

  const byStatus = Object.entries(statusCounts).map(([status, count]) => ({
    status,
    count
  }));

  // Count by inspector
  const inspectorCounts = {};
  inspections.forEach(i => {
    const name = i.assignedTo?.name || 'Unassigned';
    inspectorCounts[name] = (inspectorCounts[name] || 0) + 1;
  });

  const byInspector = Object.entries(inspectorCounts).map(([name, count]) => ({
    name,
    count
  }));

  res.json({ total, byStatus, byInspector });
};

exports.getInspection = async (req, res) => {
  const inspection = await prisma.inspection.findUnique({
    where: { id: req.params.id }
  });

  if (!inspection) return res.sendStatus(404);

  // Only allow inspectors to view their assigned inspections; admins bypass this check.
  if (req.user.role === 'INSPECTOR' && inspection.assignedToId !== req.user.id) {
    return res.sendStatus(403);
  }

  res.json(inspection);
};

// Update inspection (ADMIN can update any, INSPECTOR can only update assigned)
exports.updateInspection = async (req, res) => {
  const inspection = await prisma.inspection.findUnique({
    where: { id: req.params.id }
  });

  if (!inspection) return res.sendStatus(404);

  // INSPECTOR can only update their assigned inspections
  if (req.user.role === 'INSPECTOR' && inspection.assignedToId !== req.user.id) {
    return res.sendStatus(403);
  }

  // Validate JSON if provided
  if (req.body.inspectionJson) {
    validateInspection(req.body.inspectionJson);
    
    // If status is being updated, compute derived fields
    if (req.body.inspectionJson.audit?.status === 'SUBMITTED') {
      computeDerived(req.body.inspectionJson);
    }
  }

  // Prevent inspectors from updating submitted inspections
  if (req.user.role === 'INSPECTOR' && (inspection.status === 'SUBMITTED' || inspection.status === 'REPORT_GENERATED')) {
    return res.status(400).json({ 
      message: 'Cannot update inspection after submission. Current status: ' + inspection.status 
    });
  }

  // Update inspection
  const updateData = {};
  if (req.body.inspectionJson) {
    updateData.inspectionJson = req.body.inspectionJson;
    updateData.status = req.body.inspectionJson.audit?.status || inspection.status;
    
    // Auto-update status to IN_PROGRESS if inspector is updating a DRAFT inspection
    if (req.user.role === 'INSPECTOR' && inspection.status === 'DRAFT') {
      updateData.status = 'IN_PROGRESS';
      if (!req.body.inspectionJson.audit) {
        req.body.inspectionJson.audit = {};
      }
      req.body.inspectionJson.audit.status = 'IN_PROGRESS';
      updateData.inspectionJson = req.body.inspectionJson;
    }
  }
  if (req.body.status) {
    updateData.status = req.body.status;
  }
  if (req.body.assignedToId && req.user.role === 'ADMIN') {
    updateData.assignedToId = req.body.assignedToId;
  }

  const updated = await prisma.inspection.update({
    where: { id: inspection.id },
    data: updateData
  });

  res.json(updated);
};

// Delete inspection (ADMIN only)
exports.deleteInspection = async (req, res) => {
  if (req.user.role !== 'ADMIN') return res.sendStatus(403);

  const inspection = await prisma.inspection.findUnique({
    where: { id: req.params.id }
  });

  if (!inspection) return res.sendStatus(404);

  await prisma.inspection.delete({
    where: { id: inspection.id }
  });

  res.json({ message: 'Inspection deleted successfully' });
};

exports.submitInspection = async (req, res) => {
  const inspection = await prisma.inspection.findUnique({
    where: { id: req.params.id }
  });

  if (!inspection || inspection.assignedToId !== req.user.id)
    return res.sendStatus(403);

  // Only allow submission if not already submitted or report generated
  if (inspection.status === 'SUBMITTED' || inspection.status === 'REPORT_GENERATED') {
    return res.status(400).json({ 
      message: 'Inspection has already been submitted. Current status: ' + inspection.status 
    });
  }

  // Ensure audit status is set to SUBMITTED
  req.body.audit = req.body.audit || {};
  req.body.audit.status = 'SUBMITTED';
  req.body.audit.last_modified_at = new Date().toISOString();

  validateInspection(req.body);
  computeDerived(req.body);

  await prisma.inspection.update({
    where: { id: inspection.id },
    data: {
      inspectionJson: req.body,
      status: 'SUBMITTED' // Always set status to SUBMITTED
    }
  });

  res.json({ message: 'Inspection submitted successfully', id: inspection.id });
};

exports.generateReport = async (req, res) => {
  // Only ADMIN can generate PDF reports
  if (req.user.role !== 'ADMIN') return res.sendStatus(403);

  const inspection = await prisma.inspection.findUnique({
    where: { id: req.params.id }
  });

  if (!inspection) return res.sendStatus(404);

  // Only allow PDF generation for submitted inspections
  if (inspection.status !== 'SUBMITTED' && inspection.status !== 'REPORT_GENERATED') {
    return res.status(400).json({ 
      message: 'Can only generate PDF for submitted inspections. Current status: ' + inspection.status 
    });
  }

  try {
    // Load ERI JSON from database (this is the source of truth)
    const json = inspection.inspectionJson || {};
    
    if (!json || Object.keys(json).length === 0) {
      return res.status(400).json({ 
        message: 'No inspection data found. Please ensure the inspection has been completed and submitted.' 
      });
    }
    
    console.log(`[PDF] Generating PDF for inspection ${inspection.id}`);
    console.log(`[PDF] Using JSON from database with ${json.rooms?.length || 0} rooms`);
    
    // Ensure ERI JSON reflects latest audit status before generating report
    if (!json.audit) json.audit = {};
    json.audit.status = 'REPORT_GENERATED';
    json.audit.last_modified_at = new Date().toISOString();

    // Generate PDF using the JSON from database
    const reportPath = await generatePdf(json);

    await prisma.inspection.update({
      where: { id: inspection.id },
      data: {
        status: 'REPORT_GENERATED',
        reportPath,
        inspectionJson: json
      }
    });

    res.json({ reportPath });
  } catch (error) {
    console.error("PDF Generation Error:", error);
    res.status(500).json({ message: 'Failed to generate PDF' });
  }
};

// Test PDF generation with dummy data
exports.testPdfGeneration = async (req, res) => {
  const { dummyInspectionJson } = require('../../test-pdf-generation');
  
  try {
    const { generatePdf } = require('../pdf/pdf.service');
    const reportPath = await generatePdf(dummyInspectionJson);
    
    res.json({ 
      message: 'Test PDF generated successfully',
      reportPath: reportPath,
      downloadUrl: `http://localhost:5000/${reportPath}`
    });
  } catch (error) {
    console.error('Test PDF generation error:', error);
    res.status(500).json({ message: 'Failed to generate test PDF', error: error.message });
  }
};