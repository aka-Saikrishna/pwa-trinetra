const { ROOM_TAXONOMY } = require('../config/artefacts');
const prisma = require('../config/prisma');

/**
 * Generate prefill inspection JSON (ERI-style)
 * @param {Object} params - { technician: string|object, metadata?: object }
 * @returns {Promise<Object>} Prefill inspection JSON
 */
exports.generatePrefill = async ({ technician, metadata = {} }) => {
  // Normalize technician: accept string or object, convert to object
  let technicianObj;
  if (typeof technician === 'string') {
    // Legacy: if string provided, convert to object
    technicianObj = {
      id: technician,
      name: technician
    };
  } else if (technician && typeof technician === 'object') {
    // ERI-style: expect {id, name}
    technicianObj = {
      id: technician.id || technician.name || '',
      name: technician.name || technician.id || ''
    };
  } else {
    // Default fallback
    technicianObj = {
      id: '',
      name: ''
    };
  }

  // Fetch predefined issues from DB to populate items
  const predefinedIssues = await prisma.predefinedIssue.findMany({
    orderBy: [{ roomType: 'asc' }, { category: 'asc' }]
  });

  // Group issues by roomType -> category -> [descriptions]
  const issuesByRoom = {};
  predefinedIssues.forEach(issue => {
    if (!issuesByRoom[issue.roomType]) {
      issuesByRoom[issue.roomType] = {};
    }
    if (!issuesByRoom[issue.roomType][issue.category]) {
      issuesByRoom[issue.roomType][issue.category] = [];
    }
    issuesByRoom[issue.roomType][issue.category].push(issue.description);
  });

  // Generate rooms with items populated from categories
  const rooms = Object.entries(ROOM_TAXONOMY.room_types)
    .filter(([, r]) => r.scored)
    .map(([roomType, roomDef]) => {
      const roomLabel = roomDef.label;
      // Generate room_id: "LIVING_ROOM" -> "living_room"
      const roomId = roomType.toLowerCase();
      
      // Map room type to DB format (e.g., "LIVING_ROOM" -> "Living Room")
      // DB stores roomType as "Living Room", "Bedroom", etc.
      const dbRoomType = roomLabel;
      const roomIssues = issuesByRoom[dbRoomType] || {};
      
      // Build items array from categories
      const items = [];
      Object.entries(roomIssues).forEach(([category, descriptions]) => {
        descriptions.forEach((description, idx) => {
          // Skip placeholder entries
          if (description === '#N/A' || description === '#REF!' || !description.trim()) {
            return;
          }
          
          // Generate item_id: roomType_category_index
          const itemId = `${roomId}_${category.toLowerCase().replace(/\s+/g, '_')}_${idx}`;
          
          items.push({
            item_id: itemId,
            label: description,
            category: category,
            status: null, // User fills this
            remarks: null, // User fills this
            photos: [] // User adds photos
          });
        });
      });

      return {
        room_id: roomId,
        room_type: roomType,
        room_label: roomLabel,
        scored: roomDef.scored,
        length: null,
        width: null,
        items: items
      };
    });

  return {
    schema_version: '1.0',
    inspection_id: 'INS-' + Date.now(),
    metadata: {
      property_id: metadata.property_id || '',
      property_type: metadata.property_type || 'Apartment',
      property_address: metadata.property_address || '',
      client_name: metadata.client_name || null,
      client_email: metadata.client_email || null,
      client_phone: metadata.client_phone || null,
      inspection_date: metadata.inspection_date || new Date().toISOString().slice(0, 10),
      technician: technicianObj,
      notes: metadata.notes || ''
    },
    rooms: rooms,
    derived: {
      room_scores: {},
      severity_counts: { critical: 0, major: 0, minor: 0, cosmetic: 0 },
      overall_score: null
    },
    audit: {
      status: 'DRAFT',
      created_at: new Date().toISOString(),
      last_modified_at: new Date().toISOString(),
      submitted_at: null
    }
  };
};
