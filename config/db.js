const { Pool } = require('pg');
require('dotenv').config();

let pool;
let connectionAttempts = 0;
const MAX_ATTEMPTS = 3;

const setupPool = async () => {
    try {
        connectionAttempts++;
        console.log(`Attempt ${connectionAttempts} to connect to database`);

        pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: {
                rejectUnauthorized: false,
            },
            connectionTimeoutMillis: 5000,
            idleTimeoutMillis: 30000,
        });

        // Test the connection
        await pool.query('SELECT NOW()');
        console.log('Successfully connected to Neon Tech database');
        return pool;
    } catch (err) {
        console.error('Error setting up database pool:', err);
        if (connectionAttempts < MAX_ATTEMPTS) {
            console.log(`Retrying in 5 seconds... (Attempt ${connectionAttempts}/${MAX_ATTEMPTS})`);
            await new Promise(resolve => setTimeout(resolve, 5000));
            return setupPool();
        } else {
            console.error('Max connection attempts reached. Application will not function without database.');
            process.exit(1); // Exit process on failure
        }
    }
};

const poolPromise = setupPool();

module.exports = {
    getPool: async () => {
        if (!pool) {
            await poolPromise; // Wait for the pool to be initialized
        }
        return pool;
    },
};