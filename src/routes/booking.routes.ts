import { Router } from 'express';
import {
  cancelBookingHandler,
  confirmBookingHandler,
  createBookingHandler,
  getBookingHandler,
  listMyBookingsHandler,
} from '../controllers/booking.controller';
import { bookingIdParamValidator, createBookingValidator } from '../validators/booking.validators';
import { paginationValidator } from '../validators/pagination.validators';
import { validate } from '../middleware/validate.middleware';
import { authenticate, authorizeRoles } from '../middleware/auth.middleware';
import { bookingRateLimit } from '../middleware/rate-limit.middleware';

export const bookingRouter = Router();

bookingRouter.use(authenticate, authorizeRoles('CUSTOMER'));

bookingRouter.post('/', bookingRateLimit, createBookingValidator, validate, createBookingHandler);
bookingRouter.get('/my', paginationValidator, validate, listMyBookingsHandler);
bookingRouter.get('/:id', bookingIdParamValidator, validate, getBookingHandler);
bookingRouter.post('/:id/confirm', bookingIdParamValidator, validate, confirmBookingHandler);
bookingRouter.post('/:id/cancel', bookingIdParamValidator, validate, cancelBookingHandler);
