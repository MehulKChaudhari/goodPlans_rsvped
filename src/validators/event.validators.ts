import { body, param } from 'express-validator';

export const createEventValidator = [
  body('title').isString().trim().isLength({ min: 1, max: 200 }),
  body('description').isString().trim().isLength({ min: 1, max: 5000 }),
  body('date').isISO8601().withMessage('date must be an ISO8601 string').toDate(),
  body('location').isString().trim().isLength({ min: 1, max: 200 }),
  body('totalTickets').isInt({ min: 1, max: 1_000_000 }).toInt(),
  body('priceCents').isInt({ min: 0, max: 100_000_000 }).toInt(),
];

export const updateEventValidator = [
  param('id').isUUID(),
  body('title').optional().isString().trim().isLength({ min: 1, max: 200 }),
  body('description').optional().isString().trim().isLength({ min: 1, max: 5000 }),
  body('date').optional().isISO8601().toDate(),
  body('location').optional().isString().trim().isLength({ min: 1, max: 200 }),
  body('priceCents').optional().isInt({ min: 0, max: 100_000_000 }).toInt(),
];

export const eventIdParamValidator = [param('id').isUUID()];
