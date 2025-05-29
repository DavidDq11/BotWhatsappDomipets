const { getPool } = require('../config/db');

class ProductService {
  static MAIN_CATEGORIES_MAP = {
    'Litter': '🏖️ Areneras',
    'Pet Food': '🍖 Alimento Seco',
    'Pet Treats': '🍬 Snacks',
    'Accessories': '🎁 Accesorios',
    'Supplements': '💊 Suplementos',
    'Wet Food': '🥫 Comida Húmeda',
  };

  static ANIMAL_CATEGORY_MAP = {
    'cat': '🐱 Gato',
    'dog': '🐶 Perro',
  };

  static async getMainCategories(animalCategory) {
    try {
      const pool = await getPool(); // Ensure pool is initialized
      let query = 'SELECT DISTINCT category FROM products';
      const params = [];
      if (animalCategory) {
        query += ' WHERE animal_category = $1';
        params.push(animalCategory);
      } else {
        query += ' WHERE animal_category IN ($1, $2)';
        params.push('Dog', 'Cat');
      }
      query += ' ORDER BY category';
      console.log(`Executing getMainCategories query: ${query}, params: ${params}`);
      const result = await pool.query(query, params);
      const categories = result.rows.map(row => row.category);
      console.log(`Categories fetched for ${animalCategory || 'Dog/Cat'}:`, categories);
      return categories.filter(cat => ProductService.MAIN_CATEGORIES_MAP[cat]);
    } catch (error) {
      console.error(`Error fetching main categories for ${animalCategory || 'Dog/Cat'}:`, error.stack);
      throw error; // Throw the error instead of returning an empty array
    }
  }

  // Update other methods similarly to use getPool()
  static async getProducts(category, animalCategory, type, offset = 0, limit = 10) {
    try {
      const pool = await getPool();
      let query = `
        SELECT 
          p.id, 
          p.title, 
          p.description, 
          p.category,
          MIN(ps.price) AS price,
          ARRAY_AGG(DISTINCT ps.size ORDER BY ps.size) AS sizes,
          ARRAY_AGG(DISTINCT jsonb_build_object('size', ps.size, 'price', ps.price, 'stock_quantity', ps.stock_quantity)) AS size_details,
          BOOL_AND(ps.stock_quantity > 0) AS in_stock,
          r.rating_rate,
          r.rating_count
        FROM products p
        LEFT JOIN product_sizes ps ON p.id = ps.product_id
        LEFT JOIN ratings r ON p.id = r.product_id
        WHERE p.category = $1 AND p.animal_category = $2
      `;
      const params = [category, animalCategory];
      let paramIndex = 3;

      if (type) {
        query += ` AND p.type = $${paramIndex++}`;
        params.push(type);
      }

      query += `
        GROUP BY p.id, p.title, p.description, p.category, r.rating_rate, r.rating_count
        ORDER BY p.id
        OFFSET $${paramIndex++} LIMIT $${paramIndex++}
      `;
      params.push(offset, limit);

      console.log(`Executing getProducts query: ${query}, params: ${params}`);
      const result = await pool.query(query, params);
      console.log(`Products fetched for category=${category}, animal=${animalCategory}, type=${type}:`, result.rows);
      return result.rows.map(p => ({
        id: p.id,
        title: p.title,
        description: p.description,
        category: p.category,
        price: Number(p.price) || 0,
        special_price: Number(p.price) || 0,
        sizes: p.sizes.filter(s => s !== null),
        sizeDetails: p.size_details.filter(s => s !== null),
        stock: p.in_stock ? 'In stock' : 'Out of stock',
        rating_rate: p.rating_rate,
        rating_count: p.rating_count,
      }));
    } catch (error) {
      console.error(`Error fetching products for ${category}, ${animalCategory}, ${type}:`, error.stack);
      throw error;
    }
  }

  static async getProductById(productId) {
    try {
      const pool = await getPool();
      const result = await pool.query(
        `
        SELECT 
          p.id, 
          p.title, 
          p.description, 
          p.category,
          ARRAY_AGG(DISTINCT ps.size ORDER BY ps.size) AS sizes,
          ARRAY_AGG(DISTINCT jsonb_build_object('size', ps.size, 'price', ps.price, 'stock_quantity', ps.stock_quantity)) AS size_details,
          BOOL_AND(ps.stock_quantity > 0) AS in_stock,
          r.rating_rate,
          r.rating_count
        FROM products p
        LEFT JOIN product_sizes ps ON p.id = ps.product_id
        LEFT JOIN ratings r ON p.id = r.product_id
        WHERE p.id = $1 AND p.animal_category IN ('Dog', 'Cat')
        GROUP BY p.id, p.title, p.description, p.category, r.rating_rate, r.rating_count
        `,
        [productId]
      );
      const imageResult = await pool.query('SELECT image_url FROM images WHERE product_id = $1 LIMIT 1', [productId]);
      const image_url = imageResult.rows[0]?.image_url || null;
      if (result.rows.length > 0) {
        const p = result.rows[0];
        return {
          id: p.id,
          title: p.title,
          description: p.description,
          category: p.category,
          price: Number(p.size_details[0]?.price) || 0,
          special_price: Number(p.size_details[0]?.price) || 0,
          sizes: p.sizes.filter(s => s !== null),
          sizeDetails: p.size_details.filter(s => s !== null),
          stock: p.in_stock ? 'In stock' : 'Out of stock',
          rating_rate: p.rating_rate,
          rating_count: p.rating_count,
          image_url,
        };
      }
      return null;
    } catch (error) {
      console.error(`Error fetching product ${productId}:`, error.stack);
      throw error;
    }
  }

  static async searchProducts(searchTerm, animalCategory) {
    try {
      const pool = await getPool();
      const query = `
        SELECT 
          p.id, 
          p.title, 
          p.description, 
          p.category,
          MIN(ps.price) AS price,
          ARRAY_AGG(DISTINCT ps.size ORDER BY ps.size) AS sizes,
          ARRAY_AGG(DISTINCT jsonb_build_object('size', ps.size, 'price', ps.price, 'stock_quantity', ps.stock_quantity)) AS size_details,
          BOOL_AND(ps.stock_quantity > 0) AS in_stock,
          r.rating_rate,
          r.rating_count
        FROM products p
        LEFT JOIN product_sizes ps ON p.id = ps.product_id
        LEFT JOIN ratings r ON p.id = r.product_id
        WHERE (
          p.title ILIKE $1 OR 
          p.description ILIKE $1 OR 
          p.category ILIKE $1 OR 
          p.type ILIKE $1
        ) AND p.animal_category = $2
        GROUP BY p.id, p.title, p.description, p.category, r.rating_rate, r.rating_count
        ORDER BY p.id
        LIMIT 10
      `;
      const params = [`%${searchTerm}%`, animalCategory || 'Dog'];
      console.log(`Executing searchProducts query: ${query}, params: ${params}`);
      const result = await pool.query(query, params);
      console.log(`Search results for term=${searchTerm}, animal=${animalCategory}:`, result.rows);
      return result.rows.map(p => ({
        id: p.id,
        title: p.title,
        description: p.description,
        category: p.category,
        price: Number(p.price) || 0,
        special_price: Number(p.price) || 0,
        sizes: p.sizes.filter(s => s !== null),
        sizeDetails: p.size_details.filter(s => s !== null),
        stock: p.in_stock ? 'In stock' : 'Out of stock',
        rating_rate: p.rating_rate,
        rating_count: p.rating_count,
      }));
    } catch (error) {
      console.error(`Error searching products for ${searchTerm}:`, error.stack);
      throw error;
    }
  }
}

module.exports = ProductService;