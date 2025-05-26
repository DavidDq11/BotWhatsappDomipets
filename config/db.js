const { Pool } = require('pg');
require('dotenv').config();

let pool;
let connectionAttempts = 0;
const MAX_ATTEMPTS = 3;

const setupPool = () => {
    try {
        connectionAttempts++;
        console.log(`Attempt ${connectionAttempts} to connect to database`);

        pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: {
                rejectUnauthorized: false, // Necesario para Neon Tech
            },
            connectionTimeoutMillis: 5000,
            idleTimeoutMillis: 30000,
        });

        // Testear la conexión
        pool.query('SELECT NOW()', (err) => {
            if (err) {
                console.error('Database connection test failed:', err);
                if (err.code === 'ECONNREFUSED' && connectionAttempts < MAX_ATTEMPTS) {
                    console.log('Reattempting connection in 5 seconds...');
                    setTimeout(setupPool, 5000);
                } else {
                    console.error('Max connection attempts reached. Giving up.');
                }
            } else {
                console.log('Successfully connected to Neon Tech database');
            }
        });

        // Manejo de errores inesperados
        pool.on('error', (err, client) => {
            console.error('Unexpected error on idle client:', err);
            if (err.code === 'ECONNREFUSED' && connectionAttempts < MAX_ATTEMPTS) {
                console.log('Attempting to reconnect...');
                setupPool();
            }
        });
    } catch (err) {
        console.error('Error setting up database pool:', err);
        if (connectionAttempts < MAX_ATTEMPTS) {
            console.log(`Retrying in 5 seconds... (Attempt ${connectionAttempts}/${MAX_ATTEMPTS})`);
            setTimeout(setupPool, 5000);
        } else {
            console.error('Max connection attempts reached. Application will not function without database.');
            process.exit(1);
        }
    }
};

setupPool();

module.exports = pool;