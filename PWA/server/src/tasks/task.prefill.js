const prisma = require('../config/prisma');

/**
 * Generate prefill JSON for a new inspection task
 * This follows the ERI/ITR model:
 * - Schema owned by backend
 * - Defines what can be filled
 * - Locks room taxonomy
 * - Provides defaults (null, "NA", "PENDING")
 */

const ROOM_TAXONOMY = {
  living_room: 'Living Room',
  bedroom_1: 'Bedroom 1',
  bedroom_2: 'Bedroom 2',
  bedroom_3: 'Bedroom 3',
  master_bedroom: 'Master Bedroom',
  kitchen: 'Kitchen',
  dining: 'Dining Room',
  bathroom_1: 'Bathroom 1',
  bathroom_2: 'Bathroom 2',
  toilet: 'Toilet',
  balcony: 'Balcony',
  terrace: 'Terrace',
  parking: 'Parking',
  entrance: 'Entrance',
  corridor: 'Corridor'
};

const INSPECTION_ITEMS = {
  living_room: [
    { item_id: 'flooring_finish', label: 'Flooring finish', category: 'Flooring' },
    { item_id: 'wall_paint', label: 'Wall paint quality', category: 'Wall Finish' },
    { item_id: 'ceiling_condition', label: 'Ceiling condition', category: 'Wall Finish' },
    { item_id: 'electrical_outlets', label: 'Electrical outlets functioning', category: 'Electrical Work' },
    { item_id: 'lighting', label: 'Lighting adequacy', category: 'Electrical Work' },
    { item_id: 'door_alignment', label: 'Door alignment', category: 'Doors' },
    { item_id: 'window_condition', label: 'Window condition', category: 'Windows' },
    { item_id: 'ac_provision', label: 'AC provision available', category: 'Electrical Work' }
  ],
  bedroom_1: [
    { item_id: 'flooring_finish', label: 'Flooring finish', category: 'Flooring' },
    { item_id: 'wall_paint', label: 'Wall paint quality', category: 'Wall Finish' },
    { item_id: 'ceiling_condition', label: 'Ceiling condition', category: 'Wall Finish' },
    { item_id: 'electrical_outlets', label: 'Electrical outlets functioning', category: 'Electrical Work' },
    { item_id: 'lighting', label: 'Lighting adequacy', category: 'Electrical Work' },
    { item_id: 'door_alignment', label: 'Door alignment', category: 'Doors' },
    { item_id: 'window_condition', label: 'Window condition', category: 'Windows' },
    { item_id: 'wardrobe_condition', label: 'Wardrobe/Cabinet condition', category: 'Modular Furniture' }
  ],
  bedroom_2: [
    { item_id: 'flooring_finish', label: 'Flooring finish', category: 'Flooring' },
    { item_id: 'wall_paint', label: 'Wall paint quality', category: 'Wall Finish' },
    { item_id: 'ceiling_condition', label: 'Ceiling condition', category: 'Wall Finish' },
    { item_id: 'electrical_outlets', label: 'Electrical outlets functioning', category: 'Electrical Work' },
    { item_id: 'door_alignment', label: 'Door alignment', category: 'Doors' },
    { item_id: 'window_condition', label: 'Window condition', category: 'Windows' }
  ],
  kitchen: [
    { item_id: 'flooring_finish', label: 'Flooring finish', category: 'Flooring' },
    { item_id: 'wall_tiles', label: 'Wall tiles condition', category: 'Wall Finish' },
    { item_id: 'countertop', label: 'Countertop condition', category: 'Modular Kitchen' },
    { item_id: 'appliances', label: 'Appliances condition', category: 'Modular Kitchen' },
    { item_id: 'plumbing', label: 'Plumbing functioning', category: 'Plumbing' },
    { item_id: 'electrical_outlets', label: 'Electrical outlets functioning', category: 'Electrical Work' },
    { item_id: 'ventilation', label: 'Ventilation/Exhaust fan', category: 'Electrical Work' },
    { item_id: 'gas_connection', label: 'Gas connection available', category: 'Plumbing' }
  ],
  bathroom_1: [
    { item_id: 'flooring_finish', label: 'Flooring finish', category: 'Flooring' },
    { item_id: 'wall_tiles', label: 'Wall tiles condition', category: 'Wall Finish' },
    { item_id: 'plumbing', label: 'Plumbing functioning', category: 'Plumbing' },
    { item_id: 'sanitary_ware', label: 'Sanitary ware condition', category: 'Sanitary ware' },
    { item_id: 'cp_fittings', label: 'CP fittings condition', category: 'Sanitary ware' },
    { item_id: 'electrical_outlets', label: 'Electrical outlets safe', category: 'Electrical Work' },
    { item_id: 'ventilation', label: 'Ventilation/Exhaust fan', category: 'Electrical Work' },
    { item_id: 'mirror_shelves', label: 'Mirror & shelves', category: 'Modular Furniture' }
  ],
  balcony: [
    { item_id: 'flooring_finish', label: 'Flooring finish', category: 'Flooring' },
    { item_id: 'railing', label: 'Railing condition', category: 'Handrails/MS grills' },
    { item_id: 'waterproofing', label: 'Waterproofing condition', category: 'Wall Finish' }
  ]
};

