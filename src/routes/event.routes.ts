import { Router } from 'express';
import {
  createEventHandler,
  deleteEventHandler,
  getEventHandler,
  listEventsHandler,
  updateEventHandler,
} from '../controllers/event.controller';
import {
  createEventValidator,
  eventIdParamValidator,
  updateEventValidator,
} from '../validators/event.validators';
import { paginationValidator } from '../validators/pagination.validators';
import { validate } from '../middleware/validate.middleware';
import { authenticate, authorizeRoles } from '../middleware/auth.middleware';

export const eventRouter = Router();

eventRouter.get('/', paginationValidator, validate, listEventsHandler);
eventRouter.get('/:id', eventIdParamValidator, validate, getEventHandler);

eventRouter.post('/', authenticate, authorizeRoles('ORGANIZER'), createEventValidator, validate, createEventHandler);
eventRouter.patch(
  '/:id',
  authenticate,
  authorizeRoles('ORGANIZER'),
  updateEventValidator,
  validate,
  updateEventHandler,
);
eventRouter.delete(
  '/:id',
  authenticate,
  authorizeRoles('ORGANIZER'),
  eventIdParamValidator,
  validate,
  deleteEventHandler,
);
