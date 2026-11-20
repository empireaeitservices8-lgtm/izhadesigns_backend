const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const { optionalAuth, authenticate, requireAdmin } = require('../middleware/auth');
const productsRoute = require('./products');
const { calculateDeliveryFee, DEFAULT_DELIVERY_SETTINGS } = require('./delivery');
const emailService = require('../services/email');

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

function formatOrder(row) {
  if (!row) return null;
  return {
    id: row.id,
    orderNumber: row.order_number,
    customerId: row.customer_id || null,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    customerPhone: row.customer_phone,
    shippingAddress: typeof row.shipping_address === 'string' ? JSON.parse(row.shipping_address) : row.shipping_address,
    items: typeof row.items === 'string' ? JSON.parse(row.items) : row.items,
    subtotal: Number(row.subtotal),
    discount: Number(row.discount || 0),
    shippingFee: Number(row.shipping_fee || 0),
    total: Number(row.total),
    couponCode: row.coupon_code || null,
    couponDiscount: Number(row.coupon_discount || 0),
    status: row.status,
    statusHistory: typeof row.status_history === 'string' ? JSON.parse(row.status_history) : (row.status_history || []),
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status,
    trackingNumber: row.tracking_number,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : (row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString()),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : (row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString()),
  };
}

function formatGuestTrackOrder(row) {
  if (!row) return null;
  const rawAddr = typeof row.shipping_address === 'string' ? JSON.parse(row.shipping_address) : (row.shipping_address || {});
  const rawItems = typeof row.items === 'string' ? JSON.parse(row.items) : (row.items || []);
  const statusHistory = typeof row.status_history === 'string' ? JSON.parse(row.status_history) : (row.status_history || []);

  // Privacy-conscious address & customer formatting
  const nameParts = (row.customer_name || 'Customer').trim().split(/\s+/);
  const maskedName = nameParts.length > 1
    ? `${nameParts[0]} ${nameParts.slice(1).map(p => (p ? p[0] + '***' : '')).join(' ')}`.trim()
    : (nameParts[0].length > 3 ? `${nameParts[0].slice(0, 3)}***` : nameParts[0]);

  const rawPhone = (row.customer_phone || '').trim();
  const digits = rawPhone.replace(/\D/g, '');
  const maskedPhone = digits.length >= 10
    ? `••••••${digits.slice(-4)}`
    : (rawPhone.length > 4 ? `••••${rawPhone.slice(-4)}` : '••••');

  const rawLine = rawAddr.line || rawAddr.address || '';
  const maskedLine = rawLine.length > 10 ? `${rawLine.slice(0, 8)}... (confidential)` : (rawLine ? `${rawLine.slice(0, 4)}...` : '');

  const safeAddress = {
    city: rawAddr.city || '',
    state: rawAddr.state || '',
    pincode: rawAddr.pincode || '',
    maskedLine,
    displayArea: [rawAddr.city, rawAddr.state, rawAddr.pincode].filter(Boolean).join(', '),
  };

  const safeItems = rawItems.map(item => ({
    id: item.id,
    name: item.name,
    image: item.image,
    size: item.size,
    qty: Number(item.qty) || 1,
    price: Number(item.price) || 0,
    total: (Number(item.price) || 0) * (Number(item.qty) || 1),
  }));

  return {
    orderNumber: row.order_number || row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    customerName: maskedName,
    customerPhone: maskedPhone,
    shippingAddress: safeAddress,
    items: safeItems,
    subtotal: Number(row.subtotal),
    discount: Number(row.discount || 0),
    shippingFee: Number(row.shipping_fee || 0),
    total: Number(row.total),
    status: row.status || 'Order Placed',
    statusHistory,
    paymentMethod: row.payment_method || 'COD',
    paymentStatus: row.payment_status || 'Pending',
    trackingNumber: row.tracking_number || null,
  };
}

// In-memory rate limiting map for guest tracking lookups
const trackingRateMap = new Map();
function checkTrackingRateLimit(ip) {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000; // 10 minutes
  const maxAttempts = 25; // 25 queries per window
  const record = trackingRateMap.get(ip);
  if (!record || now - record.startTime > windowMs) {
    trackingRateMap.set(ip, { count: 1, startTime: now });
    return true;
  }
  if (record.count >= maxAttempts) {
    return false;
  }
  record.count += 1;
  return true;
}

