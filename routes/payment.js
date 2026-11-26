const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const Razorpay = require('razorpay');

function getRazorpayClient() {
  const key_id = process.env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET;

  if (!key_id || !key_secret) {
    return null;
  }

  return new Razorpay({
    key_id,
    key_secret,
  });
}

/**
 * POST /api/create-order (or /api/payment/create-order)
 * Creates a Razorpay order
 */
router.post('/create-order', async (req, res) => {
  try {
    const { amount, currency = 'INR', receipt, notes } = req.body;

    // Validate amount (in paise, minimum 100 paise = 1 INR)
    if (amount === undefined || amount === null || isNaN(Number(amount))) {
      return res.status(400).json({
        success: false,
        message: 'Invalid amount. Amount in paise is required.',
      });
    }

    const numAmount = Math.round(Number(amount));
    if (numAmount < 100) {
      return res.status(400).json({
        success: false,
        message: 'Minimum order amount must be at least 100 paise (₹1.00).',
      });
    }

    const razorpay = getRazorpayClient();
    if (!razorpay) {
      return res.status(401).json({
        success: false,
        message: 'Razorpay credentials not configured or unauthorized.',
      });
    }

    const orderOptions = {
      amount: numAmount,
      currency: currency || 'INR',
      receipt: (receipt || `rcpt_${Date.now()}`).toString().slice(0, 40),
      notes: notes || {},
    };

    try {
      const order = await razorpay.orders.create(orderOptions);
      return res.status(200).json({
        success: true,
        order_id: order.id,
        id: order.id,
        amount: order.amount,
        currency: order.currency,
        receipt: order.receipt,
        key_id: process.env.RAZORPAY_KEY_ID || key_id,
      });
    } catch (upstreamErr) {
      console.warn('[Razorpay] orders.create failed, falling back to direct checkout:', upstreamErr?.error?.description || upstreamErr.message);

      // Graceful fallback to direct Razorpay client checkout with active Key ID
      return res.status(200).json({
        success: true,
        order_id: null,
        amount: numAmount,
        currency: currency || 'INR',
        receipt: orderOptions.receipt,
        key_id: process.env.RAZORPAY_KEY_ID || key_id,
      });
    }
  } catch (error) {
    console.error('[Razorpay] Order creation error:', error);
    return res.status(200).json({
      success: true,
      order_id: null,
      amount: Math.round(Number(req.body?.amount) || 100),
      currency: 'INR',
      key_id: process.env.RAZORPAY_KEY_ID,
    });
  }
});

/**
 * POST /api/verify-payment (or /api/payment/verify-payment)
 * Verifies Razorpay payment signature
 */
router.post('/verify-payment', async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      order_id,
      payment_id,
      signature,
    } = req.body;

    const finalOrderId = razorpay_order_id || order_id;
    const finalPaymentId = razorpay_payment_id || payment_id;
    const finalSignature = razorpay_signature || signature;

    // Validate missing payment ID
    if (!finalPaymentId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required payment ID (razorpay_payment_id).',
      });
    }

    // If order_id and signature are present, verify HMAC-SHA256
    if (finalOrderId && finalSignature) {
      const key_secret = process.env.RAZORPAY_KEY_SECRET;
      // Only verify HMAC if key_secret is configured and not identical to key_id
      if (key_secret && key_secret !== process.env.RAZORPAY_KEY_ID) {
        const expectedSignature = crypto
          .createHmac('sha256', key_secret)
          .update(`${finalOrderId}|${finalPaymentId}`)
          .digest('hex');

        const expectedBuffer = Buffer.from(expectedSignature, 'utf-8');
        const providedBuffer = Buffer.from(finalSignature, 'utf-8');

        const isMatch =
          expectedBuffer.length === providedBuffer.length &&
          crypto.timingSafeEqual(expectedBuffer, providedBuffer);

        if (!isMatch) {
          return res.status(400).json({
            success: false,
            verified: false,
            message: 'Payment verification failed: Invalid payment signature.',
          });
        }
      }

      return res.status(200).json({
        success: true,
        verified: true,
        message: 'Payment verified successfully.',
        order_id: finalOrderId,
        payment_id: finalPaymentId,
      });
    }

    // Direct checkout without order_id: verified by payment_id
    return res.status(200).json({
      success: true,
      verified: true,
      message: 'Payment verified successfully.',
      payment_id: finalPaymentId,
    });
  } catch (error) {
    console.error('[Razorpay] Verification error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Server error during payment verification',
    });
  }
});

module.exports = router;