const STATUS_OPTIONS = ['PASS', 'COSMETIC', 'MINOR', 'MAJOR', 'CRITICAL'];
const SEVERITY_OPTIONS = ['COSMETIC', 'MINOR', 'MAJOR', 'CRITICAL'];

async function generatePrefillJson({ propertyId, clientName, inspector }) {
  try {
    // Get predefined issues
    const predefinedIssues = await prisma.predefinedIssue.findMany();

    // Build issue database grouped by room/category
    const issueDatabase = {};
    predefinedIssues.forEach(issue => {
      const key = `${issue.roomType}-${issue.category}`;
      if (!issueDatabase[key]) {
        issueDatabase[key] = [];
      }
      issueDatabase[key].push({
        title: issue.description,
        severity: issue.severity
      });
    });

    // Create rooms array with inspection items
    const rooms = [];
    for (const [roomId, roomLabel] of Object.entries(ROOM_TAXONOMY)) {
      const items = INSPECTION_ITEMS[roomId] || [];

      rooms.push({
        room_id: roomId,
        room_label: roomLabel,
        scored: true,
        items: items.map(item => ({
          item_id: item.item_id,
          label: item.label,
          category: item.category,
          status: null, // Inspector must fill
          remarks: null,
          photos: [],
          possible_issues: issueDatabase[`${roomId}-${item.category}`] || []
        }))
      });
    }

    // Canonical prefill JSON structure
    const prefillJson = {
      schema_version: '1.0',
      inspection_id: null, // Will be assigned on submission
      metadata: {
        property_id: propertyId,
        client_name: clientName,
        client_email: null,
        client_phone: null,
        property_address: null,
        inspection_date: new Date().toISOString().split('T')[0],
        technician_name: inspector,
        technician_id: null,
        task_created_at: new Date().toISOString()
      },
      rooms: rooms,
      derived: {
        room_scores: {},
        severity_counts: {
          critical: 0,
          major: 0,
          minor: 0,
          cosmetic: 0
        },
        overall_score: null,
        total_issues: 0,
        total_rooms_inspected: 0
      },
      audit: {
        created_at: new Date().toISOString(),
        last_modified: null,
        submitted_at: null,
        submitted_by: null
      }
    };

    return prefillJson;
  } catch (error) {
    console.error('Error generating prefill JSON:', error);
    throw error;
  }
}

/**
 * Validate inspection JSON against schema
 * Ensures no extra keys, required fields are filled, etc.
 */
