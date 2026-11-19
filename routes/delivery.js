const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { adminAuthOrLocal } = require('../middleware/auth');

const DEFAULT_DELIVERY_SETTINGS = {
  freeDeliveryEnabled: true,
  freeDeliveryScope: "min_amount",
  freeDeliveryMinAmount: 1499,
  coverage: "all_india",
  eligibleStates: [
    "Kerala",
    "Tamil Nadu",
    "Karnataka",
    "Andhra Pradesh",
    "Telangana",
    "Maharashtra",
    "Delhi",
  ],
  eligiblePincodes: [],
  standardDeliveryCharge: 79,
  enableRegionCharges: true,
  keralaDeliveryCharge: 0,
  outsideKeralaDeliveryCharge: 79,
  customFreeDeliveryNote: "",
};

function calculateDeliveryFee(settings, order) {
  const cfg = settings || DEFAULT_DELIVERY_SETTINGS;
  const cleanState = (order.state || "").trim().toLowerCase();
  const cleanPin = (order.pincode || "").trim();
  const subtotal = Math.max(0, Number(order.subtotal) || 0);

  const isKerala =
    cleanState === "kerala" ||
    cleanState.includes("kerala") ||
    /^6[7-9]\d{4}$/.test(cleanPin);

  // 1. Determine standard base charge for this region
  let baseCharge = Math.max(0, Number(cfg.standardDeliveryCharge) || 0);
  if (cfg.enableRegionCharges) {
    if (isKerala) {
      baseCharge = Math.max(0, Number(cfg.keralaDeliveryCharge) || 0);
    } else {
      baseCharge = Math.max(0, Number(cfg.outsideKeralaDeliveryCharge) || 0);
    }
  }

  // 2. Determine if the destination is eligible for Free Delivery
  let isEligibleRegion = false;
  if (!cfg.freeDeliveryEnabled) {
    isEligibleRegion = false;
  } else if (cfg.coverage === "all_india") {
    isEligibleRegion = true;
  } else if (cfg.coverage === "kerala_only") {
    isEligibleRegion = isKerala;
  } else if (cfg.coverage === "selected_states") {
    const stateList = (cfg.eligibleStates || []).map((s) => s.trim().toLowerCase());
    isEligibleRegion =
      stateList.some((s) => cleanState === s || cleanState.includes(s)) ||
      (stateList.includes("kerala") && isKerala);
  } else if (cfg.coverage === "custom_pincodes") {
    const pinList = (cfg.eligiblePincodes || []).map((p) => p.trim());
    isEligibleRegion = pinList.some((p) => p && cleanPin.startsWith(p));
  }

  // 3. Determine if the order meets the free delivery threshold
  let qualifiesForFreeDelivery = false;
  let amountNeeded = 0;
  let freeDeliveryMessage = "";

  if (isEligibleRegion) {
    const minAmount =
      cfg.freeDeliveryScope === "all_orders"
        ? 0
        : Math.max(0, Number(cfg.freeDeliveryMinAmount) || 0);

    if (minAmount === 0 || subtotal >= minAmount) {
      qualifiesForFreeDelivery = true;
      freeDeliveryMessage = cfg.customFreeDeliveryNote || "Free Delivery Unlocked!";
    } else {
      amountNeeded = minAmount - subtotal;
      freeDeliveryMessage = `Add ₹${amountNeeded.toLocaleString("en-IN")} more to qualify for free delivery.`;
    }
  }

  const finalDeliveryCharge = qualifiesForFreeDelivery ? 0 : baseCharge;

  return {
    deliveryCharge: finalDeliveryCharge,
    isFreeDelivery: qualifiesForFreeDelivery,
    isEligibleForFreeDelivery: isEligibleRegion,
    qualifiesForFreeDelivery,
    amountNeededForFreeDelivery: amountNeeded,
    freeDeliveryMessage,
    regionName: isKerala ? "Kerala" : order.state || "Rest of India",
  };
}

// GET /api/delivery-settings
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT data FROM site_settings WHERE key_name = ?',
      ['delivery_settings']
    );

    if (rows.length === 0) {
      // Store default settings if not yet set
      const jsonStr = JSON.stringify(DEFAULT_DELIVERY_SETTINGS);
      await pool.execute(
        `INSERT INTO site_settings (key_name, data) VALUES ('delivery_settings', ?)
         ON DUPLICATE KEY UPDATE data = VALUES(data)`,
        [jsonStr]
      );
      return res.json({ success: true, settings: DEFAULT_DELIVERY_SETTINGS });
    }

    const data = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
    res.json({ success: true, settings: { ...DEFAULT_DELIVERY_SETTINGS, ...data } });
  } catch (err) {
    console.error('Fetch delivery settings error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch delivery settings.' });
  }
});

// PUT /api/delivery-settings - Authenticated Admin
router.put('/', adminAuthOrLocal, async (req, res) => {
  try {
    const settings = req.body.settings || req.body;
    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ success: false, message: 'Settings object is required.' });
    }

    const mergedSettings = {
      ...DEFAULT_DELIVERY_SETTINGS,
      ...settings,
    };

    const jsonStr = JSON.stringify(mergedSettings);
    await pool.execute(
      `INSERT INTO site_settings (key_name, data) VALUES ('delivery_settings', ?)
       ON DUPLICATE KEY UPDATE data = VALUES(data)`,
      [jsonStr]
    );

    res.json({
      success: true,
      message: 'Delivery settings saved successfully in database.',
      settings: mergedSettings,
    });
  } catch (err) {
    console.error('Update delivery settings error:', err);
    res.status(500).json({ success: false, message: 'Failed to save delivery settings.' });
  }
});

module.exports = {
  router,
  calculateDeliveryFee,
  DEFAULT_DELIVERY_SETTINGS,
};