// GET /api/orders - list orders (admin views all with filters, customer views only their own verified orders)
router.get('/', optionalAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  try {
    const { search, admin, my_orders } = req.query;
    let query = 'SELECT * FROM orders WHERE 1=1';
    const params = [];

    const origin = req.get('origin') || req.get('referer') || '';
    const host = req.get('host') || '';
    const isLocal = host.includes('localhost') || host.includes('127.0.0.1') || origin.includes('localhost') || origin.includes('127.0.0.1');
    const isRefererAdmin = origin.includes('/admin') || (req.get('referer') || '').includes('/admin');
    const isAdminHeader = req.get('x-admin-request') === 'true' || admin === 'true';

    const isRealAdmin = req.user && (
      req.user.role === 'admin' ||
      req.user.role === 'SUPER_ADMIN' ||
      req.user.role === 'SECONDARY_ADMIN' ||
      req.user.isAdmin === true
    );

    // Administrative access: strictly when authenticated as admin or from dedicated local admin panel
    const allowAdminView = (isRealAdmin || (isLocal && isRefererAdmin && isAdminHeader)) && !my_orders;

    if (allowAdminView) {
      if (search) {
        query += ' AND (order_number LIKE ? OR customer_name LIKE ? OR customer_email LIKE ? OR customer_phone LIKE ?)';
        const term = `%${search}%`;
        params.push(term, term, term, term);
      }
    } else if (req.user) {
      // Authenticated customer: retrieve verified identity from database
      const [uRows] = await pool.execute(
        'SELECT id, email, phone FROM users WHERE id = ? LIMIT 1',
        [req.user.id]
      );
      const verifiedId = uRows.length > 0 ? uRows[0].id : req.user.id;
      const verifiedEmail = uRows.length > 0 ? (uRows[0].email || '').toLowerCase().trim() : (req.user.email || '').toLowerCase().trim();
      const verifiedPhone = uRows.length > 0 ? (uRows[0].phone || '').trim() : (req.user.phone || '').trim();

      query += ' AND (customer_id = ? OR (customer_email = ? AND customer_email != "") OR (customer_phone = ? AND customer_phone != ""))';
      params.push(verifiedId, verifiedEmail, verifiedPhone);
    } else {
      // Unauthenticated non-admin callers cannot list orders
      return res.status(401).json({
        success: false,
        message: 'Authentication required. Please sign in to view your orders.',
      });
    }

    query += ' ORDER BY created_at DESC';
    const [rows] = await pool.execute(query, params);
    res.json({ success: true, orders: rows.map(formatOrder) });
  } catch (err) {
    console.error('Fetch orders error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch orders.' });
  }
});

// POST /api/orders/track - Easy guest order tracking by phone number (order ID is optional)
router.post('/track', async (req, res) => {
  try {
    const rawIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    const clientIp = String(rawIp).split(',')[0].trim();
    if (!checkTrackingRateLimit(clientIp)) {
      return res.status(429).json({
        success: false,
        message: 'Too many tracking attempts. Please wait a few minutes and try again.',
      });
    }

    const { phone, orderId } = req.body || {};
    const cleanPhone = String(phone || '').replace(/\D/g, '');
    const phoneSuffix = cleanPhone.slice(-10);

    if (!phoneSuffix || phoneSuffix.length < 10) {
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid 10-digit mobile number.',
      });
    }

    // Query orders matching phone suffix (last 10 digits)
    const [rows] = await pool.execute(
      `SELECT * FROM orders 
       WHERE REPLACE(REPLACE(REPLACE(customer_phone, ' ', ''), '-', ''), '+91', '') LIKE ? 
          OR customer_phone LIKE ? 
       ORDER BY created_at DESC LIMIT 20`,
      [`%${phoneSuffix}`, `%${phoneSuffix}`]
    );

    // In-memory filter to verify last 10 digits
    let matchedRows = rows.filter((r) => {
      const digits = (r.customer_phone || '').replace(/\D/g, '');
      return digits.endsWith(phoneSuffix);
    });

    if (matchedRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No orders found matching this mobile number.',
      });
    }

    // If an optional orderId was passed, prioritize it
    if (orderId && String(orderId).trim()) {
      const cleanOrderId = String(orderId).trim().toUpperCase();
      const specific = matchedRows.find(
        (r) =>
          (r.order_number && r.order_number.toUpperCase() === cleanOrderId) ||
          (r.id && r.id.toUpperCase() === cleanOrderId)
      );
      if (specific) {
        matchedRows = [specific, ...matchedRows.filter((r) => r !== specific)];
      }
    }

    const formattedOrders = matchedRows.map(formatGuestTrackOrder);

    res.json({
      success: true,
      orders: formattedOrders,
      order: formattedOrders[0],
      totalFound: formattedOrders.length,
    });
  } catch (err) {
    console.error('Guest tracking error:', err);
    res.status(500).json({
      success: false,
      message: 'Unable to look up orders right now. Please try again.',
    });
  }
});

