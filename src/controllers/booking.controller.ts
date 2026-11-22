import { Request, Response } from 'express';
import * as bookingService from '../services/booking.service';
import { AppError } from '../lib/app-error';
import { parsePagination } from '../validators/pagination.validators';

export async function createBookingHandler(req: Request, res: Response) {
  if (!req.user) throw AppError.unauthorized();
  const booking = await bookingService.createHold({
    userId: req.user.sub,
    eventId: req.body.eventId,
    ticketsCount: req.body.ticketsCount,
    idempotencyKey: req.header('idempotency-key'),
  });
  res.status(201).json({ success: true, data: booking });
}

export async function confirmBookingHandler(req: Request, res: Response) {
  if (!req.user) throw AppError.unauthorized();
  const booking = await bookingService.confirmBooking(req.params.id, req.user.sub);
  res.status(200).json({ success: true, data: booking });
}

export async function cancelBookingHandler(req: Request, res: Response) {
  if (!req.user) throw AppError.unauthorized();
  const booking = await bookingService.cancelBooking(req.params.id, req.user.sub);
  res.status(200).json({ success: true, data: booking });
}

export async function getBookingHandler(req: Request, res: Response) {
  if (!req.user) throw AppError.unauthorized();
  const booking = await bookingService.getBookingById(req.params.id, req.user.sub);
  res.status(200).json({ success: true, data: booking });
}

export async function listMyBookingsHandler(req: Request, res: Response) {
  if (!req.user) throw AppError.unauthorized();
  const { page, pageSize } = parsePagination(req);
  const result = await bookingService.listMyBookings(req.user.sub, page, pageSize);
  res.status(200).json({ success: true, data: result });
}
