import { Router } from 'express';
const router = Router();
router.get('/', (req, res) => res.json({ success: true, data: [], message: 'Verifications endpoint' }));
export default router;