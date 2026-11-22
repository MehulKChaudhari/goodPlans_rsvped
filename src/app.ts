import express from 'express';
import 'express-async-errors';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { logger } from './config/logger';
import { requestId } from './middleware/request-id.middleware';
import { errorHandler, notFoundHandler } from './middleware/error.middleware';
import { authRouter } from './routes/auth.routes';
import { eventRouter } from './routes/event.routes';
import { bookingRouter } from './routes/booking.routes';

export const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(requestId);
app.use(
  pinoHttp({
    logger,
    genReqId: (req) => (req as express.Request).requestId,
    autoLogging: { ignore: (req) => req.url === '/health' },
  }),
);

app.get('/health', (_req, res) => {
  res.status(200).json({ success: true, data: { status: 'ok' } });
});

app.use('/api/auth', authRouter);
app.use('/api/events', eventRouter);
app.use('/api/bookings', bookingRouter);

app.use(notFoundHandler);
app.use(errorHandler);
