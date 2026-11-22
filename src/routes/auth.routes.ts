import { Router } from 'express';
import { loginHandler, logoutHandler, refreshHandler, registerHandler } from '../controllers/auth.controller';
import { loginValidator, refreshValidator, registerValidator } from '../validators/auth.validators';
import { validate } from '../middleware/validate.middleware';
import { authenticate } from '../middleware/auth.middleware';
import { authRateLimit } from '../middleware/rate-limit.middleware';

export const authRouter = Router();

authRouter.post('/register', authRateLimit, registerValidator, validate, registerHandler);
authRouter.post('/login', authRateLimit, loginValidator, validate, loginHandler);
authRouter.post('/refresh', authRateLimit, refreshValidator, validate, refreshHandler);
authRouter.post('/logout', authenticate, logoutHandler);
