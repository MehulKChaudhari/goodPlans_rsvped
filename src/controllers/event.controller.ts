import { Request, Response } from 'express';
import * as eventService from '../services/event.service';
import { AppError } from '../lib/app-error';
import { parsePagination } from '../validators/pagination.validators';

export async function createEventHandler(req: Request, res: Response) {
  if (!req.user) throw AppError.unauthorized();
  const event = await eventService.createEvent({ ...req.body, organizerId: req.user.sub });
  res.status(201).json({ success: true, data: event });
}

export async function listEventsHandler(req: Request, res: Response) {
  const { page, pageSize } = parsePagination(req);
  const result = await eventService.listEvents(page, pageSize);
  res.status(200).json({ success: true, data: result });
}

export async function getEventHandler(req: Request, res: Response) {
  const event = await eventService.getEventById(req.params.id);
  res.status(200).json({ success: true, data: event });
}

export async function updateEventHandler(req: Request, res: Response) {
  if (!req.user) throw AppError.unauthorized();
  const event = await eventService.updateEvent(req.params.id, req.user.sub, req.body);
  res.status(200).json({ success: true, data: event });
}

export async function deleteEventHandler(req: Request, res: Response) {
  if (!req.user) throw AppError.unauthorized();
  await eventService.deleteEvent(req.params.id, req.user.sub);
  res.status(204).send();
}
