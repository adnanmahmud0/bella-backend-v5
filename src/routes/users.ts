import { Router } from 'express';

const router = Router();

// Placeholder routes - to be implemented
router.get('/', (req, res) => {
  res.json({ success: true, data: [], message: 'Users endpoint' });
});

export default router;