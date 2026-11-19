const { Resend } = require('resend');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
require('dotenv').config();

let resendInstance = null;

function getResendClient() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[EmailService] RESEND_API_KEY is not configured. Email notification skipped.');
    return null;
  }
  if (!resendInstance) {
    resendInstance = new Resend(apiKey);
  }
  return resendInstance;
}

function getSender() {
  const from = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
  if (from.includes('<') && from.includes('>')) {
    return from;
  }
  return `Izha Blooms <${from}>`;
}

function getAdminEmail() {
  return process.env.ADMIN_EMAIL || 'izhablooms@gmail.com';
}

function getAppUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://izhablooms.in').replace(/\/$/, '');
}

function inr(amount) {
  return '₹' + Number(amount || 0).toLocaleString('en-IN');
}

/**
 * Base email layout wrapper with responsive styling and Izha Blooms branding.
 */
function wrapHtmlTemplate({ title, preheader, content }) {
  const appUrl = getAppUrl();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title || 'Izha Blooms Notification'}</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: #FAF1E4;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #332B2B;
      -webkit-font-smoothing: antialiased;
    }
    .wrapper {
      width: 100%;
      background-color: #FAF1E4;
      padding: 24px 12px;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background-color: #ffffff;
      border-radius: 16px;
      overflow: hidden;
      border: 1px solid #E8CFD2;
      box-shadow: 0 4px 16px rgba(51, 43, 43, 0.05);
    }
    .header {
      background: linear-gradient(135deg, #FFF5F7 0%, #FAF1E4 100%);
      padding: 32px 24px 24px;
      text-align: center;
      border-bottom: 1px solid #E8CFD2;
    }
    .brand-title {
      font-size: 26px;
      font-weight: 600;
      letter-spacing: 0.15em;
      color: #B20947;
      text-transform: uppercase;
      margin: 0;
    }
    .brand-tagline {
      font-size: 11px;
      letter-spacing: 0.2em;
      text-transform: uppercase;
      color: #B5607A;
      margin-top: 6px;
      margin-bottom: 0;
    }
    .body-content {
      padding: 28px 24px;
    }
    .badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      background-color: #FAF1E4;
      color: #B20947;
      border: 1px solid #E8CFD2;
    }
    .order-box {
      background-color: #FCF8F3;
      border: 1px solid #E8CFD2;
      border-radius: 12px;
      padding: 18px;
      margin: 20px 0;
    }
    .item-row {
      border-bottom: 1px solid #F0DFE2;
      padding: 12px 0;
    }
    .item-row:last-child {
      border-bottom: none;
    }
    .btn {
      display: inline-block;
      background-color: #B20947;
      color: #ffffff !important;
      text-decoration: none;
      padding: 12px 28px;
      border-radius: 10px;
      font-size: 13px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin-top: 16px;
      text-align: center;
    }
    .footer {
      background-color: #FCF8F3;
      padding: 24px;
      text-align: center;
      border-top: 1px solid #E8CFD2;
      font-size: 12px;
      color: #6f6565;
      line-height: 1.6;
    }
    .footer a {
      color: #B20947;
      text-decoration: none;
      font-weight: 500;
    }
  </style>
</head>
<body>
  ${preheader ? `<span style="display:none;font-size:1px;color:#FAF1E4;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">${preheader}</span>` : ''}
  <div class="wrapper">
    <div class="container">
      <div class="header">
        <h1 class="brand-title">IZHA BLOOMS</h1>
        <p class="brand-tagline">Where Every Thread Blooms &middot; Admin Portal</p>
      </div>
      <div class="body-content">
        ${content}
      </div>
      <div class="footer">
        <p style="margin:0 0 8px 0;">Izha Blooms Management System</p>
        <p style="margin:0;font-size:11px;color:#9b9090;">
          &copy; ${new Date().getFullYear()} Izha Blooms Studio, Aluva, Kerala. Confidential Admin Notification.
        </p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Builds HTML list for ordered products with quantities, sizes, and pricing.
 */
