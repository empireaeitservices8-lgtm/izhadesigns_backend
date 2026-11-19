const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authenticate, requireAdmin, adminAuthOrLocal } = require('../middleware/auth');

// GET /api/content/:key
router.get('/:key', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT data FROM site_settings WHERE key_name = ?', [req.params.key]);
    if (rows.length === 0) {
      return res.json({ success: true, key: req.params.key, data: null });
    }
    const data = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
    res.json({ success: true, key: req.params.key, data });
  } catch (err) {
    console.error('Fetch content error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch content.' });
  }
});

// PUT /api/content/:key - Admin update site content
router.put('/:key', adminAuthOrLocal, async (req, res) => {
  try {
    const { data } = req.body;
    if (data === undefined) {
      return res.status(400).json({ success: false, message: 'Data payload is required.' });
    }

    const jsonStr = JSON.stringify(data);
    await pool.execute(
      `INSERT INTO site_settings (key_name, data) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE data = VALUES(data)`,
      [req.params.key, jsonStr]
    );

    res.json({ success: true, key: req.params.key, message: 'Content saved successfully.' });
  } catch (err) {
    console.error('Update content error:', err);
    res.status(500).json({ success: false, message: 'Failed to save content.' });
  }
});

module.exports = router;

