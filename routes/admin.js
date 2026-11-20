const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const {
  JWT_SECRET,
  authenticate,
  requireAdmin,
  requireManageAdminPermission,
  adminAuthOrLocal,
} = require('../middleware/auth');

// GET /api/admin/customers - List all customer accounts with aggregated orders & spent totals
router.get('/customers', adminAuthOrLocal, async (req, res) => {
  try {
    const [userRows] = await pool.execute(
      `SELECT id, name, email, phone, is_active, created_at FROM users WHERE role = 'customer' ORDER BY created_at DESC`
    );

    const [orderRows] = await pool.execute(
      `SELECT customer_email, customer_phone, customer_name, shipping_address, total, created_at, status FROM orders WHERE status NOT IN ('Cancelled', 'Failed') ORDER BY created_at DESC`
    );

    // Compute orders count and total spent per customer (by email and phone)
    const statsByEmail = new Map();
    const statsByPhone = new Map();
    const addressByCustomer = new Map();

    for (const ord of orderRows) {
      const email = (ord.customer_email || '').toLowerCase().trim();
      const phone = (ord.customer_phone || '').trim();
      const tot = Number(ord.total) || 0;

      let addr = null;
      try {
        addr = typeof ord.shipping_address === 'string' ? JSON.parse(ord.shipping_address) : ord.shipping_address;
      } catch (_) {}

      if (email && !email.includes('guest@') && !email.includes('unknown')) {
        const prev = statsByEmail.get(email) || { count: 0, spent: 0, name: ord.customer_name, phone };
        statsByEmail.set(email, {
          count: prev.count + 1,
          spent: prev.spent + tot,
          name: prev.name || ord.customer_name,
          phone: prev.phone || phone,
        });
        if (addr && !addressByCustomer.has(email)) addressByCustomer.set(email, addr);
      }

      if (phone) {
        const prev = statsByPhone.get(phone) || { count: 0, spent: 0, name: ord.customer_name, email };
        statsByPhone.set(phone, {
          count: prev.count + 1,
          spent: prev.spent + tot,
          name: prev.name || ord.customer_name,
          email: prev.email || email,
        });
        if (addr && !addressByCustomer.has(phone)) addressByCustomer.set(phone, addr);
      }
    }

    const customersMap = new Map();

    // 1. Registered customer accounts
    for (const u of userRows) {
      const email = (u.email || '').toLowerCase().trim();
      const phone = (u.phone || '').trim();
      const stat = statsByEmail.get(email) || statsByPhone.get(phone) || { count: 0, spent: 0 };
      const addr = addressByCustomer.get(email) || addressByCustomer.get(phone);

      customersMap.set(u.id, {
        id: u.id,
        name: u.name,
        email: u.email,
        phone: u.phone || stat.phone || '',
        city: addr?.city || 'Kerala',
        state: addr?.state || 'Kerala',
        pincode: addr?.pincode || '',
        address: addr?.line || addr?.address || '',
        ordersCount: stat.count,
        totalSpent: stat.spent,
        status: u.is_active !== 0 && u.is_active !== false ? 'Active' : 'Inactive',
        joinedAt: u.created_at ? new Date(u.created_at).toISOString().slice(0, 10) : 'Recent',
        source: 'Online',
      });
    }

    // 2. Customers from orders who may not be in users table
    for (const [email, stat] of statsByEmail.entries()) {
      const alreadyPresent = Array.from(customersMap.values()).some((c) => c.email.toLowerCase() === email);
      if (!alreadyPresent) {
        const addr = addressByCustomer.get(email);
        const custId = `cust_${email.replace(/[^a-zA-Z0-9]/g, '_')}`;
        customersMap.set(custId, {
          id: custId,
          name: stat.name || 'Customer',
          email,
          phone: stat.phone || '',
          city: addr?.city || 'Kerala',
          state: addr?.state || 'Kerala',
          pincode: addr?.pincode || '',
          address: addr?.line || addr?.address || '',
          ordersCount: stat.count,
          totalSpent: stat.spent,
          status: 'Active',
          joinedAt: 'Recent',
          source: 'Direct Order',
        });
      }
    }

    res.json({
      success: true,
      customers: Array.from(customersMap.values()),
    });
  } catch (err) {
    console.error('List customers error:', err);
    res.status(500).json({ success: false, message: 'Failed to list customers.' });
  }
});

