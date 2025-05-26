const express = require('express');
const dotenv = require('dotenv');
const webhookRouter = require('./routes/webhook');
const sessionManager = require('./utils/sessionManager');
const productService = require('./services/productService');
const pool = require('./config/db'); // Necesitas importar el pool para asegurarte de que la DB esté lista si lo necesitas

dotenv.config();
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use('/webhook', webhookRouter);

app.get('/', (req, res) => res.send('Welcome to Domipets WhatsApp Bot API'));

app.listen(port, () => console.log(`Server running on http://localhost:${port}`));

process.on('SIGTERM', async () => {
    console.log('Shutting down server...');
    // Opcional: Cerrar el pool de la DB de forma limpia al apagar
    try {
        await pool.end();
        console.log('Database pool has ended.');
    } catch (err) {
        console.error('Error ending database pool:', err);
    }
    process.exit(0);
});

if (process.env.NODE_ENV !== 'production') {
    app.get('/debug', async (req, res) => { // <-- Hacer la ruta async
        try {
            const sessions = await sessionManager.listAll(); // <-- Ahora es async
            res.json({
                serverTime: new Date().toISOString(),
                sessions: sessions, // Asegurarse de que el objeto de sesión se envía correctamente
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

    app.get('/debug/clean-sessions', async (req, res) => { // <-- Hacer la ruta async
        try {
            const count = await sessionManager.cleanInactiveSessions(); // <-- Ahora es async
            res.json({ success: true, message: `Cleaned ${count} inactive sessions` });
        } catch (error) {
            console.error('Error in /debug/clean-sessions route:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.get('/debug/db-test', async (req, res) => {
        try {
            const products = await productService.getProductsByCategory('Dog', 'Dry Food'); // Usar categorías existentes para una prueba más robusta
            res.json({ success: true, connectionStatus: 'OK', productsCount: products.length, firstFew: products.slice(0, 3) });
        } catch (error) {
            res.status(500).json({ success: false, connectionStatus: 'FAILED', error: error.message });
        }
    });
}

// La función `cleanInactiveSessions` ahora es asíncrona, así que el setInterval también debe usar async/await
setInterval(async () => {
    try {
        await sessionManager.cleanInactiveSessions();
    } catch (error) {
        console.error('Error during scheduled session cleanup:', error);
    }
}, 60 * 60 * 1000); // Se ejecuta cada hora