// GET /api/orders/:id - get single order with strict customer ownership validation
router.get('/:id', optionalAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  try {
    const param = req.params.id;
    const [rows] = await pool.execute(
      'SELECT * FROM orders WHERE id = ? OR order_number = ? ORDER BY created_at DESC LIMIT 1',
      [param, param]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    const order = rows[0];

    // 1. Check if requester is Admin
    const origin = req.get('origin') || req.get('referer') || '';
    const host = req.get('host') || '';
    const isLocal = host.includes('localhost') || host.includes('127.0.0.1') || origin.includes('localhost') || origin.includes('127.0.0.1');
    const isRefererAdmin = origin.includes('/admin') || (req.get('referer') || '').includes('/admin');
    const isAdminHeader = req.get('x-admin-request') === 'true' || req.query.admin === 'true';

    const isRealAdmin = req.user && (
      req.user.role === 'admin' ||
      req.user.role === 'SUPER_ADMIN' ||
      req.user.role === 'SECONDARY_ADMIN' ||
      req.user.isAdmin === true
    );

    if (isRealAdmin || (isLocal && isRefererAdmin && isAdminHeader)) {
      return res.json({ success: true, order: formatOrder(order) });
    }

    // 2. Unauthenticated direct access is blocked (guests must use /api/orders/track with phone verification)
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required to view order details.',
      });
    }

    // 3. Strict customer ownership validation
    const [uRows] = await pool.execute(
      'SELECT id, email, phone FROM users WHERE id = ? LIMIT 1',
      [req.user.id]
    );
    const verifiedId = uRows.length > 0 ? uRows[0].id : req.user.id;
    const verifiedEmail = uRows.length > 0 ? (uRows[0].email || '').toLowerCase().trim() : (req.user.email || '').toLowerCase().trim();
    const verifiedPhone = uRows.length > 0 ? (uRows[0].phone || '').trim() : (req.user.phone || '').trim();

    const orderCustId = order.customer_id;
    const orderEmail = (order.customer_email || '').toLowerCase().trim();
    const orderPhone = (order.customer_phone || '').trim();

    const isOwner =
      (orderCustId && orderCustId === verifiedId) ||
      (orderEmail && verifiedEmail && orderEmail === verifiedEmail) ||
      (orderPhone && verifiedPhone && orderPhone === verifiedPhone);

    if (!isOwner) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to view this order.',
      });
    }

    res.json({ success: true, order: formatOrder(order) });
  } catch (err) {
    console.error('Fetch order detail error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch order.' });
  }
});

