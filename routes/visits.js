const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// GET /api/visits - Get visitor funnel events for reports
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, session_id as sessionId, type, page, product_name as productName, customer_name as customerName, created_at as at FROM visit_events ORDER BY created_at DESC LIMIT 1000'
    );

    // Merge actual orders from database so customer reports reflect real purchases (strictly completed/placed orders)
    const [orderRows] = await pool.execute(
      "SELECT id, order_number, customer_name, items, created_at, status FROM orders WHERE status NOT IN ('Cancelled', 'Failed') ORDER BY created_at DESC"
    );

    const orderEvents = [];
    for (const ord of orderRows) {
      let items = [];
      try {
        items = typeof ord.items === 'string' ? JSON.parse(ord.items) : ord.items;
      } catch (_) {}
      const prodName = Array.isArray(items) && items.length > 0 ? items.map((it) => it.name).join(', ') : 'Izha Order';
      const atIso = ord.created_at instanceof Date ? ord.created_at.toISOString() : (ord.created_at ? new Date(ord.created_at).toISOString() : new Date().toISOString());

      const orderSessionId = `sess_ord_${ord.order_number || ord.id}`;
      const alreadyHas = rows.some((r) => r.id === `ord_ev_${ord.id}` || r.sessionId === orderSessionId);
      if (!alreadyHas) {
        orderEvents.push({
          id: `ord_ev_${ord.id}`,
          sessionId: orderSessionId,
          type: 'order_placed',
          page: '/checkout',
          productName: prodName,
          customerName: ord.customer_name || 'Customer',
          at: atIso,
        });
      }
    }

    const combined = [...rows, ...orderEvents].sort((a, b) => new Date(b.at) - new Date(a.at));
    res.json({ success: true, events: combined });
  } catch (err) {
    console.error('Fetch visits error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch visit events.' });
  }
});

// POST /api/visits - Record a visitor funnel event
router.post('/', async (req, res) => {
  try {
    const { id, sessionId, type, page, productName, customerName } = req.body;
    if (!sessionId || !type) {
      return res.status(400).json({ success: false, message: 'sessionId and type are required.' });
    }

    const eventId = id || `ev_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    await pool.execute(
      `INSERT INTO visit_events (id, session_id, type, page, product_name, customer_name)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        eventId,
        sessionId,
        type,
        page || null,
        productName || null,
        customerName || null,
      ]
    );

    res.status(201).json({ success: true, message: 'Visit event recorded.' });
  } catch (err) {
    console.error('Record visit error:', err);
    res.status(500).json({ success: false, message: 'Failed to record visit event.' });
  }
});

module.exports = router;
