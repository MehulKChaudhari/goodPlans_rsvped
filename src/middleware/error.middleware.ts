import { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { AppError } from '../lib/app-error';
import { logger } from '../config/logger';

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ success: false, code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ success: false, code: err.code, message: err.message });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      res.status(409).json({ success: false, code: 'DUPLICATE', message: 'Resource already exists' });
      return;
    }
    if (err.code === 'P2025') {
      res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Resource not found' });
      return;
    }
  }

  req.log?.error({ err }, 'Unhandled error');
  logger.error({ err }, 'Unhandled error');
  res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: 'Something went wrong' });
}
