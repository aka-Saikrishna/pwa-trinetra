const http = require('http');
const fs = require('fs');
const path = require('path');

// This function remains crucial as it prepares the data for the PDF generator.
function transformInspectionData(inspectionJson) {
  const extensionData = inspectionJson.metadata?.extension_data || inspectionJson.metadata || {};

  let rooms = [];
  let inspections = [];
  let majorCount = 0;
  let minorCount = 0;
  let cosmeticCount = 0;

  // 📝 Helper to normalize issue types
  const normalizeIssueType = (type) => {
    if (!type) return 'Cosmetic';
    const t = String(type).toUpperCase();
    if (t === 'MAJOR' || t === 'CRITICAL') return 'Major';
    if (t === 'MINOR') return 'Minor';
    return 'Cosmetic';
  };

  // 📝 Extraction Logic
  // We check multiple sources to be as robust as possible
  const sourceInspections = extensionData.inspections || inspectionJson.inspections || [];
  const sourceRooms = extensionData.rooms || inspectionJson.rooms || [];

  if (Array.isArray(sourceInspections) && sourceInspections.length > 0) {
    console.log(`[PDF Service] Found ${sourceInspections.length} inspections in source data.`);

    inspections = sourceInspections
      .filter(item => {
        const type = String(item.issueType || item.status || '').toUpperCase();
        return type !== 'PASS' && type !== 'SATISFACTORY';
      })
      .map(item => {
        const normalizedType = normalizeIssueType(item.issueType || item.status);
        if (normalizedType === 'Major') majorCount++;
        else if (normalizedType === 'Minor') minorCount++;
        else cosmeticCount++;

        return {
          room: item.room || item.room_name || 'General',
          category: item.category || 'General',
          issueType: normalizedType,
          description: item.description || item.label || 'No description',
          images: (item.images || item.photos || []).map(img => {
            if (!img) return null;
            if (img.startsWith('data:')) return img;
            // Handle server paths starting with / or not
            if (img.startsWith('/')) return `http://localhost:5001${img}`;
            if (img.includes('uploads/')) return `http://localhost:5001/${img}`;
            return img;
          }).filter(Boolean),
          date: item.date || new Date().toISOString()
        };
      });

    rooms = sourceRooms.map(room => ({
      name: room.name || room.room_label || 'Room',
      dimensions: room.dimensions || (room.length ? [{ length: room.length, width: room.width }] : []),
      materials: room.materials || {},
      brands: room.brands || {},
      dimensionDetails: room.dimensionDetails || {}
    }));
  } else {
    // 🏛️ Deep Fallback: Legacy structure (room.items array)
    console.log('[PDF Service] Falling back to legacy room.items structure.');
    const data = inspectionJson.inspection_data || inspectionJson;
    const rawRooms = data.rooms || [];

    rawRooms.forEach(room => {
      const roomName = room.room_label || room.room_type || room.name || 'Room';
      rooms.push({
        name: roomName,
        dimensions: room.dimensions || (room.length ? [{ length: room.length, width: room.width }] : []),
        materials: room.materials || {},
        brands: room.brands || {}
      });

      if (Array.isArray(room.items)) {
        room.items.forEach(item => {
          const type = String(item.status || item.issueType || '').toUpperCase();
          if (type === 'PASS' || !type) return;

          const normalizedType = normalizeIssueType(type);
          if (normalizedType === 'Major') majorCount++;
          else if (normalizedType === 'Minor') minorCount++;
          else cosmeticCount++;

          inspections.push({
            room: roomName,
            category: item.category || 'General',
            issueType: normalizedType,
            description: item.label || item.remarks || item.description || 'No description',
            images: (item.photos || item.images || []).map(p => {
              const path = p.server_url || p.local_ref || (typeof p === 'string' ? p : null);
              if (!path) return null;
              if (path.startsWith('data:')) return path;
              return path.startsWith('/') ? `http://localhost:5001${path}` : `http://localhost:5001/${path}`;
            }).filter(Boolean),
            date: data.audit?.submitted_at || new Date().toISOString()
          });
        });
      }
    });
  }

  // Calculate total area
  const totalArea = rooms.reduce((sum, room) => {
    const roomArea = (room.dimensions || []).reduce((roomSum, dim) => {
      return roomSum + (parseFloat(dim.length || 0) * parseFloat(dim.width || 0));
    }, 0);
    return sum + (isNaN(roomArea) ? 0 : roomArea);
  }, 0);

  // Final Output
  return {
    reportId: String(inspectionJson.inspection_id || '0000').padStart(8, '0'),
    inspectorName: inspectionJson.performedBy?.name || inspectionJson.inspectorName || inspectionJson.inspector_name || 'Inspector',
    verifierName: inspectionJson.verifierName || inspectionJson.verifier_name || 'Admin',
    inspectionDate: new Date(inspectionJson.inspection_date || inspectionJson.submittedAt || Date.now()).toLocaleDateString(),
    clientName: inspectionJson.client_name || inspectionJson.clientName || 'Client',
    propertyAddress: inspectionJson.property_address || inspectionJson.propertyAddress || 'Property Address',
    rooms: rooms,
    inspections: inspections,
    quality: {
      major: majorCount || inspectionJson.quality?.major || 0,
      minor: minorCount || inspectionJson.quality?.minor || 0,
      cosmetic: cosmeticCount || inspectionJson.quality?.cosmetic || 0,
      water: {
        ph: inspectionJson.quality?.water?.ph || inspectionJson.metadata?.water_ph || 7.0,
        tds: inspectionJson.quality?.water?.tds || inspectionJson.metadata?.water_tds || 186
      }
    },
    summary: {
      totalArea: totalArea.toFixed(2),
      overallScore: inspectionJson.overallScore || inspectionJson.overall_score || 0
    },
    brands: inspectionJson.brands || (extensionData && extensionData.brands) || {},
    severityCounts: inspectionJson.severityCounts || inspectionJson.severity_counts || { major: majorCount, minor: minorCount, cosmetic: cosmeticCount }
  };
}


