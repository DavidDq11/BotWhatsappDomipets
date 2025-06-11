const express = require('express');
const dotenv = require('dotenv');
const webhookRouter = require('./routes/webhook');
const sessionManager = require('./utils/sessionManager');
const productService = require('./services/productService');
const { getPool } = require('./config/db'); // Import getPool instead of pool

dotenv.config();
const app = express();

// Middleware global
app.use(express.json());

// Endpoint de salud para mantener el servidor despierto
app.get('/healthz', (req, res) => {
  res.status(200).send('OK');
});

// Rutas principales
app.use('/webhook', webhookRouter);

app.get('/', (req, res) => res.send('Welcome to Domipets WhatsApp Bot API'));

// Debug routes for non-production
if (process.env.NODE_ENV !== 'production') {
  app.get('/debug', async (req, res) => {
    try {
      const sessions = await sessionManager.listAll();
      res.json({
        serverTime: new Date().toISOString(),
        sessions,
        env: {
          DATABASE_URL: process.env.DATABASE_URL ? '***configurado***' : 'no configurado',
          PORT: process.env.PORT || 3000,
          WHATSAPP_TOKEN: process.env.WHATSAPP_TOKEN ? '***configurado***' : 'no configurado',
          WHATSAPP_ACCESS_TOKEN: process.env.WHATSAPP_ACCESS_TOKEN ? '***configurado***' : 'no configurado',
          WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID,
        },
      });
    } catch (error) {
      console.error('Error in /debug route:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/debug/clean-sessions', async (req, res) => {
    try {
      const count = await sessionManager.cleanInactiveSessions();
      res.json({ success: true, message: `Cleaned ${count} inactive sessions` });
    } catch (error) {
      console.error('Error in /debug/clean-sessions route:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/debug/db-test', async (req, res) => {
    try {
      const dogCategories = await productService.getMainCategories('Dog');
      const catCategories = await productService.getMainCategories('Cat');
      res.json({
        success: true,
        connectionStatus: 'OK',
        dogCategories,
        catCategories,
      });
    } catch (error) {
      console.error('Error in /debug/db-test route:', error);
      res.status(500).json({ success: false, connectionStatus: 'FAILED', error: error.message });
    }
  });
}

// Define PORT at the top level
const PORT = process.env.PORT || 10000; // Alineado con logs previos, ajusta si Render usa otro

// Initialize database connection before starting the server
getPool()
  .then(() => {
    // Escucha en 0.0.0.0 para que sea accesible externamente en Render
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on http://0.0.0.0:${PORT}`);
    });

    // Periodic session cleanup
    setInterval(async () => {
      try {
        await sessionManager.cleanInactiveSessions();
      } catch (error) {
        console.error('Error during scheduled session cleanup:', error);
      }
    }, 60 * 60 * 1000); // Every hour
  })
  .catch((err) => {
    console.error('Failed to initialize database connection:', err);
    process.exit(1);
  });

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down server...');
  try {
    const pool = await getPool();
    await pool.end();
    console.log('Database pool has ended.');
  } catch (err) {
    console.error('Error ending database pool:', err);
  }
  process.exit(0);
});