import { body } from 'express-validator';

export const registerValidator = [
  body('name').isString().trim().isLength({ min: 1, max: 100 }).withMessage('name is required (max 100 chars)'),
  body('email').isEmail().withMessage('a valid email is required').normalizeEmail(),
  body('password').isString().isLength({ min: 8, max: 72 }).withMessage('password must be 8-72 chars'),
  body('role').isIn(['ORGANIZER', 'CUSTOMER']).withMessage('role must be ORGANIZER or CUSTOMER'),
];

export const loginValidator = [
  body('email').isEmail().withMessage('a valid email is required').normalizeEmail(),
  body('password').isString().notEmpty().withMessage('password is required'),
];

export const refreshValidator = [body('refreshToken').isString().notEmpty().withMessage('refreshToken is required')];