/**
 * @description Calls the PDF generation microservice to create a PDF.
 * @param {object} inspectionData The raw inspection data from the database.
 * @param {string} outputPath The full path where the generated PDF should be saved.
 * @returns {Promise<string>} A promise that resolves with the path to the generated PDF.
 */
function generatePDF(inspectionData, outputPath) {
  return new Promise((resolve, reject) => {
    console.log('[PDF Service] Delegating PDF generation to microservice.');

    // 1. Transform the data from the main backend into the format the PDF service expects.
    const canonicalReportData = transformInspectionData(inspectionData);
    const postData = JSON.stringify(canonicalReportData);

    const options = {
      hostname: 'localhost',
      port: 3000,
      path: '/api/generate-pdf',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = http.request(options, (res) => {
      // The PDF service returns a stream of the PDF file.
      // We need to capture this stream and write it to a file.

      if (res.statusCode >= 400) {
        let errorBody = '';
        res.on('data', chunk => errorBody += chunk);
        res.on('end', () => {
          console.error('[PDF Service] Error from microservice:', errorBody);
          reject(new Error(`PDF microservice returned status ${res.statusCode}: ${errorBody}`));
        });
        return;
      }

      console.log(`[PDF Service] Receiving PDF stream from microservice (Status: ${res.statusCode}).`);
      const fileStream = fs.createWriteStream(outputPath);

      res.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        console.log(`[PDF Service] Successfully saved PDF to ${outputPath}`);
        resolve(outputPath);
      });

      fileStream.on('error', (err) => {
        console.error('[PDF Service] Error writing PDF file:', err);
        reject(err);
      });
    });

    req.on('error', (e) => {
      console.error(`[PDF Service] Problem with request to microservice: ${e.message}`);
      reject(new Error('Could not connect to the PDF generation microservice. Is it running on port 3000?'));
    });

    // Write data to request body
    req.write(postData);
    req.end();
  });
}

module.exports = {
  generatePDF,
  transformInspectionData
};