import { Request } from 'express';
import rateLimit from 'express-rate-limit';

export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, code: 'RATE_LIMITED', message: 'Too many auth attempts, try again later' },
});

// Keyed by authenticated user, not source IP: the resource being protected
// is "one account hammering the booking endpoint", and a shared IP (NAT,
// corporate egress, this load-test harness) must not throttle every distinct
// user behind it. This route always runs after `authenticate`, so req.user
// is guaranteed to be set.
export const bookingRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.user!.sub,
  message: { success: false, code: 'RATE_LIMITED', message: 'Too many booking attempts, slow down' },
});
