const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { pool } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const {
  uploadProductImage,
  deleteCloudinaryImage,
  extractPublicId,
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE,
} = require('../services/cloudinary');

const JWT_SECRET = process.env.JWT_SECRET || 'izha-blooms-secret-key-2026-production';

function adminAuthOrLocal(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (decoded && (decoded.role === 'admin' || decoded.role === 'SUPER_ADMIN' || decoded.role === 'SECONDARY_ADMIN' || decoded.isAdmin)) {
        req.user = decoded;
        return next();
      }
    } catch (_) {}
  }
  // Allow localhost / local dev requests from the Next.js frontend
  const origin = req.get('origin') || req.get('referer') || '';
  const host = req.get('host') || '';
  if (host.includes('localhost') || host.includes('127.0.0.1') || origin.includes('localhost') || origin.includes('127.0.0.1')) {
    req.user = { id: 'admin_local', role: 'SUPER_ADMIN' };
    return next();
  }
  return res.status(401).json({ success: false, message: 'Authentication required. No token provided.' });
}

// Multer memory storage configuration for direct Cloudinary uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE, // 10MB
  },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}. Allowed types: JPEG, PNG, WebP`));
    }
  },
});

function formatProduct(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    categorySlug: row.category_slug,
    color: row.color || 'Dusty Rose',
    price: Number(row.price),
    mrp: Number(row.mrp),
    stock: row.stock !== undefined && row.stock !== null ? Number(row.stock) : 15,
    inStock: (row.stock !== undefined && row.stock !== null ? Number(row.stock) : 15) > 0,
    sizes: typeof row.sizes === 'string' ? JSON.parse(row.sizes) : row.sizes || [],
    soldOutSizes: typeof row.sold_out_sizes === 'string' ? JSON.parse(row.sold_out_sizes) : row.sold_out_sizes || [],
    sizeChart: typeof row.size_chart === 'string' ? JSON.parse(row.size_chart) : (row.size_chart || []),
    image: row.image,
    imagePublicId: row.image_public_id || null,
    gallery: typeof row.gallery === 'string' ? JSON.parse(row.gallery) : row.gallery || [row.image],
    galleryPublicIds: typeof row.gallery_public_ids === 'string' ? JSON.parse(row.gallery_public_ids) : (row.gallery_public_ids || []),
    isNew: Boolean(row.is_new),
    newDays: row.new_days !== undefined && row.new_days !== null ? Number(row.new_days) : 30,
    popularity: row.popularity || 80,
    description: row.description || '',
    fabric: row.fabric || '',
    craft: row.craft || '',
    care: row.care || '',
    fit: row.fit || '',
    createdAt: row.created_at,
  };
}

/**
 * Process incoming images (handles base64 uploads, existing URLs, and Cloudinary public IDs)
 */
async function processProductImages({ name, id, image, gallery, existingImagePublicId, existingGalleryPublicIds = [] }) {
  let finalImage = image;
  let finalImagePublicId = existingImagePublicId || (image ? extractPublicId(image) : null);
  let finalGallery = Array.isArray(gallery) ? [...gallery] : (gallery ? [gallery] : []);
  let finalGalleryPublicIds = Array.isArray(existingGalleryPublicIds) ? [...existingGalleryPublicIds] : [];

  // 1. Process Main Image if it is base64
  if (typeof finalImage === 'string' && finalImage.startsWith('data:image/')) {
    try {
      const uploadRes = await uploadProductImage(finalImage, {
        type: 'main',
        productName: name,
        productId: id,
      });
      finalImage = uploadRes.secure_url;
      finalImagePublicId = uploadRes.public_id;
    } catch (err) {
      console.error('[Cloudinary] Failed to upload main image:', err);
    }
  } else if (typeof finalImage === 'string' && finalImage.includes('res.cloudinary.com')) {
    finalImagePublicId = extractPublicId(finalImage) || finalImagePublicId;
  }

  // 2. Process Gallery Images
  const processedGallery = [];
  const processedGalleryIds = [];

  for (let i = 0; i < finalGallery.length; i++) {
    const item = finalGallery[i];
    if (typeof item === 'string' && item.startsWith('data:image/')) {
      try {
        const uploadRes = await uploadProductImage(item, {
          type: 'gallery',
          productName: name,
          productId: `${id}_g${i + 1}`,
        });
        processedGallery.push(uploadRes.secure_url);
        processedGalleryIds.push(uploadRes.public_id);
      } catch (err) {
        console.error(`[Cloudinary] Failed to upload gallery image [${i}]:`, err);
        processedGallery.push(item);
      }
    } else {
      processedGallery.push(item);
      const pubId = typeof item === 'string' ? extractPublicId(item) : null;
      if (pubId) {
        processedGalleryIds.push(pubId);
      } else if (finalGalleryPublicIds[i]) {
        processedGalleryIds.push(finalGalleryPublicIds[i]);
      }
    }
  }

  // If gallery was empty, default to main image
  if (processedGallery.length === 0 && finalImage) {
    processedGallery.push(finalImage);
    if (finalImagePublicId) processedGalleryIds.push(finalImagePublicId);
  }

  return {
    image: finalImage,
    imagePublicId: finalImagePublicId,
    gallery: processedGallery,
    galleryPublicIds: processedGalleryIds,
  };
}

// POST /api/products/upload-images - Dedicated Multer endpoint for admin image uploads
router.post('/upload-images', adminAuthOrLocal, (req, res, next) => {
  upload.array('images', 5)(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ success: false, message: 'File size exceeds 10MB limit.' });
      }
      return res.status(400).json({ success: false, message: err.message });
    } else if (err) {
      return res.status(400).json({ success: false, message: err.message });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, message: 'No image files provided.' });
    }

    const { productName, productId, type } = req.body;
    const uploadPromises = req.files.map((file, index) => {
      const isMain = index === 0 && (!type || type === 'main');
      return uploadProductImage(file.buffer, {
        type: isMain ? 'main' : 'gallery',
        productName: productName || 'izha-blooms',
        productId: productId || undefined,
      });
    });

    const results = await Promise.all(uploadPromises);
    res.json({
      success: true,
      images: results,
      url: results[0].secure_url,
      secure_url: results[0].secure_url,
      public_id: results[0].public_id,
    });
  } catch (err) {
    console.error('Image upload error:', err);
    res.status(500).json({ success: false, message: err.message || 'Failed to upload images to Cloudinary.' });
  }
});

// GET /api/products - list all products with optional filters
router.get('/', async (req, res) => {
  try {
    const { category, search, sort, isNew, limit, page } = req.query;
    let query = 'SELECT * FROM products WHERE 1=1';
    const params = [];

    if (category) {
      query += ' AND (category = ? OR category_slug = ?)';
      params.push(category, category);
    }

    if (isNew === 'true') {
      query += ' AND is_new = TRUE';
    }

    if (search) {
      query += ' AND (name LIKE ? OR category LIKE ? OR fabric LIKE ? OR craft LIKE ? OR description LIKE ?)';
      const term = `%${search}%`;
      params.push(term, term, term, term, term);
    }

    // Sorting
    if (sort === 'low') {
      query += ' ORDER BY price ASC';
    } else if (sort === 'high') {
      query += ' ORDER BY price DESC';
    } else if (sort === 'new') {
      query += ' ORDER BY is_new DESC, created_at DESC';
    } else if (sort === 'discount') {
      query += ' ORDER BY ((mrp - price) / mrp) DESC';
    } else {
      query += ' ORDER BY popularity DESC';
    }

    const [rows] = await pool.execute(query, params);
    const products = rows.map(formatProduct);

    // Pagination if requested
    const pageSize = Number(limit) || 0;
    const pageNum = Number(page) || 1;

    if (pageSize > 0) {
      const startIndex = (pageNum - 1) * pageSize;
      const paginated = products.slice(startIndex, startIndex + pageSize);
      return res.json({
        success: true,
        total: products.length,
        totalPages: Math.ceil(products.length / pageSize),
        page: pageNum,
        pageSize,
        products: paginated,
      });
    }

    res.json({
      success: true,
      total: products.length,
      products,
    });
  } catch (err) {
    console.error('Fetch products error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch products.' });
  }
});

// GET /api/products/:id - single product
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM products WHERE id = ?', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    const product = formatProduct(rows[0]);

    // Fetch reviews for this product
    const [reviews] = await pool.execute(
      'SELECT id, name, place, rating, date, text FROM reviews WHERE product_id = ? ORDER BY created_at DESC',
      [req.params.id]
    );

    product.reviews = reviews;
    res.json({ success: true, product });
  } catch (err) {
    console.error('Product detail error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch product details.' });
  }
});

// POST /api/products - Admin create product
router.post('/', adminAuthOrLocal, async (req, res) => {
  try {
    const p = req.body;
    const id = p.id || `p_${Date.now()}`;
    const slug = (p.categorySlug || p.category || 'dresses').toLowerCase().replace(/\s+/g, '-');

    const imageResult = await processProductImages({
      name: p.name || 'product',
      id,
      image: p.image || '/images/about.jpg',
      gallery: p.gallery || [p.image || '/images/about.jpg'],
    });

    await pool.execute(
      `INSERT INTO products (
        id, name, category, category_slug, color, price, mrp, stock, sizes, sold_out_sizes, size_chart,
        image, gallery, image_public_id, gallery_public_ids, is_new, new_days, popularity, description, fabric, craft, care, fit
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        p.name,
        p.category || 'Dresses',
        slug,
        p.color || 'Dusty Rose',
        p.price || 0,
        p.mrp || p.price || 0,
        p.stock !== undefined ? Math.max(0, Math.floor(Number(p.stock) || 0)) : 15,
        JSON.stringify(p.sizes || ['S', 'M', 'L', 'XL']),
        JSON.stringify(p.soldOutSizes || []),
        JSON.stringify(p.sizeChart || []),
        imageResult.image,
        JSON.stringify(imageResult.gallery),
        imageResult.imagePublicId || null,
        JSON.stringify(imageResult.galleryPublicIds || []),
        Boolean(p.isNew),
        Number(p.newDays) || 30,
        p.popularity || 80,
        p.description || '',
        p.fabric || '',
        p.craft || '',
        p.care || '',
        p.fit || '',
      ]
    );

    const [rows] = await pool.execute('SELECT * FROM products WHERE id = ?', [id]);
    res.status(201).json({ success: true, product: formatProduct(rows[0]) });
  } catch (err) {
    console.error('Create product error:', err);
    res.status(500).json({ success: false, message: 'Failed to create product.' });
  }
});

