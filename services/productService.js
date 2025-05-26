// services/productService.js
const pool = require('../config/db');

class ProductService {
    // Mapeo para traducir entre DB y lo que el usuario ve para las CATEGORÍAS PRINCIPALES
    static MAIN_CATEGORIES_MAP = {
        'Litter': '🏖️ Areneras',
        'Pet Food': '🍖 Alimento Seco',
        'Pet Treats': '🍬 Snacks para Mascotas',
        'Accessories': '🎁 Accesorios',
        'Supplements': '💊 Suplementos',
        'Wet Food': '🥫 Comida Húmeda', // Tu XLSX la pone como categoría principal 6.
    };

    // Mapeo interno para traducir entre DB (`animal_category`) y lo que el usuario ve
    static ANIMAL_CATEGORY_MAP = {
        'cat': '🐱 Gatos',
        'dog': '🐶 Perros',
        'poultry': '🐔 Aves',
        'quail': '🐦 Codornices',
        'pig': '🐷 Cerdos',
        'cattle': '🐮 Ganado',
        'horse': '🐴 Caballos',
        'rabbit': '🐰 Conejos',
        'fish': '🐟 Peces',
    };

    // Mapeo para traducir entre DB (`type` o inferido) y lo que el usuario ve para SUBTIPOS DE PRODUCTO
    static PRODUCT_TYPE_MAP = {
        'Food': 'Comida Seca', // General para alimento seco
        'Wet Food': 'Comida Húmeda', // General para alimento húmedo
        'Litter': 'Arenas Sanitarias', // Para productos de 'Litter'
        // Añade más si tu columna `type` tiene otros valores significativos
        // Puedes poner aquí también 'Cat Treats', 'Dog Treats', 'Poultry Accessories' si quieres un nivel adicional
        // pero por ahora 'type' solo parece ser 'Food' o 'Wet Food' en tus ejemplos.
        // Las categorías como 'Cat Treats' son el valor de la columna 'category'.
        'Cat Treats': 'Snacks para Gatos',
        'Dog Treats': 'Snacks para Perros',
        'Poultry Accessories': 'Accesorios Aves', // Si 'type' toma este valor
        // Para los accesorios y suplementos, tu xlsx no muestra un 'type' específico,
        // así que los productos podrían listarse directamente después de elegir la categoría principal y el animal.
    };

    /**
     * Obtiene las categorías principales (ej. 'Litter', 'Pet Food').
     * @returns {Promise<Array<string>>}
     */
    static async getMainCategories() {
        try {
            const result = await pool.query('SELECT DISTINCT category FROM products ORDER BY category');
            // Filtrar para asegurar que solo devolvemos las categorías que tenemos en nuestro mapeo
            return result.rows.map(row => row.category).filter(cat => ProductService.MAIN_CATEGORIES_MAP[cat]);
        } catch (error) {
            console.error('Error fetching main categories:', error);
            return [];
        }
    }

    /**
     * Obtiene los tipos de animales para una categoría principal dada.
     * @param {string} mainCategory - Ej: 'Pet Food', 'Litter'
     * @returns {Promise<Array<string>>} Ej: ['cat', 'dog']
     */
    static async getAnimalsByMainCategory(mainCategory) {
        try {
            const result = await pool.query(
                'SELECT DISTINCT animal_category FROM products WHERE category = $1 AND animal_category IS NOT NULL ORDER BY animal_category',
                [mainCategory]
            );
            return result.rows.map(row => row.animal_category);
        } catch (error) {
            console.error(`Error fetching animal categories for main category ${mainCategory}:`, error);
            return [];
        }
    }

    /**
     * Obtiene los subtipos de productos (valores de la columna `type`) para una categoría principal y animal dados.
     * @param {string} mainCategory - Ej: 'Pet Food'
     * @param {string} animalCategory - Ej: 'dog', 'cat'
     * @returns {Promise<Array<string>>} Ej: ['Food', 'Wet Food']
     */
    static async getProductSubtypes(mainCategory, animalCategory) {
        try {
            const result = await pool.query(
                'SELECT DISTINCT type FROM products WHERE category = $1 AND animal_category = $2 AND type IS NOT NULL ORDER BY type',
                [mainCategory, animalCategory]
            );
            // Asegurarse de que solo se devuelven tipos que tienen un mapeo si es necesario
            // o que quieres que aparezcan como subtipos en la lista.
            return result.rows.map(row => row.type).filter(type => ProductService.PRODUCT_TYPE_MAP[type]);
        } catch (error) {
            console.error(`Error fetching product subtypes for ${mainCategory} and ${animalCategory}:`, error);
            return [];
        }
    }

    /**
     * Obtiene productos basados en categoría principal, animal y subtipo (si aplica).
     * @param {string} mainCategory - Ej: 'Pet Food'
     * @param {string} animalCategory - Ej: 'dog'
     * @param {string} productSubtype - Ej: 'Food', 'Wet Food' (Este es el `type` de tu DB)
     * @param {number} offset
     * @param {number} limit
     * @returns {Promise<Array<Object>>}
     */
    static async getProducts(mainCategory, animalCategory, productSubtype, offset = 0, limit = 10) {
        try {
            let query = `
                SELECT id, title, description, price, prevprice AS special_price, sizes, stock, rating_rate, rating_count
                FROM products
                WHERE category = $1
            `;
            const params = [mainCategory];
            let paramIndex = 2;

            if (animalCategory) {
                query += ` AND animal_category = $${paramIndex++}`;
                params.push(animalCategory);
            }
            if (productSubtype) {
                query += ` AND type = $${paramIndex++}`;
                params.push(productSubtype);
            }

            query += ` ORDER BY id OFFSET $${paramIndex++} LIMIT $${paramIndex++}`;
            params.push(offset, limit);

            const result = await pool.query(query, params);

            return result.rows.map(p => ({
                ...p,
                special_price: p.prevprice || p.price
            }));
        } catch (error) {
            console.error(`Error fetching products for ${mainCategory}, ${animalCategory}, ${productSubtype}:`, error);
            return [];
        }
    }

    /**
     * Obtiene un producto por su ID.
     * @param {number} productId
     * @returns {Promise<Object|null>}
     */
    static async getProductById(productId) {
        try {
            const result = await pool.query(
                `SELECT id, title, description, price, prevprice AS special_price, sizes, stock, rating_rate, rating_count
                 FROM products
                 WHERE id = $1`,
                [productId]
            );
            if (result.rows.length > 0) {
                 return {
                    ...result.rows[0],
                    special_price: result.rows[0].prevprice || result.rows[0].price
                 };
            }
            return null;
        } catch (error) {
            console.error(`Error fetching product with ID ${productId}:`, error);
            return null;
        }
    }
}

module.exports = ProductService;