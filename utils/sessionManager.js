const pool = require('../config/db');

const SESSIONS_TABLE = 'user_sessions';

const DEFAULT_SESSION_DATA = {
    state: 'INIT',
    cart: [],
    catalog: { offset: 0, animalCategory: null, foodSubcategory: null },
    supportAction: null,
    errorCount: 0,
};

/**
 * Convierte un objeto de sesión recuperado de la DB para uso en la aplicación.
 * Asegura que lastActivity sea un objeto Date.
 * @param {Object} rawSessionData
 * @returns {Object}
 */
const formatSessionData = (rawSessionData) => {
    if (rawSessionData && rawSessionData.lastActivity) {
        rawSessionData.lastActivity = new Date(rawSessionData.lastActivity);
    } else {
        // En caso de que no haya lastActivity (ej. sesión muy antigua sin esa columna), inicializar
        rawSessionData.lastActivity = new Date();
    }
    return rawSessionData;
};

/**
 * Obtiene o crea una sesión para un número de teléfono.
 * La sesión se carga de la base de datos si existe, de lo contrario se crea una nueva.
 * La 'last_activity' de la sesión se actualiza automáticamente.
 * @param {string} phone - El número de teléfono del usuario.
 * @returns {Promise<Object>} La sesión del usuario.
 */
const get = async (phone) => {
    if (!phone) {
        console.warn('Attempted to get session for null/undefined phone number');
        throw new Error('Phone number is required to get a session');
    }

    try {
        const result = await pool.query(`SELECT session_data FROM ${SESSIONS_TABLE} WHERE phone = $1`, [phone]);

        let sessionData;
        if (result.rows.length > 0) {
            sessionData = formatSessionData(result.rows[0].session_data);
            console.log(`Loaded session for ${phone} from DB`);
        } else {
            sessionData = { ...DEFAULT_SESSION_DATA };
            sessionData.lastActivity = new Date(); // Nueva sesión, activity actual
            console.log(`Created new session for ${phone} (initial load)`);
        }

        // Siempre actualiza last_activity (como string ISO para la DB) y guarda/actualiza en DB
        const lastActivityIso = sessionData.lastActivity.toISOString();
        await pool.query(
            `INSERT INTO ${SESSIONS_TABLE} (phone, session_data, last_activity)
             VALUES ($1, $2, $3)
             ON CONFLICT (phone) DO UPDATE SET session_data = EXCLUDED.session_data, last_activity = EXCLUDED.last_activity`,
            [phone, sessionData, lastActivityIso]
        );

        return sessionData;

    } catch (err) {
        console.error(`Error in sessionManager.get for ${phone}:`, err);
        throw new Error(`Failed to retrieve/create session for ${phone}: ${err.message}`);
    }
};

/**
 * Actualiza una sesión existente en la base de datos.
 * Debe llamarse después de cualquier modificación en la sesión.
 * @param {string} phone - El número de teléfono del usuario.
 * @param {Object} sessionData - El objeto de la sesión actualizado.
 * @returns {Promise<void>}
 */
const update = async (phone, sessionData) => {
    if (!phone || !sessionData) {
        console.warn('Attempted to update session with null/undefined phone or data');
        throw new Error('Phone number and session data are required to update a session');
    }
    try {
        // Asegúrate de que lastActivity esté siempre actualizado antes de guardar
        sessionData.lastActivity = new Date();
        const lastActivityIso = sessionData.lastActivity.toISOString();
        await pool.query(
            `UPDATE ${SESSIONS_TABLE} SET session_data = $1, last_activity = $2 WHERE phone = $3`,
            [sessionData, lastActivityIso, phone]
        );
        // console.log(`Updated session for ${phone} in DB`);
    } catch (err) {
        console.error(`Error in sessionManager.update for ${phone}:`, err);
        throw new Error(`Failed to update session for ${phone}: ${err.message}`);
    }
};

/**
 * Reinicia (elimina) una sesión de la base de datos.
 * @param {string} phone - El número de teléfono del usuario.
 * @returns {Promise<void>}
 */
const reset = async (phone) => {
    if (!phone) {
        console.warn('Attempted to reset null/undefined phone');
        return;
    }
    try {
        await pool.query(`DELETE FROM ${SESSIONS_TABLE} WHERE phone = $1`, [phone]);
        console.log(`Reset session for ${phone} in DB`);
    } catch (err) {
        console.error(`Error in sessionManager.reset for ${phone}:`, err);
        throw new Error(`Failed to reset session for ${phone}: ${err.message}`);
    }
};

/**
 * Lista todas las sesiones activas (solo para debug).
 * Esta función es solo para propósitos de depuración y NO DEBE USARSE EN PRODUCCIÓN
 * con grandes volúmenes de datos, ya que podría consumir muchos recursos.
 * @returns {Promise<Array<Object>>} Lista de sesiones.
 */
const listAll = async () => {
    try {
        const result = await pool.query(`SELECT phone, session_data->>'state' as state, session_data->>'supportAction' as supportAction, last_activity FROM ${SESSIONS_TABLE} ORDER BY last_activity DESC`);
        return result.rows.map(row => ({
            phone: row.phone,
            state: row.state,
            supportAction: row.supportAction,
            lastActivity: row.last_activity, // Esto ya viene como un Date o string ISO de la DB
        }));
    } catch (err) {
        console.error('Error listing all sessions from DB:', err);
        return [];
    }
};

/**
 * Limpia sesiones inactivas de la base de datos.
 * @param {number} maxAgeMinutes - Tiempo máximo de inactividad en minutos antes de eliminar la sesión.
 * @returns {Promise<number>} Número de sesiones eliminadas.
 */
const cleanInactiveSessions = async (maxAgeMinutes = 60) => {
    try {
        const threshold = new Date(Date.now() - maxAgeMinutes * 60 * 1000);
        const result = await pool.query(`DELETE FROM ${SESSIONS_TABLE} WHERE last_activity < $1 RETURNING phone`, [threshold]);
        console.log(`Cleaned ${result.rowCount} inactive sessions from DB`);
        return result.rowCount;
    } catch (err) {
        console.error('Error cleaning inactive sessions from DB:', err);
        throw err;
    }
};

module.exports = { get, update, reset, listAll, cleanInactiveSessions };