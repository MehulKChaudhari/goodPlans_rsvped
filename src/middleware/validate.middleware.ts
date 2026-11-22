import { NextFunction, Request, Response } from 'express';
import { validationResult } from 'express-validator';
import { AppError } from '../lib/app-error';

export function validate(req: Request, _res: Response, next: NextFunction) {
  const result = validationResult(req);
  if (!result.isEmpty()) {
    const message = result
      .array()
      .map((e) => (`msg` in e ? e.msg : 'Invalid input'))
      .join('; ');
    throw AppError.badRequest(message, 'VALIDATION_ERROR');
  }
  next();
}
