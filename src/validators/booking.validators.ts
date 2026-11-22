import { body, header, param } from 'express-validator';

export const createBookingValidator = [
  body('eventId').isUUID().withMessage('eventId must be a UUID'),
  body('ticketsCount').isInt({ min: 1, max: 20 }).withMessage('ticketsCount must be 1-20').toInt(),
  header('idempotency-key').optional().isString().isLength({ min: 1, max: 200 }),
];

export const bookingIdParamValidator = [param('id').isUUID()];
