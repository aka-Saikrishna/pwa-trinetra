const { SCORING_RULES } = require('../config/artefacts');

/**
 * Compute derived fields (scores, counts) from inspection data
 * Uses SCORING_RULES for calculation methods
 */
exports.computeDerived = (inspection) => {
  const roomScores = {};
  const severity = { critical: 0, major: 0, minor: 0, cosmetic: 0 };

  // Calculate room scores
  inspection.rooms.forEach(room => {
    if (!room.scored) return;

    const method = SCORING_RULES.room_score_calculation?.method || 'average';
    const excludeStatus = SCORING_RULES.room_score_calculation?.exclude_status || ['NA'];

    let total = 0;
    let count = 0;

    room.items.forEach(item => {
      // Skip excluded statuses
      if (!item.status || excludeStatus.includes(item.status)) return;

      const weight = SCORING_RULES.status_weights[item.status];
      if (weight !== null && weight !== undefined) {
        total += weight;
        count++;

        // Count severity
        const severityType = SCORING_RULES.severity_mapping[item.status];
        if (severityType && severity[severityType] !== undefined) {
          severity[severityType]++;
        }
      }
    });

    // Calculate room score based on method
    if (method === 'average' && count > 0) {
      roomScores[room.room_id] = Math.round(total / count);
    } else {
      roomScores[room.room_id] = 0;
    }
  });

  // Calculate overall score
  const overallMethod = SCORING_RULES.overall_score_calculation?.method || 'weighted_average';
  const roomWeight = SCORING_RULES.overall_score_calculation?.room_weight || 'equal';

  let overallScore = null;
  const roomScoreValues = Object.values(roomScores); // FIX: Don't filter out 0 scores

  if (roomScoreValues.length > 0) {
    if (overallMethod === 'weighted_average' && roomWeight === 'equal') {
      // Simple average of all room scores
      overallScore = Math.round(
        roomScoreValues.reduce((a, b) => a + b, 0) / roomScoreValues.length
      );
    } else {
      // Fallback to average
      overallScore = Math.round(
        roomScoreValues.reduce((a, b) => a + b, 0) / roomScoreValues.length
      );
    }
  }

  // Update derived fields
  inspection.derived = {
    room_scores: roomScores,
    severity_counts: severity,
    overall_score: overallScore
  };

  // Update audit status and timestamp
  inspection.audit.status = 'SUBMITTED';
  inspection.audit.submitted_at = new Date().toISOString();
  inspection.audit.last_modified_at = new Date().toISOString();
};

/**
 * Get quality grade based on overall score and thresholds
 * @param {number} score - Overall score
 * @returns {string} Grade: 'excellent', 'good', 'acceptable', 'poor'
 */
exports.getQualityGrade = (score) => {
  if (score === null || score === undefined) return 'poor';

  const thresholds = SCORING_RULES.report_thresholds;

  if (score >= thresholds.excellent.min) return 'excellent';
  if (score >= thresholds.good.min) return 'good';
  if (score >= thresholds.acceptable.min) return 'acceptable';
  return 'poor';
};