// PUT /api/products/:id - Admin update product
router.put('/:id', adminAuthOrLocal, async (req, res) => {
  try {
    const p = req.body;
    const [existingRows] = await pool.execute('SELECT * FROM products WHERE id = ?', [req.params.id]);
    if (existingRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }
    const existing = existingRows[0];
    const existingGallery = typeof existing.gallery === 'string' ? JSON.parse(existing.gallery) : (existing.gallery || []);
    const existingGalleryIds = typeof existing.gallery_public_ids === 'string' ? JSON.parse(existing.gallery_public_ids) : (existing.gallery_public_ids || []);

    let newImage = p.image !== undefined ? p.image : existing.image;
    let newGallery = p.gallery !== undefined ? p.gallery : existingGallery;

    const imageResult = await processProductImages({
      name: p.name || existing.name,
      id: req.params.id,
      image: newImage,
      gallery: newGallery,
      existingImagePublicId: existing.image_public_id,
      existingGalleryPublicIds: existingGalleryIds,
    });

    // Detect images to clean up from Cloudinary
    const toDeleteCloudinary = [];
    if (existing.image_public_id && imageResult.imagePublicId && existing.image_public_id !== imageResult.imagePublicId) {
      toDeleteCloudinary.push(existing.image_public_id);
    } else if (existing.image && existing.image.includes('res.cloudinary.com') && existing.image !== imageResult.image) {
      const oldPub = extractPublicId(existing.image);
      if (oldPub && oldPub !== imageResult.imagePublicId) {
        toDeleteCloudinary.push(oldPub);
      }
    }

    // If gallery images were removed, delete them
    const retainedGalleryPubIds = new Set(imageResult.galleryPublicIds || []);
    if (imageResult.imagePublicId) retainedGalleryPubIds.add(imageResult.imagePublicId);

    if (Array.isArray(existingGalleryIds)) {
      for (const oldPubId of existingGalleryIds) {
        if (oldPubId && !retainedGalleryPubIds.has(oldPubId)) {
          toDeleteCloudinary.push(oldPubId);
        }
      }
    }

    await pool.execute(
      `UPDATE products SET
        name = COALESCE(?, name),
        category = COALESCE(?, category),
        category_slug = COALESCE(?, category_slug),
        color = COALESCE(?, color),
        price = COALESCE(?, price),
        mrp = COALESCE(?, mrp),
        stock = COALESCE(?, stock),
        sizes = COALESCE(?, sizes),
        sold_out_sizes = COALESCE(?, sold_out_sizes),
        size_chart = COALESCE(?, size_chart),
        image = COALESCE(?, image),
        gallery = COALESCE(?, gallery),
        image_public_id = COALESCE(?, image_public_id),
        gallery_public_ids = COALESCE(?, gallery_public_ids),
        is_new = COALESCE(?, is_new),
        new_days = COALESCE(?, new_days),
        popularity = COALESCE(?, popularity),
        description = COALESCE(?, description),
        fabric = COALESCE(?, fabric),
        craft = COALESCE(?, craft),
        care = COALESCE(?, care),
        fit = COALESCE(?, fit)
      WHERE id = ?`,
      [
        p.name ?? null,
        p.category ?? null,
        p.categorySlug ?? null,
        p.color ?? null,
        p.price ?? null,
        p.mrp ?? null,
        p.stock !== undefined && p.stock !== null ? Math.max(0, Math.floor(Number(p.stock) || 0)) : null,
        p.sizes ? JSON.stringify(p.sizes) : null,
        p.soldOutSizes ? JSON.stringify(p.soldOutSizes) : null,
        p.sizeChart ? JSON.stringify(p.sizeChart) : null,
        p.image !== undefined ? imageResult.image : null,
        p.gallery !== undefined ? JSON.stringify(imageResult.gallery) : null,
        p.image !== undefined ? (imageResult.imagePublicId || null) : null,
        p.gallery !== undefined ? JSON.stringify(imageResult.galleryPublicIds || []) : null,
        p.isNew !== undefined ? Boolean(p.isNew) : null,
        p.newDays !== undefined ? Number(p.newDays) : null,
        p.popularity ?? null,
        p.description ?? null,
        p.fabric ?? null,
        p.craft ?? null,
        p.care ?? null,
        p.fit ?? null,
        req.params.id,
      ]
    );

    // Clean up replaced images asynchronously
    if (toDeleteCloudinary.length > 0) {
      Promise.allSettled(toDeleteCloudinary.map((pubId) => deleteCloudinaryImage(pubId))).catch((err) => {
        console.warn('[Cloudinary] Cleanup error during update:', err);
      });
    }

    const [rows] = await pool.execute('SELECT * FROM products WHERE id = ?', [req.params.id]);
    res.json({ success: true, product: formatProduct(rows[0]) });
  } catch (err) {
    console.error('Update product error:', err);
    res.status(500).json({ success: false, message: 'Failed to update product.' });
  }
});