// POST /api/orders - Create new order (Checkout) with atomic inventory validation & reduction
router.post('/', optionalAuth, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const {
      customerName,
      customerEmail,
      customerPhone,
      shippingAddress,
      items,
      subtotal,
      discount,
      shippingFee,
      total,
      paymentMethod,
      couponCode,
    } = req.body;

    if (!customerName || !customerPhone || !items || !items.length || !shippingAddress) {
      connection.release();
      return res.status(400).json({ success: false, message: 'Incomplete order information provided.' });
    }

    await connection.beginTransaction();

    // 1. Mandatory Inventory Validation: Lock rows FOR UPDATE and verify stock
    for (const item of items) {
      const requestedQty = Number(item.qty) || 1;
      const productId = item.id;

      const [pRows] = await connection.execute(
        'SELECT id, name, stock FROM products WHERE id = ? FOR UPDATE',
        [productId]
      );

      if (pRows.length === 0) {
        // Fallback for mock/demo products not in the DB
        continue;
      }

      const currentStock = pRows[0].stock !== undefined && pRows[0].stock !== null ? Number(pRows[0].stock) : 15;
      const productName = pRows[0].name || item.name || 'This product';

      if (currentStock <= 0) {
        await connection.rollback();
        connection.release();
        return res.status(400).json({
          success: false,
          insufficientStock: true,
          productId,
          availableStock: 0,
          message: `Sorry! "${productName}" is currently out of stock.`,
        });
      }

      if (requestedQty > currentStock) {
        await connection.rollback();
        connection.release();
        return res.status(400).json({
          success: false,
          insufficientStock: true,
          productId,
          availableStock: currentStock,
          message: `Sorry! Only ${currentStock} unit${currentStock === 1 ? '' : 's'} of "${productName}" available in stock. Please update your cart quantity.`,
        });
      }

      // Deduct stock atomically
      await connection.execute(
        'UPDATE products SET stock = GREATEST(0, stock - ?) WHERE id = ?',
        [requestedQty, productId]
      );
    }

    // 2. Coupon Validation & Processing
    let couponDiscount = 0;
    let appliedCouponCode = null;

    if (couponCode && typeof couponCode === 'string' && couponCode.trim()) {
      const cleanCode = couponCode.trim().toUpperCase();
      const [cRows] = await connection.execute(
        'SELECT * FROM coupons WHERE UPPER(code) = ? FOR UPDATE',
        [cleanCode]
      );

      if (cRows.length === 0) {
        await connection.rollback();
        connection.release();
        return res.status(400).json({ success: false, message: 'Invalid coupon code.' });
      }

      const coupon = cRows[0];
      if (!coupon.active) {
        await connection.rollback();
        connection.release();
        return res.status(400).json({ success: false, message: 'This coupon is currently unavailable.' });
      }

      if (coupon.expiry) {
        const exp = new Date(`${coupon.expiry}T23:59:59`);
        if (!isNaN(exp.getTime()) && Date.now() > exp.getTime()) {
          await connection.rollback();
          connection.release();
          return res.status(400).json({ success: false, message: 'This coupon has expired.' });
        }
      }

      const orderSubtotal = Number(subtotal) || 0;
      if (orderSubtotal < Number(coupon.min_order || 0)) {
        await connection.rollback();
        connection.release();
        return res.status(400).json({
          success: false,
          message: `Minimum order of ₹${coupon.min_order} required for coupon ${coupon.code}.`,
        });
      }

      if (coupon.first_order_only) {
        const email = (customerEmail || '').trim();
        const phone = (customerPhone || '').trim();
        if (email || phone) {
          const [priorOrders] = await connection.execute(
            'SELECT id FROM orders WHERE (customer_email = ? AND customer_email != "") OR (customer_phone = ? AND customer_phone != "") LIMIT 1',
            [email, phone]
          );
          if (priorOrders.length > 0) {
            await connection.rollback();
            connection.release();
            return res.status(400).json({
              success: false,
              message: 'This coupon is available for first orders only.',
            });
          }
        }
      }

      if (coupon.type === 'percent') {
        couponDiscount = Math.round((orderSubtotal * Number(coupon.value)) / 100);
      } else {
        couponDiscount = Math.min(Number(coupon.value), orderSubtotal);
      }
      couponDiscount = Math.max(0, Math.min(couponDiscount, orderSubtotal));
      appliedCouponCode = coupon.code;

      // Increment coupon used count in database
      await connection.execute(
        'UPDATE coupons SET used_count = used_count + 1 WHERE id = ?',
        [coupon.id]
      );
    }

    // 3. Official Delivery Charge Recalculation (Strict Database Enforcement)
    let deliverySettings = DEFAULT_DELIVERY_SETTINGS;
    try {
      const [dsRows] = await connection.execute(
        'SELECT data FROM site_settings WHERE key_name = ?',
        ['delivery_settings']
      );
      if (dsRows.length > 0) {
        const parsed = typeof dsRows[0].data === 'string' ? JSON.parse(dsRows[0].data) : dsRows[0].data;
        deliverySettings = { ...DEFAULT_DELIVERY_SETTINGS, ...parsed };
      }
    } catch (_) {}

    const baseDiscount = Number(discount) || 0;
    const totalOrderDiscount = Math.max(baseDiscount, couponDiscount);
    const orderSubtotalAfterDiscount = Math.max(0, (Number(subtotal) || 0) - totalOrderDiscount);

    const deliveryCalc = calculateDeliveryFee(deliverySettings, {
      subtotal: orderSubtotalAfterDiscount,
      state: shippingAddress?.state || shippingAddress?.region || '',
      pincode: shippingAddress?.pincode || '',
    });

    const calculatedShippingFee = deliveryCalc.deliveryCharge;
    const finalCalculatedTotal = Math.max(
      0,
      orderSubtotalAfterDiscount + calculatedShippingFee
    );

    // 4. Insert Order Record
    const orderId = `ord_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    // Readable Order ID: IZH + YYYYMMDD + 3-digit sequence (e.g. IZH20261118001)
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const datePrefix = `IZH${yyyy}${mm}${dd}`;

    let nextSeq = 1;
    try {
      const [existingToday] = await connection.execute(
        'SELECT order_number FROM orders WHERE order_number LIKE ? ORDER BY order_number DESC LIMIT 1',
        [`${datePrefix}%`]
      );
      if (existingToday.length > 0 && existingToday[0].order_number) {
        const match = existingToday[0].order_number.match(new RegExp(`^${datePrefix}(\\d+)`));
        if (match && match[1]) {
          nextSeq = parseInt(match[1], 10) + 1;
        }
      }
    } catch (_) {}

    let orderNumber = `${datePrefix}${String(nextSeq).padStart(3, '0')}`;

    // Verify uniqueness
    const [dup] = await connection.execute(
      'SELECT id FROM orders WHERE order_number = ? LIMIT 1',
      [orderNumber]
    );
    if (dup.length > 0) {
      orderNumber = `${datePrefix}${String(nextSeq).padStart(3, '0')}-${Math.floor(100 + Math.random() * 900)}`;
    }

    const initialHistory = JSON.stringify([
      {
        status: 'Order Placed',
        timestamp: new Date().toISOString(),
        note: 'Order placed successfully by customer.',
      },
    ]);

    const authenticatedCustomerId = req.user?.id || null;

    await connection.execute(
      `INSERT INTO orders (
        id, order_number, customer_id, customer_name, customer_email, customer_phone,
        shipping_address, items, subtotal, discount, shipping_fee, total,
        status, status_history, payment_method, payment_status, coupon_code, coupon_discount, stock_deducted
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE)`,
      [
        orderId,
        orderNumber,
        authenticatedCustomerId,
        customerName.trim(),
        (customerEmail || '').trim(),
        customerPhone.trim(),
        JSON.stringify(shippingAddress),
        JSON.stringify(items),
        subtotal || 0,
        totalOrderDiscount,
        calculatedShippingFee,
        finalCalculatedTotal,
        'Order Placed',
        initialHistory,
        paymentMethod || 'COD',
        paymentMethod === 'COD' ? 'Pending' : 'Paid',
        appliedCouponCode,
        couponDiscount,
      ]
    );

    await connection.commit();
    connection.release();

    const [created] = await pool.execute('SELECT * FROM orders WHERE id = ?', [orderId]);
    const [allProducts] = await pool.execute('SELECT * FROM products');

    const fmt = productsRoute.formatProduct || ((p) => p);
    const placedOrder = formatOrder(created[0]);

    // Send order notification email ONLY to ADMIN_EMAIL after order is saved successfully
    try {
      await emailService.sendAdminNewOrderNotification(placedOrder);
    } catch (emailErr) {
      console.error('[EmailService] Admin new order notification error:', emailErr);
    }

    res.status(201).json({
      success: true,
      message: 'Order placed successfully!',
      order: placedOrder,
      updatedProducts: allProducts.map(fmt),
    });
  } catch (err) {
    await connection.rollback();
    connection.release();
    console.error('Create order error:', err);
    res.status(500).json({ success: false, message: 'Failed to place order.' });
  }
});

// PUT /api/orders/:id/status - Admin update order status with stock restoration / re-deduction
router.put('/:id/status', adminAuthOrLocal, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { status, trackingNumber, paymentStatus } = req.body;

    await connection.beginTransaction();

    const [existing] = await connection.execute(
      'SELECT * FROM orders WHERE id = ? OR order_number = ? LIMIT 1 FOR UPDATE',
      [req.params.id, req.params.id]
    );

    if (existing.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    const orderRow = existing[0];
    const prevStatus = orderRow.status;
    const stockDeducted = orderRow.stock_deducted !== 0 && orderRow.stock_deducted !== false;
    let newStockDeducted = stockDeducted;

    // Order Cancellation & Stock Restoration:
    // If status changed to 'Cancelled' and stock was deducted, restore stock exactly once
    if (status === 'Cancelled' && prevStatus !== 'Cancelled' && stockDeducted) {
      let items = [];
      try {
        items = typeof orderRow.items === 'string' ? JSON.parse(orderRow.items) : orderRow.items;
      } catch (_) {}

      for (const item of items) {
        if (item.id && item.qty) {
          await connection.execute(
            'UPDATE products SET stock = stock + ? WHERE id = ?',
            [Number(item.qty), item.id]
          );
        }
      }
      newStockDeducted = false;
    }
    // If status changed FROM 'Cancelled' back to an active status, re-deduct
    else if (status && status !== 'Cancelled' && prevStatus === 'Cancelled' && !stockDeducted) {
      let items = [];
      try {
        items = typeof orderRow.items === 'string' ? JSON.parse(orderRow.items) : orderRow.items;
      } catch (_) {}

      for (const item of items) {
        if (item.id && item.qty) {
          await connection.execute(
            'UPDATE products SET stock = GREATEST(0, stock - ?) WHERE id = ?',
            [Number(item.qty), item.id]
          );
        }
      }
      newStockDeducted = true;
    }

    let currentHistory = [];
    try {
      currentHistory = typeof orderRow.status_history === 'string' ? JSON.parse(orderRow.status_history) : (orderRow.status_history || []);
    } catch (_) {}

    if (status && status !== prevStatus) {
      currentHistory.push({
        status,
        timestamp: new Date().toISOString(),
        note: req.body.note || `Status updated to ${status} by admin`,
      });
    }

    await connection.execute(
      `UPDATE orders SET
        status = COALESCE(?, status),
        tracking_number = COALESCE(?, tracking_number),
        payment_status = COALESCE(?, payment_status),
        status_history = ?,
        stock_deducted = ?
      WHERE id = ? OR order_number = ?`,
      [status ?? null, trackingNumber ?? null, paymentStatus ?? null, JSON.stringify(currentHistory), newStockDeducted, req.params.id, req.params.id]
    );

    await connection.commit();
    connection.release();

    const [rows] = await pool.execute(
      'SELECT * FROM orders WHERE id = ? OR order_number = ?',
      [req.params.id, req.params.id]
    );

    const [allProducts] = await pool.execute('SELECT * FROM products');
    const fmt = productsRoute.formatProduct || ((p) => p);
    const updatedOrder = formatOrder(rows[0]);

    res.json({
      success: true,
      order: updatedOrder,
      updatedProducts: allProducts.map(fmt),
    });
  } catch (err) {
    await connection.rollback();
    connection.release();
    console.error('Update order status error:', err);
    res.status(500).json({ success: false, message: 'Failed to update order status.' });
  }
});

// DELETE /api/orders/:id - Admin delete order from database
router.delete('/:id', adminAuthOrLocal, async (req, res) => {
  try {
    const id = req.params.id;
    const [result] = await pool.execute(
      'DELETE FROM orders WHERE id = ? OR order_number = ?',
      [id, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Order not found in database.' });
    }

    res.json({ success: true, message: 'Order deleted successfully.' });
  } catch (err) {
    console.error('Delete order error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete order from database.' });
  }
});

module.exports = router;

