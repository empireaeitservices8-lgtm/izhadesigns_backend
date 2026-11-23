const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authenticate, requireAdmin, adminAuthOrLocal } = require('../middleware/auth');

// GET /api/content/pages/all - Fetch all website managed pages
router.get('/pages/all', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      "SELECT key_name, data, updated_at FROM site_settings WHERE key_name LIKE 'page_%'"
    );
    const pages = {};
    for (const r of rows) {
      const parsed = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
      pages[r.key_name] = { data: parsed, updatedAt: r.updated_at };
    }
    res.json({ success: true, pages });
  } catch (err) {
    console.error('Fetch all pages error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch pages.' });
  }
});

// GET /api/content/:key
router.get('/:key', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT data, updated_at FROM site_settings WHERE key_name = ?', [req.params.key]);
    if (rows.length === 0) {
      return res.json({ success: true, key: req.params.key, data: null, value: null, updatedAt: null });
    }
    const data = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
    res.json({ success: true, key: req.params.key, data, value: data, updatedAt: rows[0].updated_at });
  } catch (err) {
    console.error('Fetch content error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch content.' });
  }
});

// PUT /api/content/:key - Admin update site content
router.put('/:key', adminAuthOrLocal, async (req, res) => {
  try {
    const data = req.body.data !== undefined ? req.body.data : req.body.value;
    if (data === undefined) {
      return res.status(400).json({ success: false, message: 'Data payload is required.' });
    }

    const jsonStr = JSON.stringify(data);
    await pool.execute(
      `INSERT INTO site_settings (key_name, data) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE data = VALUES(data), updated_at = CURRENT_TIMESTAMP`,
      [req.params.key, jsonStr]
    );

    res.json({ success: true, key: req.params.key, message: 'Content saved successfully.' });
  } catch (err) {
    console.error('Update content error:', err);
    res.status(500).json({ success: false, message: 'Failed to save content.' });
  }
});

module.exports = router;