// DELETE /api/products/:id - Admin delete product
router.delete('/:id', adminAuthOrLocal, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM products WHERE id = ?', [req.params.id]);
    if (rows.length > 0) {
      const prod = rows[0];
      const pubIdsToDelete = new Set();
      if (prod.image_public_id) pubIdsToDelete.add(prod.image_public_id);
      if (prod.image && prod.image.includes('res.cloudinary.com')) {
        const pub = extractPublicId(prod.image);
        if (pub) pubIdsToDelete.add(pub);
      }
      if (prod.gallery_public_ids) {
        try {
          const list = typeof prod.gallery_public_ids === 'string' ? JSON.parse(prod.gallery_public_ids) : prod.gallery_public_ids;
          if (Array.isArray(list)) list.forEach((id) => id && pubIdsToDelete.add(id));
        } catch (_) {}
      }
      if (prod.gallery) {
        try {
          const gList = typeof prod.gallery === 'string' ? JSON.parse(prod.gallery) : prod.gallery;
          if (Array.isArray(gList)) {
            gList.forEach((url) => {
              if (url && typeof url === 'string' && url.includes('res.cloudinary.com')) {
                const pub = extractPublicId(url);
                if (pub) pubIdsToDelete.add(pub);
              }
            });
          }
        } catch (_) {}
      }

      await pool.execute('DELETE FROM products WHERE id = ?', [req.params.id]);

      // Delete from Cloudinary
      if (pubIdsToDelete.size > 0) {
        Promise.allSettled(Array.from(pubIdsToDelete).map((pid) => deleteCloudinaryImage(pid))).catch((err) => {
          console.warn('[Cloudinary] Cleanup error during delete:', err);
        });
      }
    } else {
      await pool.execute('DELETE FROM products WHERE id = ?', [req.params.id]);
    }

    res.json({ success: true, message: 'Product deleted successfully.' });
  } catch (err) {
    console.error('Delete product error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete product.' });
  }
});

router.formatProduct = formatProduct;
module.exports = router;
