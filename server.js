const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config();

const { initDB } = require('./db');

const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const orderRoutes = require('./routes/orders');
const couponRoutes = require('./routes/coupons');
const reviewRoutes = require('./routes/reviews');
const contentRoutes = require('./routes/content');
const adminRoutes = require('./routes/admin');
const visitRoutes = require('./routes/visits');
const { router: deliveryRoutes } = require('./routes/delivery');

const app = express();
// const PORT = process.env.BACKEND_PORT || process.env.PORT || 5000;
const PORT = process.env.PORT || process.env.BACKEND_PORT || 5000;

// Lazy DB initialization for Serverless / Vercel execution
let dbReadyPromise = null;
function ensureDB() {
  if (!dbReadyPromise) {
    dbReadyPromise = initDB().catch((err) => {
      console.error('[TiDB] Lazy initialization failed:', err);
      dbReadyPromise = null;
      throw err;
    });
  }
  return dbReadyPromise;
}

// Middleware
const allowedOrigins = [
  process.env.FRONTEND_URL,
  process.env.NEXT_PUBLIC_APP_URL,
  'https://izhadesignsfrontend.vercel.app',
  'https://izhadesigns.vercel.app',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (
      allowedOrigins.includes(origin) ||
      origin.includes('localhost') ||
      origin.includes('127.0.0.1') ||
      origin.includes('vercel.app') ||
      origin.includes('izhadesigns')
    ) {
      return callback(null, true);
    }
    // Allow any origin in non-production or as fallback for frontend deployment
    return callback(null, true);
  },
  credentials: true,
}));

// Request logger for API debugging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[API] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${duration}ms)`);
  });
  next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Ensure database connection is initialized for any incoming request
app.use(async (req, res, next) => {
  // Allow health check without blocking on DB
  if (req.path === '/api/health') return next();
  try {
    await ensureDB();
    next();
  } catch (err) {
    res.status(503).json({
      success: false,
      message: 'Database temporarily unavailable. Please retry shortly.',
      error: err.message,
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    service: 'Izha Blooms Node/Express TiDB Backend',
    database: 'TiDB Cloud',
    environment: process.env.NODE_ENV || 'development',
    serverless: Boolean(process.env.VERCEL),
    timestamp: new Date().toISOString(),
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/coupons', couponRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/content', contentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/visits', visitRoutes);
app.use('/api/delivery-settings', deliveryRoutes);

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  res.status(500).json({
    success: false,
    message: err.message || 'Internal Server Error',
  });
});

// Start Server when run directly as standalone process
async function startServer() {
  try {
    await ensureDB();
    const server = app.listen(PORT, () => {
      console.log(`[Express Backend] Izha Blooms API running on http://localhost:${PORT}`);
    });
    // Keep event loop alive
    setInterval(() => {}, 1000 * 60 * 60);
    if (process.stdin.isTTY === false) {
      process.stdin.resume();
    }
  } catch (err) {
    console.error('Failed to start Express backend:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

module.exports = app;