// PUT /api/admin/customers/:id/status - Update customer active status
router.put('/customers/:id/status', adminAuthOrLocal, async (req, res) => {
  try {
    const { status, is_active } = req.body;
    const active = is_active !== undefined ? Boolean(is_active) : status === 'Active';
    await pool.execute('UPDATE users SET is_active = ? WHERE id = ? OR email = ?', [active, req.params.id, req.params.id]);
    res.json({ success: true, message: `Customer status updated to ${active ? 'Active' : 'Inactive'}.`, status: active ? 'Active' : 'Inactive' });
  } catch (err) {
    console.error('Update customer status error:', err);
    res.status(500).json({ success: false, message: 'Failed to update customer status.' });
  }
});

// DELETE /api/admin/customers/:id - Remove or deactivate customer
router.delete('/customers/:id', adminAuthOrLocal, async (req, res) => {
  try {
    const id = req.params.id;
    await pool.execute('DELETE FROM users WHERE id = ? OR email = ?', [id, id]);
    res.json({ success: true, message: 'Customer removed successfully.' });
  } catch (err) {
    console.error('Delete customer error:', err);
    res.status(500).json({ success: false, message: 'Failed to remove customer.' });
  }
});

// GET /api/admin/stats
router.get('/stats', adminAuthOrLocal, async (req, res) => {
  try {
    const [orderCountRows] = await pool.execute('SELECT COUNT(*) as totalOrders, COALESCE(SUM(total), 0) as totalRevenue FROM orders');
    const [pendingOrdersRows] = await pool.execute("SELECT COUNT(*) as pendingOrders FROM orders WHERE LOWER(status) IN ('pending', 'order placed', 'confirmed', 'processing', 'packed') OR (status NOT IN ('Delivered', 'Cancelled', 'Failed') AND status IS NOT NULL)");
    const [confirmedOrdersRows] = await pool.execute("SELECT COUNT(*) as confirmedOrders FROM orders WHERE status = 'Confirmed'");
    const [shippedOrdersRows] = await pool.execute("SELECT COUNT(*) as shippedOrders FROM orders WHERE status IN ('Shipped', 'Out for Delivery')");
    const [deliveredOrdersRows] = await pool.execute("SELECT COUNT(*) as deliveredOrders FROM orders WHERE status = 'Delivered'");
    const [cancelledOrdersRows] = await pool.execute("SELECT COUNT(*) as cancelledOrders FROM orders WHERE status IN ('Cancelled', 'Failed')");
    const [productCountRows] = await pool.execute('SELECT COUNT(*) as totalProducts FROM products');
    const [customerCountRows] = await pool.execute('SELECT COUNT(*) as totalCustomers FROM users WHERE role = "customer"');
    const [recentOrdersRows] = await pool.execute('SELECT * FROM orders ORDER BY created_at DESC LIMIT 5');

    const recentOrders = recentOrdersRows.map((r) => ({
      id: r.id,
      orderNumber: r.order_number,
      customerName: r.customer_name,
      total: Number(r.total),
      status: r.status,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : (r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString()),
    }));

    res.json({
      success: true,
      stats: {
        totalOrders: Number(orderCountRows[0].totalOrders || 0),
        totalRevenue: Number(orderCountRows[0].totalRevenue || 0),
        pendingOrders: Number(pendingOrdersRows[0].pendingOrders || 0),
        confirmedOrders: Number(confirmedOrdersRows[0].confirmedOrders || 0),
        shippedOrders: Number(shippedOrdersRows[0].shippedOrders || 0),
        deliveredOrders: Number(deliveredOrdersRows[0].deliveredOrders || 0),
        cancelledOrders: Number(cancelledOrdersRows[0].cancelledOrders || 0),
        totalProducts: Number(productCountRows[0].totalProducts || 0),
        totalCustomers: Number(customerCountRows[0].totalCustomers || 0),
        recentOrders,
      },
    });
  } catch (err) {
    console.error('Admin stats error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch admin stats.' });
  }
});

