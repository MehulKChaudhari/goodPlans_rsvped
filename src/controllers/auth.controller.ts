import { Request, Response } from 'express';
import * as authService from '../services/auth.service';
import { AppError } from '../lib/app-error';

export async function registerHandler(req: Request, res: Response) {
  const { user, tokens } = await authService.register(req.body);
  res.status(201).json({ success: true, data: { user, ...tokens } });
}

export async function loginHandler(req: Request, res: Response) {
  const { user, tokens } = await authService.login(req.body);
  res.status(200).json({ success: true, data: { user, ...tokens } });
}

export async function refreshHandler(req: Request, res: Response) {
  const tokens = await authService.refresh(req.body.refreshToken);
  res.status(200).json({ success: true, data: tokens });
}

export async function logoutHandler(req: Request, res: Response) {
  if (!req.user) throw AppError.unauthorized();
  await authService.logout(req.user.sub);
  res.status(204).send();
}
