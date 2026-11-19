const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// GET /api/reviews
router.get('/', async (req, res) => {
  try {
    const { productId, featured } = req.query;
    let query = 'SELECT * FROM reviews WHERE 1=1';
    const params = [];

    if (productId) {
      query += ' AND product_id = ?';
      params.push(productId);
    }

    if (featured !== undefined) {
      query += ' AND featured = ?';
      params.push(featured === 'true' || featured === '1' ? 1 : 0);
    }

    query += ' ORDER BY created_at DESC';
    const [rows] = await pool.execute(query, params);
    res.json({ success: true, reviews: rows });
  } catch (err) {
    console.error('Fetch reviews error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch reviews.' });
  }
});

// GET /api/reviews/:productId - Fetch reviews by product ID
router.get('/:productId', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM reviews WHERE product_id = ? ORDER BY created_at DESC',
      [req.params.productId]
    );
    res.json({ success: true, reviews: rows });
  } catch (err) {
    console.error('Fetch product reviews error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch reviews.' });
  }
});

// POST /api/reviews - Submit a review
router.post('/', async (req, res) => {
  try {
    const { productId, name, place, rating, text, image, featured } = req.body;
    if (!name || !text) {
      return res.status(400).json({ success: false, message: 'Name and review text are required.' });
    }

    const id = `rev_${Date.now()}`;
    const dateStr = 'Just now';

    await pool.execute(
      `INSERT INTO reviews (id, product_id, name, place, rating, date, text, image, featured)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        productId || null,
        name.trim(),
        (place || 'Kerala').trim(),
        Number(rating) || 5,
        dateStr,
        text.trim(),
        image || null,
        Boolean(featured),
      ]
    );

    const [rows] = await pool.execute('SELECT * FROM reviews WHERE id = ?', [id]);
    res.status(201).json({ success: true, review: rows[0], message: 'Thank you for your review!' });
  } catch (err) {
    console.error('Submit review error:', err);
    res.status(500).json({ success: false, message: 'Failed to submit review.' });
  }
});

// PATCH /api/reviews/:id - Update review status (e.g. toggle featured on homepage)
router.patch('/:id', async (req, res) => {
  try {
    const { featured } = req.body;
    await pool.execute(
      'UPDATE reviews SET featured = ? WHERE id = ?',
      [Boolean(featured), req.params.id]
    );
    const [rows] = await pool.execute('SELECT * FROM reviews WHERE id = ?', [req.params.id]);
    res.json({ success: true, review: rows[0], message: 'Review updated successfully.' });
  } catch (err) {
    console.error('Update review error:', err);
    res.status(500).json({ success: false, message: 'Failed to update review.' });
  }
});

// PUT /api/reviews/:id - Update complete review details
router.put('/:id', async (req, res) => {
  try {
    const { name, place, rating, text, image, featured } = req.body;
    await pool.execute(
      `UPDATE reviews SET
        name = COALESCE(?, name),
        place = COALESCE(?, place),
        rating = COALESCE(?, rating),
        text = COALESCE(?, text),
        image = COALESCE(?, image),
        featured = COALESCE(?, featured)
       WHERE id = ?`,
      [
        name ? name.trim() : null,
        place ? place.trim() : null,
        rating !== undefined ? Number(rating) : null,
        text ? text.trim() : null,
        image ?? null,
        featured !== undefined ? Boolean(featured) : null,
        req.params.id,
      ]
    );
    const [rows] = await pool.execute('SELECT * FROM reviews WHERE id = ?', [req.params.id]);
    res.json({ success: true, review: rows[0], message: 'Review updated successfully.' });
  } catch (err) {
    console.error('Update review error:', err);
    res.status(500).json({ success: false, message: 'Failed to update review.' });
  }
});

// DELETE /api/reviews/:id - Remove a review
router.delete('/:id', async (req, res) => {
  try {
    await pool.execute('DELETE FROM reviews WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Review removed successfully.' });
  } catch (err) {
    console.error('Delete review error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete review.' });
  }
});

module.exports = router;

