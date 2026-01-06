const router = require('express').Router();
const ctrl = require('./inspection.controller');
const authMiddleware = require('../utils/authMiddleware');

// All other routes require authentication
router.use(authMiddleware);

router.post('/create', ctrl.createInspection);
router.get('/', ctrl.getAllInspections);
router.get('/assigned', ctrl.getAssignedInspections);
router.get('/stats', ctrl.getInspectionStats);
router.get('/:id', ctrl.getInspection);
router.put('/:id', ctrl.updateInspection);            // ADMIN & INSPECTOR (update)
router.delete('/:id', ctrl.deleteInspection);         // ADMIN only
router.post('/:id/submit', ctrl.submitInspection);    // INSPECTOR
router.post('/:id/report', ctrl.generateReport);      // ADMIN only

module.exports = router;