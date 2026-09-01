import { Router } from 'express';
import { QOL_CATEGORIES, scoreAssessment } from '../domain/qol.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

/**
 * The questions, public and unauthenticated.
 *
 * Deliberately no login and nothing stored. A family working out whether
 * their dog is suffering should not have to make an account, and we have
 * no business keeping a record of them doing it.
 */
router.get('/questions', asyncHandler(async (req, res) => {
  res.json({ categories: QOL_CATEGORIES, maxScore: QOL_CATEGORIES.length * 5 });
}));

/**
 * Score a set of answers.
 *
 * Scored server-side so the wording of the result lives in one place and
 * can be corrected everywhere at once — this is text people read at a
 * hard moment, and it should never differ between two copies.
 *
 * NOTHING IS PERSISTED. No row, no analytics, no identifier.
 */
router.post('/score', asyncHandler(async (req, res) => {
  const result = scoreAssessment(req.body?.answers || {});
  if (!result.complete) {
    return res.status(400).json({
      error: 'Please answer every question — a partial total would be misleading.',
    });
  }
  res.json(result);
}));

export default router;