function renderItemsHtml(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return '<p style="color:#6f6565;font-size:13px;">No items listed.</p>';
  }

  return items
    .map((item) => {
      const lineTotal = Number(item.price || 0) * Number(item.qty || 1);
      return `
      <div class="item-row" style="display:flex;align-items:center;justify-content:space-between;">
        <div>
          <strong style="color:#332B2B;font-size:14px;display:block;">${item.name || 'Handcrafted Apparel'}</strong>
          <span style="color:#6f6565;font-size:12px;">Size: ${item.size || 'Standard'} &middot; Qty: ${item.qty || 1} &middot; ${inr(item.price)} each</span>
        </div>
        <div style="font-weight:600;color:#332B2B;font-size:14px;white-space:nowrap;padding-left:12px;">
          ${inr(lineTotal)}
        </div>
      </div>`;
    })
    .join('');
}

/**
 * Core send helper using Resend SDK.
 */
async function sendEmail({ to, subject, html, text }) {
  const client = getResendClient();
  if (!client) {
    console.warn('[EmailService] Skipped sending email (client unconfigured):', { to, subject });
    return { success: false, reason: 'unconfigured' };
  }

  const from = getSender();

  try {
    const response = await client.emails.send({
      from,
      to,
      subject,
      html,
      text: text || subject,
    });

    if (response.error) {
      console.error('[EmailService] Resend API error response:', response.error);
      return { success: false, error: response.error };
    }

    console.log(`[EmailService] Admin order notification sent successfully to ${to} (ID: ${response.data?.id})`);
    return { success: true, data: response.data };
  } catch (err) {
    console.error('[EmailService] Unexpected error sending email to ' + to + ':', err);
    return { success: false, error: err.message };
  }
}

/**
 * Admin New Order Notification Email
 * Sent ONLY to ADMIN_EMAIL when a customer successfully places an order.
 * Includes: customer name, customer email, phone number, delivery address, order ID, ordered products, quantities and total amount.
 */