// GET /api/admin/admins - List all administrators
router.get('/admins', adminAuthOrLocal, async (req, res) => {
  try {
    const [admins] = await pool.execute(
      `SELECT id, name, email, phone, role, is_super_admin, can_manage_admins, is_active, created_by, created_at
       FROM users WHERE role = 'admin' ORDER BY is_super_admin DESC, created_at ASC`
    );

    const mapped = admins.map((a) => ({
      ...a,
      role: (a.email === 'admin@izhablooms.com' || a.id === 'admin-1' || a.is_super_admin) ? 'SUPER_ADMIN' : 'SECONDARY_ADMIN',
      is_super_admin: Boolean(a.email === 'admin@izhablooms.com' || a.id === 'admin-1' || a.is_super_admin),
      can_manage_admins: Boolean(a.can_manage_admins || a.email === 'admin@izhablooms.com' || a.id === 'admin-1' || a.is_super_admin),
      is_active: Boolean(a.is_active !== 0 && a.is_active !== false),
      created_by: a.created_by || (a.is_super_admin ? 'Developer' : 'Main Admin'),
    }));

    res.json({
      success: true,
      admins: mapped,
      currentAdminPermissions: {
        is_super_admin: Boolean(req.user?.is_super_admin || req.user?.role === 'SUPER_ADMIN'),
        can_manage_admins: true,
      },
    });
  } catch (err) {
    console.error('List admins error:', err);
    res.status(500).json({ success: false, message: 'Failed to list administrators.' });
  }
});