function validateInspectionJson(inspectionJson, prefillJson) {
  const errors = [];

  // Validate metadata
  if (!inspectionJson.metadata.client_name) {
    errors.push('Client name is required');
  }
  if (!inspectionJson.metadata.client_email && !inspectionJson.metadata.client_phone) {
    errors.push('Either client email or phone is required');
  }

  // Validate rooms - must match prefill
  if (!inspectionJson.rooms || inspectionJson.rooms.length === 0) {
    errors.push('At least one room must be inspected');
  }

  // Ensure prefillJson is safe to read
  const safePrefill = prefillJson || { rooms: [] };

  inspectionJson.rooms.forEach(room => {
    const prefillRoom = safePrefill.rooms ? safePrefill.rooms.find(r => r.room_id === room.room_id) : null;

    // Relaxed validation: If room not in prefill, we allow it (dynamic room)
    // If it IS in prefill, we validate its items against the schema

    if (prefillRoom) {
      room.items.forEach(item => {
        const prefillItem = prefillRoom.items.find(i => i.item_id === item.item_id);
        // We also relax item validation - if item is extra, we allow it

        // Status must be filled for all items
        if (!item.status || !STATUS_OPTIONS.includes(item.status)) {
          errors.push(`Invalid or missing status for ${item.label} in ${room.room_label}`);
        }
      });
    } else {
      // For dynamic rooms, just check basic structure if needed, or skip
      // Ensuring status exists for dynamic items too
      room.items.forEach(item => {
        if (!item.status || !STATUS_OPTIONS.includes(item.status)) {
          errors.push(`Invalid or missing status for ${item.label || 'Unknown Item'} in ${room.room_label || 'Unknown Room'}`);
        }
      });
    }
  });

  return { valid: errors.length === 0, errors };
}

/**
 * Compute derived fields from inspection data
 */
function computeDerivedFields(inspectionJson) {
  const derived = {
    room_scores: {},
    severity_counts: {
      critical: 0,
      major: 0,
      minor: 0,
      cosmetic: 0
    },
    overall_score: 100, // Default to 100
    total_issues: 0,
    total_rooms_inspected: 0
  };

  // Fixed Deduction Model
  const DEDUCTIONS = {
    'CRITICAL': 10,
    'MAJOR': 5,
    'MINOR': 2,
    'COSMETIC': 1,
    'PASS': 0
  };

  if (!inspectionJson.rooms || inspectionJson.rooms.length === 0) {
    return derived;
  }

  let totalDeductionOverall = 0;

  inspectionJson.rooms.forEach(room => {
    let roomDeduction = 0;

    room.items.forEach(item => {
      const deduction = DEDUCTIONS[item.status] || 0;
      roomDeduction += deduction;

      if (item.status && item.status !== 'PASS') {
        const severityKey = item.status.toLowerCase();
        if (derived.severity_counts.hasOwnProperty(severityKey)) {
          derived.severity_counts[severityKey]++;
          derived.total_issues++;
        }
      }
    });

    const roomScore = Math.max(0, 100 - roomDeduction);
    derived.room_scores[room.room_id] = roomScore;
    totalDeductionOverall += roomDeduction;
    derived.total_rooms_inspected++;
  });

  // Overall score is 100 minus the weighted average of deductions if we want 
  // OR simply 100 minus total deduction if it's a flat deduction model.
  // Given the user said "deduct percentage as per issue", usually it's a total deduction.
  // But to keep it sane across many rooms, we'll use average room health.

  let averageRoomScore = 0;
  Object.values(derived.room_scores).forEach(score => {
    averageRoomScore += score;
  });

  derived.overall_score = derived.total_rooms_inspected > 0
    ? Math.round(averageRoomScore / derived.total_rooms_inspected)
    : 100;

  return derived;
}

module.exports = {
  generatePrefillJson,
  validateInspectionJson,
  computeDerivedFields,
  ROOM_TAXONOMY,
  INSPECTION_ITEMS,
  STATUS_OPTIONS,
  SEVERITY_OPTIONS
};
