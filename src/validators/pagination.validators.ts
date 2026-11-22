import { query } from 'express-validator';

export const paginationValidator = [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('pageSize').optional().isInt({ min: 1, max: 100 }).toInt(),
];

export function parsePagination(req: { query: Record<string, unknown> }) {
  const page = Number(req.query.page) || 1;
  const pageSize = Number(req.query.pageSize) || 20;
  return { page, pageSize };
}
