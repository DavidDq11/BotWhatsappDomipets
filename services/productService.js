const { getPool } = require('../config/db');
const axios = require('axios');

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

  static async getCatalogProducts(animalCategory, offset = 0, limit = 10) {
    try {
      const catalogId = process.env.CATALOG_ID;
      const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
      const response = await axios.get(
        `https://graph.facebook.com/v22.0/${catalogId}/products`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: {
            fields: 'id,name,description,price,availability,category',
            limit,
            offset,
          },
        }
      );
      return response.data.data
        .filter(product => {
          const categoryMatch = product.category && (
            product.category.toLowerCase().includes(animalCategory.toLowerCase()) ||
            animalCategory.toLowerCase() === 'dog' && product.category.toLowerCase().includes('perro') ||
            animalCategory.toLowerCase() === 'cat' && product.category.toLowerCase().includes('gato')
          );
          return categoryMatch;
        })
        .map(product => ({
          id: product.id,
          title: product.name,
          description: product.description || 'Sin descripción',
          category: product.category || 'Otros',
          price: product.price || 'No disponible',
          sizes: ['Única'],
          sizeDetails: [{ size: 'Única', price: product.price || 0, stock_quantity: product.availability === 'in stock' ? 10 : 0 }],
          stock: product.availability === 'in stock' ? 'In stock' : 'Out of stock',
        }));
    } catch (error) {
      console.error('Error al obtener productos del catálogo:', error);
      throw error;
    }
  }

  static async getMainCategories(animalCategory) {
    try {
      const products = await this.getCatalogProducts(animalCategory);
      const categories = [...new Set(products.map(p => p.category.split(' - ')[0]))];
      return categories.filter(cat => this.MAIN_CATEGORIES_MAP[cat] || cat);
    } catch (error) {
      console.error(`Error fetching main categories for ${animalCategory}:`, error.stack);
      throw error;
    }
  }

  static async getProducts(category, animalCategory, type, offset = 0, limit = 10) {
    try {
      const products = await this.getCatalogProducts(animalCategory, offset, limit);
      return products.filter(p => p.category.split(' - ')[0] === category);
    } catch (error) {
      console.error(`Error fetching products for ${category}, ${animalCategory}:`, error.stack);
      throw error;
    }
  }

  static async getProductById(productId) {
    try {
      const catalogId = process.env.CATALOG_ID;
      const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
      const response = await axios.get(
        `https://graph.facebook.com/v22.0/${productId}`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: { fields: 'id,name,description,price,availability,category,image_url' },
        }
      );
      const p = response.data;
      return {
        id: p.id,
        title: p.name,
        description: p.description || 'Sin descripción',
        category: p.category || 'Otros',
        price: Number(p.price) || 0,
        special_price: Number(p.price) || 0,
        sizes: ['Única'],
        sizeDetails: [{ size: 'Única', price: Number(p.price) || 0, stock_quantity: p.availability === 'in stock' ? 10 : 0 }],
        stock: p.availability === 'in stock' ? 'In stock' : 'Out of stock',
        image_url: p.image_url || null,
      };
    } catch (error) {
      console.error(`Error fetching product ${productId}:`, error.stack);
      throw error;
    }
  }

  static async searchProducts(searchTerm, animalCategory) {
    try {
      const products = await this.getCatalogProducts(animalCategory);
      return products.filter(p =>
        p.title.toLowerCase().includes(searchTerm) ||
        p.description.toLowerCase().includes(searchTerm) ||
        p.category.toLowerCase().includes(searchTerm)
      ).slice(0, 10);
    } catch (error) {
      console.error(`Error searching products for ${searchTerm}:`, error.stack);
      throw error;
    }
  }
}

module.exports = ProductService;