// POST /api/admin/admins - Add new secondary administrator
router.post('/admins', adminAuthOrLocal, async (req, res) => {
  try {
    const { name, email, password, phone, can_manage_admins } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide full name, email and password for the new admin.',
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long.',
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address.',
      });
    }

    // Check if user already exists
    const [existing] = await pool.execute(`SELECT id FROM users WHERE email = ?`, [normalizedEmail]);
    if (existing.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'An account with this email address already exists.',
      });
    }

    const grantAdminManage = Boolean(can_manage_admins);

    const adminId = `admin_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const passwordHash = await bcrypt.hash(password, 10);
    const creatorEmail = req.user?.email || 'Main Admin';

    // Secondary admins can NEVER be created as Super Admin
    await pool.execute(
      `INSERT INTO users (id, name, email, phone, password_hash, role, is_super_admin, can_manage_admins, is_active, created_by)
       VALUES (?, ?, ?, ?, ?, 'admin', FALSE, ?, TRUE, ?)`,
      [adminId, name.trim(), normalizedEmail, phone ? phone.trim() : null, passwordHash, grantAdminManage, creatorEmail]
    );

    res.status(201).json({
      success: true,
      message: `Secondary Administrator "${name.trim()}" created successfully.`,
      admin: {
        id: adminId,
        name: name.trim(),
        email: normalizedEmail,
        phone: phone ? phone.trim() : null,
        role: 'SECONDARY_ADMIN',
        is_super_admin: false,
        can_manage_admins: grantAdminManage,
        is_active: true,
        created_by: creatorEmail,
      },
    });
  } catch (err) {
    console.error('Create admin error:', err);
    res.status(500).json({ success: false, message: 'Failed to create administrator.' });
  }
});

// PUT /api/admin/admins/:id/permissions - Toggle/set permission
router.put('/admins/:id/permissions', adminAuthOrLocal, async (req, res) => {
  try {
    const { can_manage_admins } = req.body;
    const targetId = req.params.id;

    // Check target admin
    const [targetRows] = await pool.execute(
      `SELECT id, name, email, is_super_admin, can_manage_admins, created_by FROM users WHERE id = ?`,
      [targetId]
    );

    if (targetRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Target administrator not found.' });
    }

    const targetAdmin = targetRows[0];

    // Main Admin privileges can NEVER be altered
    if (targetAdmin.email === 'admin@izhablooms.com' || targetAdmin.id === 'admin-1') {
      return res.status(400).json({
        success: false,
        message: 'Cannot modify privileges of the Main Administrator (Super Admin).',
      });
    }

    const updatedValue = Boolean(can_manage_admins);
    await pool.execute(`UPDATE users SET can_manage_admins = ? WHERE id = ?`, [updatedValue, targetId]);

    res.json({
      success: true,
      message: `Permission updated. Administrator can ${updatedValue ? 'now' : 'no longer'} add other administrators.`,
      can_manage_admins: updatedValue,
    });
  } catch (err) {
    console.error('Update admin permissions error:', err);
    res.status(500).json({ success: false, message: 'Failed to update admin permissions.' });
  }
});

// PUT /api/admin/admins/:id/status - Activate / Deactivate secondary admin
router.put('/admins/:id/status', adminAuthOrLocal, async (req, res) => {
  try {
    const targetId = req.params.id;
    const { is_active } = req.body;

    const [targetRows] = await pool.execute(
      `SELECT id, email, is_super_admin, is_active FROM users WHERE id = ?`,
      [targetId]
    );

    if (targetRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Administrator not found.' });
    }

    const target = targetRows[0];
    if (target.email === 'admin@izhablooms.com' || target.id === 'admin-1') {
      return res.status(400).json({ success: false, message: 'Cannot deactivate the Main Administrator.' });
    }

    if (req.user?.id && targetId === req.user.id) {
      return res.status(400).json({ success: false, message: 'You cannot deactivate your own account.' });
    }

    const newActiveState = Boolean(is_active);
    await pool.execute(`UPDATE users SET is_active = ? WHERE id = ?`, [newActiveState, targetId]);

    res.json({
      success: true,
      message: `Administrator account ${newActiveState ? 'activated' : 'deactivated'} successfully.`,
      is_active: newActiveState,
    });
  } catch (err) {
    console.error('Update admin status error:', err);
    res.status(500).json({ success: false, message: 'Failed to update administrator status.' });
  }
});

// DELETE /api/admin/admins/:id - Remove secondary administrator
router.delete('/admins/:id', adminAuthOrLocal, async (req, res) => {
  try {
    const targetId = req.params.id;
    if (req.user?.id && targetId === req.user.id) {
      return res.status(400).json({ success: false, message: 'You cannot remove your own administrator account.' });
    }

    const [targetRows] = await pool.execute(`SELECT id, email, is_super_admin, created_by FROM users WHERE id = ?`, [targetId]);
    if (targetRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Administrator not found.' });
    }

    if (targetRows[0].email === 'admin@izhablooms.com' || targetRows[0].id === 'admin-1') {
      return res.status(400).json({ success: false, message: 'Cannot delete the Main Administrator.' });
    }

    await pool.execute(`DELETE FROM users WHERE id = ?`, [targetId]);

    res.json({ success: true, message: 'Administrator removed successfully.' });
  } catch (err) {
    console.error('Delete admin error:', err);
    res.status(500).json({ success: false, message: 'Failed to remove administrator.' });
  }
});

// PUT /api/admin/profile - Update current admin's email and details with password verification
router.put('/profile', authenticate, requireAdmin, async (req, res) => {
  try {
    const { name, email, phone, location, bio, currentPassword } = req.body;
    const adminId = req.user.id;

    // Fetch existing user record
    const [userRows] = await pool.execute(`SELECT * FROM users WHERE id = ?`, [adminId]);
    if (userRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Administrator not found.' });
    }
    const user = userRows[0];

    // If changing email, strictly require current password verification!
    if (email && email.trim().toLowerCase() !== user.email.toLowerCase()) {
      if (!currentPassword) {
        return res.status(400).json({
          success: false,
          message: 'Please enter your current password to verify your identity before changing your official email.',
        });
      }

      const passwordMatch = await bcrypt.compare(currentPassword, user.password_hash);
      if (!passwordMatch) {
        return res.status(401).json({
          success: false,
          message: 'Current password verification failed. Email was not changed.',
        });
      }

      const normalizedEmail = email.trim().toLowerCase();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(normalizedEmail)) {
        return res.status(400).json({ success: false, message: 'Please provide a valid email address.' });
      }

      // Ensure new email is unique
      const [existing] = await pool.execute(`SELECT id FROM users WHERE email = ? AND id != ?`, [normalizedEmail, adminId]);
      if (existing.length > 0) {
        return res.status(409).json({ success: false, message: 'This email is already in use by another account.' });
      }

      await pool.execute(
        `UPDATE users SET email = ?, name = COALESCE(?, name), phone = COALESCE(?, phone) WHERE id = ?`,
        [normalizedEmail, name ? name.trim() : null, phone ? phone.trim() : null, adminId]
      );
    } else {
      await pool.execute(
        `UPDATE users SET name = COALESCE(?, name), phone = COALESCE(?, phone) WHERE id = ?`,
        [name ? name.trim() : null, phone ? phone.trim() : null, adminId]
      );
    }

    // Also persist extended studio bio in site_settings
    if (location || bio) {
      const studioData = { location, bio };
      await pool.execute(
        `INSERT INTO site_settings (key_name, data) VALUES ('admin_studio_bio', ?)
         ON DUPLICATE KEY UPDATE data = VALUES(data)`,
        [JSON.stringify(studioData)]
      );
    }

    // Fetch updated user
    const [updatedRows] = await pool.execute(
      `SELECT id, name, email, phone, role, is_super_admin, can_manage_admins, is_active FROM users WHERE id = ?`,
      [adminId]
    );

    const updatedUser = updatedRows[0];
    const userPayload = {
      id: updatedUser.id,
      name: updatedUser.name,
      email: updatedUser.email,
      phone: updatedUser.phone,
      role: updatedUser.role,
      is_super_admin: Boolean(updatedUser.is_super_admin),
      can_manage_admins: Boolean(updatedUser.can_manage_admins),
      is_active: Boolean(updatedUser.is_active !== 0 && updatedUser.is_active !== false),
    };

    const token = jwt.sign(userPayload, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      success: true,
      message: 'Admin profile updated successfully.',
      user: userPayload,
      token,
    });
  } catch (err) {
    console.error('Update admin profile error:', err);
    res.status(500).json({ success: false, message: 'Failed to update admin profile.' });
  }
});

// PUT /api/admin/change-password - Change admin password
router.put('/change-password', authenticate, requireAdmin, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'Please provide both current and new password.' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'New password must be at least 6 characters long.' });
    }

    const [userRows] = await pool.execute(`SELECT password_hash FROM users WHERE id = ?`, [req.user.id]);
    if (userRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Administrator account not found.' });
    }

    const matches = await bcrypt.compare(currentPassword, userRows[0].password_hash);
    if (!matches) {
      return res.status(400).json({ success: false, message: 'Current password is incorrect.' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await pool.execute(`UPDATE users SET password_hash = ? WHERE id = ?`, [newHash, req.user.id]);

    res.json({ success: true, message: 'Admin password updated successfully.' });
  } catch (err) {
    console.error('Change admin password error:', err);
    res.status(500).json({ success: false, message: 'Failed to change admin password.' });
  }
});

module.exports = router;