async function sendAdminNewOrderNotification(order) {
  if (!order) {
    return { success: false, reason: 'missing_order_data' };
  }

  const adminEmail = getAdminEmail();
  const orderNumber = order.orderNumber || order.id;
  const appUrl = getAppUrl();
  const address = order.shippingAddress || {};

  const fullAddress = [
    address.line || address.address,
    [address.city, address.state].filter(Boolean).join(', '),
    address.pincode ? `PIN: ${address.pincode}` : '',
  ]
    .filter(Boolean)
    .join('<br />');

  const dObj = order.createdAt ? new Date(order.createdAt) : new Date();
  const validD = !isNaN(dObj.getTime()) ? dObj : new Date();
  const orderDateStr =
    validD.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }) + ' IST';

  const content = `
    <div style="margin-bottom:20px;">
      <span class="badge">New Order Alert</span>
      <h2 style="font-size:22px;color:#332B2B;margin:12px 0 4px 0;">New Order Received: #${orderNumber}</h2>
      <p style="color:#6f6565;font-size:14px;margin:0;">
        A new order has been placed on the customer website.
      </p>
    </div>

    <!-- Customer & Order Information Block -->
    <div class="order-box">
      <h3 style="font-size:13px;text-transform:uppercase;letter-spacing:0.1em;color:#B5607A;margin:0 0 10px 0;">Customer &amp; Order Details</h3>
      <table style="width:100%;font-size:13px;line-height:1.7;color:#332B2B;border-collapse:collapse;">
        <tr>
          <td style="width:140px;color:#6f6565;font-weight:500;">Order ID:</td>
          <td><strong style="color:#B20947;font-size:14px;">#${orderNumber}</strong></td>
        </tr>
        <tr>
          <td style="color:#6f6565;font-weight:500;">Order Date:</td>
          <td>${orderDateStr}</td>
        </tr>
        <tr>
          <td style="color:#6f6565;font-weight:500;">Customer Name:</td>
          <td><strong>${order.customerName || 'N/A'}</strong></td>
        </tr>
        <tr>
          <td style="color:#6f6565;font-weight:500;">Customer Email:</td>
          <td><a href="mailto:${order.customerEmail}" style="color:#B20947;text-decoration:none;">${order.customerEmail || 'Not provided'}</a></td>
        </tr>
        <tr>
          <td style="color:#6f6565;font-weight:500;">Phone Number:</td>
          <td><a href="tel:${order.customerPhone}" style="color:#B20947;text-decoration:none;font-weight:600;">${order.customerPhone || 'N/A'}</a></td>
        </tr>
        <tr>
          <td style="color:#6f6565;font-weight:500;vertical-align:top;">Delivery Address:</td>
          <td style="line-height:1.5;">${fullAddress || 'No address provided'}</td>
        </tr>
        <tr>
          <td style="color:#6f6565;font-weight:500;">Payment Method:</td>
          <td><strong>${order.paymentMethod || 'COD'}</strong></td>
        </tr>
        <tr>
          <td style="color:#6f6565;font-weight:500;">Payment Status:</td>
          <td><strong style="color:${order.paymentStatus === 'Paid' ? '#0d8a4e' : '#B20947'};">${order.paymentStatus || 'Pending'}</strong></td>
        </tr>
      </table>
    </div>

    <!-- Ordered Products Block -->
    <div class="order-box">
      <h3 style="font-size:13px;text-transform:uppercase;letter-spacing:0.1em;color:#B5607A;margin:0 0 10px 0;">
        Ordered Products (${order.items ? order.items.length : 0})
      </h3>
      <div>
        ${renderItemsHtml(order.items)}
      </div>

      <!-- Financial Totals -->
      <div style="border-top:1px solid #E8CFD2;padding-top:12px;margin-top:14px;font-size:13px;color:#6f6565;line-height:1.7;">
        <div style="display:flex;justify-content:space-between;">
          <span>Subtotal:</span>
          <span style="color:#332B2B;font-weight:500;">${inr(order.subtotal)}</span>
        </div>
        ${
          Number(order.discount || 0) > 0
            ? `<div style="display:flex;justify-content:space-between;color:#B20947;">
                <span>Discount (${order.couponCode ? `Coupon ${order.couponCode}` : 'Offer'}):</span>
                <span>-${inr(order.discount)}</span>
              </div>`
            : ''
        }
        <div style="display:flex;justify-content:space-between;">
          <span>Delivery Charge:</span>
          <span style="color:#332B2B;font-weight:500;">${Number(order.shippingFee || 0) === 0 ? 'FREE' : inr(order.shippingFee)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;border-top:1px solid #E8CFD2;padding-top:8px;margin-top:6px;font-size:16px;color:#B20947;font-weight:700;">
          <span>Total Amount:</span>
          <span>${inr(order.total)}</span>
        </div>
      </div>
    </div>

    <!-- Admin Panel Quick Link -->
    <div style="text-align:center;margin-top:24px;">
      <a href="${appUrl}/admin/orders/details?id=${encodeURIComponent(order.id || orderNumber)}" class="btn">
        View Order in Admin Panel
      </a>
    </div>
  `;

  return sendEmail({
    to: adminEmail,
    subject: `New Order Received - Izha Blooms | Order #${orderNumber}`,
    html: wrapHtmlTemplate({
      title: `New Order Received - Izha Blooms | Order #${orderNumber}`,
      preheader: `New order #${orderNumber} received from ${order.customerName || 'Customer'} - Total: ${inr(order.total)}.`,
      content,
    }),
  });
}

/**
 * Customer order confirmation emails are COMPLETELY DISABLED.
 * Never sends any email and never falls back to ADMIN_EMAIL.
 */
async function sendOrderConfirmation() {
  console.log('[EmailService] Customer order confirmation is disabled. No email sent.');
  return { success: true, disabled: true, message: 'Customer order confirmation emails are disabled.' };
}

/**
 * Customer order status update emails are COMPLETELY DISABLED.
 * Never sends any email and never falls back to ADMIN_EMAIL.
 */
async function sendOrderStatusUpdate() {
  console.log('[EmailService] Customer status update is disabled. No email sent.');
  return { success: true, disabled: true, message: 'Customer order status update emails are disabled.' };
}

module.exports = {
  sendAdminNewOrderNotification,
  sendOrderConfirmation,
  sendOrderStatusUpdate,
  sendEmail,
};
