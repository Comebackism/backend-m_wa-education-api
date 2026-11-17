import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { corsOrigins, env, isProduction } from './config/env.js';
import apiRoutes from './routes/index.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  if (isProduction) app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cors({ origin: corsOrigins, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));

  if (env.NODE_ENV !== 'test') {
    app.use(morgan(isProduction ? 'combined' : 'dev'));
  }

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
  });

  app.use('/api', apiRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
