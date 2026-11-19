const jwt = require('jsonwebtoken');
const { pool } = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'izha-blooms-secret-key-2026-production';

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Authentication required. No token provided.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
  }
}

function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded;
    } catch (err) {
      // Ignore token error for optional auth
    }
  }
  next();
}

function isAdminUser(user) {
  if (!user) return false;
  return (
    user.role === 'admin' ||
    user.role === 'SUPER_ADMIN' ||
    user.role === 'SECONDARY_ADMIN' ||
    user.isAdmin === true
  );
}

async function requireAdmin(req, res, next) {
  if (!isAdminUser(req.user)) {
    return res.status(403).json({ success: false, message: 'Access denied. Administrator privileges required.' });
  }

  // Verify active status from database to enforce immediate deactivation/revocation
  try {
    const [rows] = await pool.execute('SELECT is_active, is_super_admin, can_manage_admins FROM users WHERE id = ?', [req.user.id]);
    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Admin account not found.' });
    }
    const admin = rows[0];
    if (admin.is_active === 0 || admin.is_active === false) {
      return res.status(403).json({ success: false, message: 'Account is inactive. Contact Main Admin.' });
    }
    req.user.is_super_admin = Boolean(admin.is_super_admin);
    req.user.can_manage_admins = Boolean(admin.can_manage_admins);
    next();
  } catch (err) {
    console.error('requireAdmin error:', err);
    return res.status(500).json({ success: false, message: 'Failed to verify admin status.' });
  }
}

// Live database verification for Admin Management permissions
async function requireManageAdminPermission(req, res, next) {
  if (!isAdminUser(req.user)) {
    return res.status(403).json({ success: false, message: 'Access denied. Administrator privileges required.' });
  }

  try {
    const [rows] = await pool.execute(
      'SELECT id, name, email, role, is_super_admin, can_manage_admins, is_active FROM users WHERE id = ?',
      [req.user.id]
    );

    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Admin user not found.' });
    }

    const admin = rows[0];
    if (admin.is_active === 0 || admin.is_active === false) {
      return res.status(403).json({ success: false, message: 'Account is inactive. Contact Main Admin.' });
    }

    const hasPermission = Boolean(admin.is_super_admin || admin.can_manage_admins);
    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to access Admin Management. Contact the Main Administrator.',
      });
    }

    req.user.is_super_admin = Boolean(admin.is_super_admin);
    req.user.can_manage_admins = Boolean(admin.can_manage_admins);
    req.liveAdmin = admin;
    next();
  } catch (err) {
    console.error('requireManageAdminPermission error:', err);
    return res.status(500).json({ success: false, message: 'Failed to verify admin management permissions.' });
  }
}

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
  // Allow localhost / local requests
  const origin = req.get('origin') || req.get('referer') || '';
  const host = req.get('host') || '';
  if (host.includes('localhost') || host.includes('127.0.0.1') || origin.includes('localhost') || origin.includes('127.0.0.1')) {
    req.user = { id: 'admin-1', email: 'admin@izhablooms.com', role: 'SUPER_ADMIN', is_super_admin: true, can_manage_admins: true };
    return next();
  }
  return res.status(401).json({ success: false, message: 'Authentication required. No token provided.' });
}

module.exports = {
  JWT_SECRET,
  authenticate,
  optionalAuth,
  requireAdmin,
  requireManageAdminPermission,
  adminAuthOrLocal,
};
