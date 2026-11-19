const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authenticate, requireAdmin, adminAuthOrLocal } = require('../middleware/auth');

function formatCoupon(row) {
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    type: row.type,
    value: Number(row.value),
    minOrder: Number(row.min_order),
    firstOrderOnly: Boolean(row.first_order_only),
    active: Boolean(row.active),
    expiry: row.expiry,
    usedCount: row.used_count || 0,
  };
}

function isCouponExpired(expiryStr) {
  if (!expiryStr) return false;
  // End of day (23:59:59) in local timezone
  const exp = new Date(`${expiryStr}T23:59:59`);
  return !isNaN(exp.getTime()) && Date.now() > exp.getTime();
}

// GET /api/coupons - list all coupons
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM coupons ORDER BY created_at DESC');
    res.json({ success: true, coupons: rows.map(formatCoupon) });
  } catch (err) {
    console.error('Fetch coupons error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch coupons.' });
  }
});

// POST /api/coupons/validate - Validate coupon for checkout
router.post('/validate', async (req, res) => {
  try {
    const { code, subtotal, customerEmail, customerPhone } = req.body;
    if (!code || !code.trim()) {
      return res.status(400).json({ success: false, message: 'Please enter a coupon code.' });
    }

    const cleanCode = code.trim().toUpperCase();
    const [rows] = await pool.execute(
      'SELECT * FROM coupons WHERE UPPER(code) = ? LIMIT 1',
      [cleanCode]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Invalid coupon code' });
    }

    const coupon = formatCoupon(rows[0]);

    if (!coupon.active) {
      return res.status(400).json({ success: false, message: 'This coupon is currently unavailable' });
    }

    if (isCouponExpired(coupon.expiry)) {
      return res.status(400).json({ success: false, message: 'This coupon has expired' });
    }

    const cartTotal = Number(subtotal) || 0;
    if (cartTotal < coupon.minOrder) {
      return res.status(400).json({
        success: false,
        message: `Minimum order of ₹${coupon.minOrder} required`,
      });
    }

    // Check first-order restriction against database
    if (coupon.firstOrderOnly) {
      const email = (customerEmail || '').trim();
      const phone = (customerPhone || '').trim();
      if (email || phone) {
        const [priorOrders] = await pool.execute(
          'SELECT id FROM orders WHERE (customer_email = ? AND customer_email != "") OR (customer_phone = ? AND customer_phone != "") LIMIT 1',
          [email, phone]
        );
        if (priorOrders.length > 0) {
          return res.status(400).json({
            success: false,
            message: 'This coupon is available for first orders only',
          });
        }
      }
    }

    // Calculate discount
    let discount = 0;
    if (coupon.type === 'percent') {
      discount = Math.round((cartTotal * coupon.value) / 100);
    } else {
      discount = Math.min(coupon.value, cartTotal);
    }
    discount = Math.max(0, Math.min(discount, cartTotal));

    res.json({
      success: true,
      valid: true,
      message: `${coupon.code} APPLIED!`,
      coupon,
      discount,
    });
  } catch (err) {
    console.error('Validate coupon error:', err);
    res.status(500).json({ success: false, message: 'Failed to validate coupon.' });
  }
});

// POST /api/coupons - Admin create coupon
router.post('/', adminAuthOrLocal, async (req, res) => {
  try {
    const { code, type, value, minOrder, firstOrderOnly, active, expiry } = req.body;
    const id = `cpn_${Date.now()}`;

    await pool.execute(
      `INSERT INTO coupons (id, code, type, value, min_order, first_order_only, active, expiry, used_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        id,
        (code || '').trim().toUpperCase(),
        type || 'percent',
        value || 10,
        minOrder || 0,
        Boolean(firstOrderOnly),
        active !== undefined ? Boolean(active) : true,
        expiry || '2026-12-31',
      ]
    );

    const [rows] = await pool.execute('SELECT * FROM coupons WHERE id = ?', [id]);
    res.status(201).json({ success: true, coupon: formatCoupon(rows[0]) });
  } catch (err) {
    console.error('Create coupon error:', err);
    res.status(500).json({ success: false, message: 'Failed to create coupon.' });
  }
});

// PUT /api/coupons/:id - Admin update coupon
router.put('/:id', adminAuthOrLocal, async (req, res) => {
  try {
    const { code, type, value, minOrder, firstOrderOnly, active, expiry } = req.body;

    await pool.execute(
      `UPDATE coupons SET
        code = COALESCE(?, code),
        type = COALESCE(?, type),
        value = COALESCE(?, value),
        min_order = COALESCE(?, min_order),
        first_order_only = COALESCE(?, first_order_only),
        active = COALESCE(?, active),
        expiry = COALESCE(?, expiry)
      WHERE id = ?`,
      [
        code ? code.trim().toUpperCase() : null,
        type ?? null,
        value ?? null,
        minOrder ?? null,
        firstOrderOnly !== undefined ? Boolean(firstOrderOnly) : null,
        active !== undefined ? Boolean(active) : null,
        expiry ?? null,
        req.params.id,
      ]
    );

    const [rows] = await pool.execute('SELECT * FROM coupons WHERE id = ?', [req.params.id]);
    res.json({ success: true, coupon: formatCoupon(rows[0]) });
  } catch (err) {
    console.error('Update coupon error:', err);
    res.status(500).json({ success: false, message: 'Failed to update coupon.' });
  }
});

// DELETE /api/coupons/:id - Admin delete coupon
router.delete('/:id', adminAuthOrLocal, async (req, res) => {
  try {
    await pool.execute('DELETE FROM coupons WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Coupon deleted successfully.' });
  } catch (err) {
    console.error('Delete coupon error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete coupon.' });
  }
});

module.exports = router;

