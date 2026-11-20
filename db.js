const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.db_HOST,
  port: Number(process.env.db_PORT) || 4000,
  user: process.env.db_USERNAME,
  password: process.env.db_PASSWORD,
  database: process.env.db_DATABASE || 'izha_blooms',
  ssl: {
    minVersion: 'TLSv1.2',
    rejectUnauthorized: true,
  },
  timezone: 'Z',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

async function initDB() {
  const connection = await pool.getConnection();
  try {
    console.log('[TiDB] Initializing database schema...');

    // 1. Users table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(64) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        phone VARCHAR(32),
        password_hash VARCHAR(255) NOT NULL,
        role ENUM('customer', 'admin') DEFAULT 'customer',
        is_super_admin BOOLEAN DEFAULT FALSE,
        can_manage_admins BOOLEAN DEFAULT FALSE,
        is_active BOOLEAN DEFAULT TRUE,
        created_by VARCHAR(64) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Ensure columns exist on already created tables
    try {
      await connection.execute(`ALTER TABLE users ADD COLUMN is_super_admin BOOLEAN DEFAULT FALSE`);
    } catch (_) {}
    try {
      await connection.execute(`ALTER TABLE users ADD COLUMN can_manage_admins BOOLEAN DEFAULT FALSE`);
    } catch (_) {}
    try {
      await connection.execute(`ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT TRUE`);
    } catch (_) {}
    try {
      await connection.execute(`ALTER TABLE users ADD COLUMN created_by VARCHAR(64) DEFAULT NULL`);
    } catch (_) {}

    // 2. Addresses table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS addresses (
        id VARCHAR(64) PRIMARY KEY,
        user_id VARCHAR(64) NOT NULL,
        name VARCHAR(255) NOT NULL,
        phone VARCHAR(32) NOT NULL,
        line TEXT NOT NULL,
        city VARCHAR(128) NOT NULL,
        state VARCHAR(128),
        pincode VARCHAR(16) NOT NULL,
        is_default BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 3. Products table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS products (
        id VARCHAR(64) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        category VARCHAR(128) NOT NULL,
        category_slug VARCHAR(128) NOT NULL,
        price DECIMAL(10,2) NOT NULL,
        mrp DECIMAL(10,2) NOT NULL,
        sizes JSON NOT NULL,
        sold_out_sizes JSON,
        image TEXT NOT NULL,
        gallery JSON,
        is_new BOOLEAN DEFAULT FALSE,
        popularity INT DEFAULT 80,
        description TEXT,
        fabric VARCHAR(255),
        craft VARCHAR(255),
        care VARCHAR(255),
        fit VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    try {
      await connection.execute(`ALTER TABLE products MODIFY COLUMN image MEDIUMTEXT NOT NULL`);
    } catch (_) {}
    try {
      await connection.execute(`ALTER TABLE products MODIFY COLUMN gallery MEDIUMTEXT`);
    } catch (_) {}
    try {
      await connection.execute(`ALTER TABLE products ADD COLUMN IF NOT EXISTS new_days INT DEFAULT 30`);
    } catch (_) {}
    try {
      await connection.execute(`ALTER TABLE products ADD COLUMN IF NOT EXISTS stock INT DEFAULT 15`);
    } catch (_) {}
    try {
      await connection.execute(`ALTER TABLE products ADD COLUMN IF NOT EXISTS size_chart JSON`);
    } catch (_) {}
    try {
      await connection.execute(`ALTER TABLE products ADD COLUMN IF NOT EXISTS color VARCHAR(128) DEFAULT 'Dusty Rose'`);
    } catch (_) {}
    try {
      await connection.execute(`ALTER TABLE products ADD COLUMN IF NOT EXISTS image_public_id VARCHAR(255) NULL`);
    } catch (_) {}
    try {
      await connection.execute(`ALTER TABLE products ADD COLUMN IF NOT EXISTS gallery_public_ids JSON NULL`);
    } catch (_) {}

    // 4. Orders table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS orders (
        id VARCHAR(64) PRIMARY KEY,
        order_number VARCHAR(64) NOT NULL UNIQUE,
        customer_name VARCHAR(255) NOT NULL,
        customer_email VARCHAR(255) NOT NULL,
        customer_phone VARCHAR(32) NOT NULL,
        shipping_address JSON NOT NULL,
        items JSON NOT NULL,
        subtotal DECIMAL(10,2) NOT NULL,
        discount DECIMAL(10,2) DEFAULT 0,
        shipping_fee DECIMAL(10,2) DEFAULT 0,
        total DECIMAL(10,2) NOT NULL,
        status VARCHAR(64) DEFAULT 'Processing',
        payment_method VARCHAR(64) DEFAULT 'COD',
        payment_status VARCHAR(64) DEFAULT 'Pending',
        tracking_number VARCHAR(128),
        status_history JSON,
        stock_deducted BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    try {
      await connection.execute(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_id VARCHAR(64)`);
    } catch (_) {}
    try {
      await connection.execute(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS status_history JSON`);
    } catch (_) {}
    try {
      await connection.execute(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS stock_deducted BOOLEAN DEFAULT TRUE`);
    } catch (_) {}
    try {
      await connection.execute(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_code VARCHAR(64) DEFAULT NULL`);
    } catch (_) {}
    try {
      await connection.execute(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_discount DECIMAL(10,2) DEFAULT 0`);
    } catch (_) {}

    // 5. Coupons table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS coupons (
        id VARCHAR(64) PRIMARY KEY,
        code VARCHAR(64) NOT NULL UNIQUE,
        type VARCHAR(32) NOT NULL,
        value DECIMAL(10,2) NOT NULL,
        min_order DECIMAL(10,2) DEFAULT 0,
        first_order_only BOOLEAN DEFAULT FALSE,
        active BOOLEAN DEFAULT TRUE,
        expiry VARCHAR(64),
        used_count INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 6. Reviews table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS reviews (
        id VARCHAR(64) PRIMARY KEY,
        product_id VARCHAR(64),
        name VARCHAR(255) NOT NULL,
        place VARCHAR(128),
        rating INT DEFAULT 5,
        date VARCHAR(64),
        text TEXT NOT NULL,
        image MEDIUMTEXT DEFAULT NULL,
        featured BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    try {
      await connection.execute(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS image MEDIUMTEXT DEFAULT NULL`);
    } catch (_) {}
    try {
      await connection.execute(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS featured BOOLEAN DEFAULT FALSE`);
    } catch (_) {}

    // 7. Site Settings table (Hero slides, Category list, About section, Instagram posts)
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS site_settings (
        key_name VARCHAR(64) PRIMARY KEY,
        data JSON NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 8. Visit Events table (Funnel tracking & reports)
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS visit_events (
        id VARCHAR(64) PRIMARY KEY,
        session_id VARCHAR(64) NOT NULL,
        type VARCHAR(64) NOT NULL,
        page VARCHAR(255),
        product_name VARCHAR(255),
        customer_name VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    console.log('[TiDB] Tables ready.');

    // Auto-seed initial admin and catalog if empty
    await seedInitialData(connection);

  } catch (err) {
    console.error('[TiDB] Error initializing database:', err);
    throw err;
  } finally {
    connection.release();
  }
}

async function seedInitialData(connection) {
  const bcrypt = require('bcryptjs');

  // Check if admin user exists
  const envAdminEmail = (process.env.ADMIN_EMAIL || 'izhablooms@gmail.com').toLowerCase();
  const [users] = await connection.execute('SELECT id FROM users WHERE email = ?', ['admin@izhablooms.com']);
  if (users.length === 0) {
    const adminPasswordHash = await bcrypt.hash('admin123', 10);
    await connection.execute(
      `INSERT INTO users (id, name, email, phone, password_hash, role, is_super_admin, can_manage_admins, is_active, created_by) VALUES (?, ?, ?, ?, ?, ?, TRUE, TRUE, TRUE, 'developer')`,
      ['admin-1', 'Admin Studio', 'admin@izhablooms.com', '9995757612', adminPasswordHash, 'admin']
    );
    console.log('[TiDB] Default admin user seeded: admin@izhablooms.com / admin123');
  } else {
    await connection.execute(
      `UPDATE users SET is_super_admin = TRUE, can_manage_admins = TRUE, is_active = TRUE, created_by = 'developer' WHERE email = 'admin@izhablooms.com' OR role = 'admin' LIMIT 1`
    );
  }

  // Ensure env-configured ADMIN_EMAIL (izhablooms@gmail.com) exists as Super Admin
  if (envAdminEmail && envAdminEmail !== 'admin@izhablooms.com') {
    const [envAdminUsers] = await connection.execute('SELECT id FROM users WHERE email = ?', [envAdminEmail]);
    if (envAdminUsers.length === 0) {
      const adminPasswordHash = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'admin123', 10);
      await connection.execute(
        `INSERT INTO users (id, name, email, phone, password_hash, role, is_super_admin, can_manage_admins, is_active, created_by) VALUES (?, ?, ?, ?, ?, ?, TRUE, TRUE, TRUE, 'developer')`,
        ['admin-env', 'Admin Studio', envAdminEmail, '9995757612', adminPasswordHash, 'admin']
      );
      console.log(`[TiDB] Main admin user seeded from env: ${envAdminEmail}`);
    } else {
      await connection.execute(
        `UPDATE users SET role = 'admin', is_super_admin = TRUE, can_manage_admins = TRUE, is_active = TRUE WHERE email = ?`,
        [envAdminEmail]
      );
    }
  }

  // Check if default customer user exists
  const [customer] = await connection.execute('SELECT id FROM users WHERE email = ?', ['customer@izhablooms.com']);
  if (customer.length === 0) {
    const customerPasswordHash = await bcrypt.hash('password123', 10);
    await connection.execute(
      `INSERT INTO users (id, name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, ?, ?)`,
      ['user-1', 'Meera Nair', 'customer@izhablooms.com', '9876543210', customerPasswordHash, 'customer']
    );
    console.log('[TiDB] Default customer user seeded: customer@izhablooms.com / password123');
  }

  // Check if products exist
  const [prodCount] = await connection.execute('SELECT COUNT(*) as count FROM products');
  if (prodCount[0].count === 0) {
    console.log('[TiDB] Seeding 30 catalog products from lib/products.ts...');
    const fs = require('fs');
    const productsPath = path.resolve(__dirname, '../lib/products.ts');
    if (fs.existsSync(productsPath)) {
      // Seed directly with catalog data
      const defaultProducts = getInitialProductsList();
      for (const p of defaultProducts) {
        await connection.execute(
          `INSERT INTO products (
            id, name, category, category_slug, price, mrp, sizes, sold_out_sizes,
            image, gallery, is_new, popularity, description, fabric, craft, care, fit
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            p.id,
            p.name,
            p.category,
            p.categorySlug,
            p.price,
            p.mrp,
            JSON.stringify(p.sizes || []),
            JSON.stringify(p.soldOutSizes || []),
            p.image,
            JSON.stringify(p.gallery || [p.image]),
            Boolean(p.isNew),
            p.popularity || 80,
            p.description || '',
            p.fabric || '',
            p.craft || '',
            p.care || '',
            p.fit || '',
          ]
        );
      }
      console.log(`[TiDB] ${defaultProducts.length} products seeded successfully.`);
    }
  }

  // Check if coupons exist
  const [couponCount] = await connection.execute('SELECT COUNT(*) as count FROM coupons');
  if (couponCount[0].count === 0) {
    const defaultCoupons = [
      { id: 'cpn-1', code: 'BLOOM10', type: 'percent', value: 10, min_order: 999, first_order_only: 0, active: 1, expiry: '2026-12-31', used_count: 42 },
      { id: 'cpn-2', code: 'FIRST15', type: 'percent', value: 15, min_order: 1299, first_order_only: 1, active: 1, expiry: '2026-12-31', used_count: 28 },
      { id: 'cpn-3', code: 'IZHA200', type: 'flat', value: 200, min_order: 1799, first_order_only: 0, active: 1, expiry: '2026-11-30', used_count: 19 },
    ];
    for (const c of defaultCoupons) {
      await connection.execute(
        `INSERT INTO coupons (id, code, type, value, min_order, first_order_only, active, expiry, used_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [c.id, c.code, c.type, c.value, c.min_order, c.first_order_only, c.active, c.expiry, c.used_count]
      );
    }
    console.log('[TiDB] Default coupons seeded.');
  }

  // Seed default website pages if not present
  await seedDefaultPages(connection);
}

async function seedDefaultPages(connection) {
  const pages = [
    {
      key: 'page_faqs',
      data: {
        slug: 'faqs',
        name: 'FAQs',
        urlPath: '/faqs',
        title: 'Frequently Asked Questions (FAQs)',
        sub: 'Welcome to Izha Blooms! 🌸 We understand that you may have a few questions before placing your order. Here are some answers to help make your shopping experience smooth and delightful.',
        status: 'Published',
        faqs: [
          {
            id: 'faq-1',
            q: 'Where does Izha Blooms deliver?',
            a: 'We deliver across India right to your doorstep — typically 2–4 business days within Kerala and 4–7 business days across the rest of India.'
          },
          {
            id: 'faq-2',
            q: 'Can I order without creating an account?',
            a: 'Yes! Guest checkout is available on every order. You can also sign in quickly using your mobile number and OTP if you prefer.'
          },
          {
            id: 'faq-3',
            q: 'How do I choose the right size?',
            a: 'Every product page includes a clickable Size Guide right beside Select Size, plus detailed fabric and fit notes. You can also message us on WhatsApp at +91 99957 57612.'
          },
          {
            id: 'faq-4',
            q: 'What are the shipping charges?',
            a: 'Orders within Kerala enjoy free delivery, and Pan-India orders unlock free shipping above the active order threshold. Enter your PIN code at checkout to check instantly.'
          },
          {
            id: 'faq-5',
            q: 'How can I track my order?',
            a: 'Visit the Track Your Order page using your Order ID (e.g., IZB-1006) or check My Orders inside your Account dashboard.'
          },
          {
            id: 'faq-6',
            q: 'What is your return or exchange policy?',
            a: 'We offer size exchanges within 48 hours of delivery for unused, unwashed garments with tags intact. Please refer to our Returns & Exchange policy for full details.'
          }
        ],
        sections: [],
        contactInfo: {
          whatsapp: '9995757612',
          email: 'izhablooms@gmail.com'
        },
        closingMessage: 'Have more questions? Reach out to our friendly support team anytime.'
      }
    },
    {
      key: 'page_shipping',
      data: {
        slug: 'shipping-policy',
        name: 'Shipping & Delivery',
        urlPath: '/shipping-policy',
        title: 'Shipping & Delivery Policy',
        sub: 'Every order deserves special care. Thoughtfully packed and delivered to your doorstep with love.',
        intro: 'At Izha Blooms, we believe every order deserves special care. Each piece is thoughtfully packed and delivered to your doorstep with love.',
        status: 'Published',
        sections: [
          {
            id: 'sec-ship-1',
            title: '1. Order Processing',
            contentType: 'bullets',
            items: [
              'Orders are processed within 2–3 business days after successful payment confirmation.',
              'As our products are carefully prepared and packed, processing time may vary during sale periods or new collection launches.'
            ]
          },
          {
            id: 'sec-ship-2',
            title: '2. Shipping & Delivery',
            contentType: 'bullets',
            items: [
              'We offer shipping across India.',
              'Orders within Kerala are usually delivered within 3–7 business days after dispatch.',
              'Orders to other parts of India may take approximately 4–8 business days after dispatch.',
              'Delivery timelines are estimates and may vary depending on the courier service, location, weather conditions and unforeseen circumstances.'
            ]
          },
          {
            id: 'sec-ship-3',
            title: '3. Shipping Charges',
            contentType: 'bullets',
            items: [
              'Shipping charges are calculated based on the delivery location and applicable courier rates.',
              'Any applicable shipping charges will be displayed or communicated before order confirmation.',
              'Special free-shipping offers will be announced through our website or social media platforms.'
            ]
          },
          {
            id: 'sec-ship-4',
            title: '4. Delivery Delays',
            contentType: 'paragraph',
            items: [
              'While we always aim to deliver your orders on time, occasional delays may occur due to courier-related issues, weather conditions, public holidays or other circumstances beyond our control.'
            ]
          },
          {
            id: 'sec-ship-5',
            title: '5. Damaged or Missing Packages',
            contentType: 'paragraph',
            items: [
              'If you receive a package that appears damaged or tampered with, please contact us within 24 hours of delivery with clear 3–4 photos or an unboxing video so we can assist you.'
            ]
          },
          {
            id: 'sec-ship-6',
            title: '6. Contact Us',
            contentType: 'paragraph',
            description: 'For shipping-related queries or assistance, feel free to contact us.',
            items: [
              'Izha Blooms customer assistance is available Monday through Saturday.'
            ]
          }
        ],
        contactInfo: {
          whatsapp: '9995757612',
          email: 'izhablooms@gmail.com'
        },
        closingMessage: 'Thank you for choosing Izha Blooms. Every order is a little piece of love, delivered to you.'
      }
    },
    {
      key: 'page_returns',
      data: {
        slug: 'returns',
        name: 'Returns & Exchange',
        urlPath: '/returns',
        title: 'Return & Exchange Policy',
        sub: 'At Izha Blooms, every piece is carefully selected, checked and packed with love. We want you to be happy with your purchase. Please read our Return & Exchange Policy before placing your order.',
        status: 'Published',
        sections: [
          {
            id: 'sec-ret-1',
            title: '1. Return Policy',
            contentType: 'bullets',
            items: [
              'We do not accept returns for reasons such as change of mind, colour preference or incorrect size selection.',
              'Returns are accepted only in cases where the product received is damaged, defective or incorrect.',
              'Any such issue must be reported within 24 hours of receiving the order, with clear photographs and an unboxing video showing the issue.'
            ]
          },
          {
            id: 'sec-ret-2',
            title: '2. Exchange Policy',
            contentType: 'bullets',
            items: [
              'Size exchanges are subject to availability of stock.',
              'Exchange requests must be raised within 48 hours of delivery.',
              'The product must be unused, unwashed, unworn and in its original condition, with all tags and packaging intact.',
              'Products showing signs of use, washing, alteration or damage caused after delivery will not be eligible for exchange.'
            ]
          },
          {
            id: 'sec-ret-3',
            title: '3. Damaged or Incorrect Products',
            description: 'If you receive a damaged, defective or incorrect product:',
            contentType: 'bullets',
            items: [
              'Please contact us within 24 hours of delivery.',
              'Share clear photographs and an unboxing video showing the issue.',
              'Once the issue is verified, we will arrange an appropriate resolution, such as a replacement or refund, depending on the situation.'
            ]
          },
          {
            id: 'sec-ret-4',
            title: '4. Exchange Shipping Charges',
            contentType: 'bullets',
            items: [
              'For eligible size exchanges, return shipping and reshipping charges may be borne by the customer.',
              'If the exchange is due to an error from our side, Izha Blooms will bear the applicable shipping charges.'
            ]
          },
          {
            id: 'sec-ret-5',
            title: '5. Refund Policy',
            contentType: 'bullets',
            items: [
              'Refunds are applicable only for approved cases, such as unavailable replacement stock or verified product issues.',
              'Approved refunds will be processed to the original payment method.',
              'Please allow 5–7 business days for the refund to reflect, depending on the payment provider.'
            ]
          },
          {
            id: 'sec-ret-6',
            title: '6. Non-Exchangeable Items',
            description: 'The following are not eligible for exchange:',
            contentType: 'bullets',
            items: [
              'Products purchased during special clearance or final sale offers, unless defective or incorrect.',
              'Products that have been worn, washed, altered or damaged after delivery.',
              'Products without original tags or packaging.'
            ]
          },
          {
            id: 'sec-ret-7',
            title: '7. How to Request an Exchange',
            description: 'For any return or exchange request, please contact us through:',
            contentType: 'paragraph',
            items: [
              'Our team will guide you through the process step-by-step.'
            ]
          }
        ],
        contactInfo: {
          whatsapp: '9995757612',
          instagram: '@izhablooms'
        },
        closingMessage: 'Thank you for choosing Izha Blooms. We truly appreciate your love and support!'
      }
    },
    {
      key: 'page_privacy',
      data: {
        slug: 'privacy-policy',
        name: 'Privacy Policy',
        urlPath: '/privacy-policy',
        title: 'Privacy Policy',
        sub: 'How Izha Blooms protects your personal & delivery details.',
        intro: 'We respect your privacy and only collect contact and delivery information needed to fulfil orders, share tracking updates, and assist you personally.',
        status: 'Published',
        sections: [
          {
            id: 'sec-priv-1',
            title: '1. Information We Collect',
            contentType: 'paragraph',
            items: [
              'We collect customer details such as your name, mobile number, email address, and delivery destination when you place an order or register on our site. This information is solely used to process and fulfill your order.'
            ]
          },
          {
            id: 'sec-priv-2',
            title: '2. How We Use Your Data',
            contentType: 'bullets',
            items: [
              'To process, dispatch, and track your purchased items.',
              'To communicate order status, dispatch updates, and delivery alerts via SMS or WhatsApp.',
              'To assist you with size inquiries, exchanges, or customer service requests.',
              'We never sell, rent, or trade your personal information to third-party marketing companies.'
            ]
          },
          {
            id: 'sec-priv-3',
            title: '3. Payment & Security',
            contentType: 'paragraph',
            items: [
              'Payment transactions are processed securely through certified payment gateways. Izha Blooms does not store your credit card, debit card, or net banking credentials on our servers.'
            ]
          },
          {
            id: 'sec-priv-4',
            title: '4. Contact Us Regarding Privacy',
            contentType: 'paragraph',
            items: [
              'If you have questions or concerns regarding our privacy practices or wish to review the information we hold, please contact our team.'
            ]
          }
        ],
        contactInfo: {
          email: 'izhablooms@gmail.com',
          whatsapp: '9995757612'
        },
        closingMessage: 'Your trust is our greatest asset. Thank you for shopping with Izha Blooms.'
      }
    },
    {
      key: 'page_terms',
      data: {
        slug: 'terms',
        name: 'Terms & Conditions',
        urlPath: '/terms',
        title: 'Terms & Conditions',
        sub: 'Store guidelines for shopping with Izha Blooms · Izha Designs, Aluva.',
        intro: 'All product photography, embroidered designs, and branding belong to Izha Designs (Izha Blooms), Aluva, Kerala, India.',
        status: 'Published',
        sections: [
          {
            id: 'sec-terms-1',
            title: '1. Intellectual Property & Brand Ownership',
            contentType: 'paragraph',
            items: [
              'All product photography, handcrafted designs, embroidered artwork, textual descriptions, and brand logos belong exclusively to Izha Designs (Izha Blooms), Aluva, Kerala, India. Unauthorized reproduction, modification, distribution, or commercial use is strictly prohibited.'
            ]
          },
          {
            id: 'sec-terms-2',
            title: '2. Pricing & Promotional Offers',
            contentType: 'paragraph',
            items: [
              'All product prices listed on the website are in Indian Rupees (INR) and inclusive of applicable taxes. Prices and active promotional discounts are subject to change without prior notice. Promotional coupons and introductory offers cannot be combined unless specifically authorized.'
            ]
          },
          {
            id: 'sec-terms-3',
            title: '3. Orders & Cancellations',
            contentType: 'bullets',
            items: [
              'Orders are accepted subject to availability of fabrics and inventory.',
              'In the rare event that an item is out of stock after order placement, our team will promptly contact you for an exchange or full refund.',
              'Orders once dispatched cannot be cancelled.'
            ]
          },
          {
            id: 'sec-terms-4',
            title: '4. Governing Jurisdiction',
            contentType: 'paragraph',
            items: [
              'Any legal claims or disputes arising from transactions or usage of this website will fall under the exclusive jurisdiction of the competent courts in Ernakulam / Aluva, Kerala, India.'
            ]
          }
        ],
        contactInfo: {
          email: 'izhablooms@gmail.com',
          whatsapp: '9995757612'
        },
        closingMessage: 'By shopping with Izha Blooms, you acknowledge and agree to these terms of service.'
      }
    }
  ];

  for (const page of pages) {
    const [existing] = await connection.execute('SELECT key_name FROM site_settings WHERE key_name = ?', [page.key]);
    if (existing.length === 0) {
      await connection.execute(
        'INSERT INTO site_settings (key_name, data) VALUES (?, ?)',
        [page.key, JSON.stringify(page.data)]
      );
      console.log(`[TiDB] Default page content seeded for: ${page.key}`);
    }
  }
}

function getInitialProductsList() {
  // Built from lib/products.ts definitions
  return [
    { id: "p1", name: "Floral Printed Cotton Dress", category: "Dresses", categorySlug: "dresses", price: 1499, mrp: 2499, sizes: ["S", "M", "L", "XL"], image: "/images/about.jpg", isNew: true, popularity: 95, description: "Woven in airy 100% pure mul cotton, this floral dress drapes softly with a flattering flared hem and breathable lining for sunny days and intimate gatherings.", fabric: "100% Pure Mulmul Cotton with soft cotton lining", craft: "Hand-screen floral print with delicate neck piping", care: "Gentle cold hand wash separately; dry in shade", fit: "Relaxed A-line fit · Midi length (46 inches)" },
    { id: "p2", name: "Embroidered Anarkali Kurta", category: "Kurtas", categorySlug: "kurtas", price: 1899, mrp: 2999, sizes: ["M", "L", "XL", "XXL"], image: "/images/cateethnic.jpg", isNew: false, popularity: 88, description: "Gracefully flared Anarkali kurta accented with fine floral thread embroidery across the bodice and sleeves.", fabric: "Breathable Chanderi Cotton Blend with soft lining", craft: "Intricate floral Resham thread embroidery", care: "Dry clean or gentle cold wash inside out", fit: "Flared Anarkali fit · Calf length (48 inches)" },
    { id: "p3", name: "Chikankari Kurta Set with Dupatta", category: "Kurta Sets", categorySlug: "kurta-sets", price: 2799, mrp: 3999, sizes: ["S", "M", "L"], image: "/images/cateogry1.jpg", isNew: true, popularity: 92, description: "Elegantly paired straight kurta and palazzo set finished with traditional Chikankari-inspired thread accents and lightweight organza dupatta.", fabric: "Pure Cotton Mulmul kurta and palazzo with chiffon dupatta", craft: "Tonal floral Chikankari thread embroidery with scallop borders", care: "Hand wash in cold water with mild detergent", fit: "Straight silhouette kurta with relaxed wide-leg palazzo" },
    { id: "p4", name: "Ruffle Sleeve Cotton Top", category: "Tops", categorySlug: "tops", price: 799, mrp: 1299, sizes: ["XS", "S", "M", "L"], image: "/images/catetop.jpg", isNew: false, popularity: 70, description: "Casual everyday top cut from soft cotton with double-layer ruffle sleeves and delicate shell button closure.", fabric: "100% Slub Cotton", craft: "Subtle gathers with delicate hand-attached shell buttons", care: "Machine wash cold on gentle cycle", fit: "Regular easy fit · Hip length (24 inches)" },
    { id: "p5", name: "Feeding Friendly Maternity Kurta", category: "Maternity Wear", categorySlug: "maternity-wear", price: 1699, mrp: 2199, sizes: ["M", "L", "XL", "XXL"], image: "/images/causal-waer.jpg", isNew: false, popularity: 76, description: "Specially designed for mothers with concealed dual-side invisible zippers for hassle-free nursing.", fabric: "Ultra-soft Modal Cotton Blend (hypoallergenic)", craft: "Discreet vertical concealed zips with floral neck piping", care: "Gentle machine wash cold; iron on reverse", fit: "Roomy empire cut with ample bump space · Calf length" },
    { id: "p6", name: "Tiered Maxi Dress", category: "Dresses", categorySlug: "dresses", price: 2499, mrp: 3299, sizes: ["S", "M", "L"], image: "/images/office-wear.jpg", isNew: false, popularity: 84, description: "Three-tier sweeping maxi dress with gathered waist and airy flutter sleeves, rendered in pastel tones.", fabric: "100% Breathable Rayon Crepe", craft: "Flattering gathered tiers with French seams", care: "Cold hand wash; dry flat in shade", fit: "Flowy relaxed fit · Floor length (52 inches)" },
    { id: "p7", name: "Straight Fit Block Print Kurta", category: "Kurtas", categorySlug: "kurtas", price: 1199, mrp: 1599, sizes: ["S", "M", "L", "XL"], image: "/images/co-ords-set.jpg", isNew: false, popularity: 66, description: "Crisp daily wear cotton kurta featuring authentic artisan hand block motifs and side slits.", fabric: "100% Cambric Cotton", craft: "Hand block print using natural azo-free dyes", care: "First wash dry clean; subsequent cold washes", fit: "Classic straight cut with side slits · Knee length (44 inches)" },
    { id: "p8", name: "Festive Silk Kurta Set", category: "Kurta Sets", categorySlug: "kurta-sets", price: 3499, mrp: 5999, sizes: ["M", "L", "XL"], image: "/images/dress.jpg", isNew: true, popularity: 90, description: "Rich Chanderi silk kurta set tailored with subtle zari thread highlights, matched with tailored pants and a woven Banarasi-bordered dupatta.", fabric: "Art Silk & Chanderi blend with soft santoon lining", craft: "Delicate Zari and sequin neck and sleeve embellishments", care: "Professional dry clean only", fit: "Tailored straight fit with cigarette pants" },
    { id: "p9", name: "Peplum Style Party Top", category: "Tops", categorySlug: "tops", price: 999, mrp: 1499, sizes: ["XS", "S", "M"], image: "/images/festive-wear.jpg", isNew: false, popularity: 61, description: "Flattering flared peplum silhouette adorned with subtle gold foil accents, ideal for pairing with trousers or ethnic skirts.", fabric: "Fine Cotton Satin Blend", craft: "Delicate foil print detailing with elasticated waist seam", care: "Dry clean recommended or gentle hand wash", fit: "Fitted waist with flared peplum hem" },
    { id: "p10", name: "Wrap Front Maternity Dress", category: "Maternity Wear", categorySlug: "maternity-wear", price: 2199, mrp: 2999, sizes: ["M", "L", "XL"], image: "/images/catetop.jpg", isNew: true, popularity: 80, description: "Adaptable wrap-front midi dress that adjusts with your changing silhouette through all trimesters and postpartum nursing.", fabric: "Stretch Cotton Lycra jersey blend", craft: "Overlapping true wrap design with reinforced self-tie belt", care: "Machine wash cold; reshape whilst damp", fit: "Adjustable wrap fit · Midi length (45 inches)" },
    { id: "p11", name: "Printed A-Line Midi Dress", category: "Dresses", categorySlug: "dresses", price: 1799, mrp: 2299, sizes: ["S", "M", "L", "XL"], image: "/images/kurtas1.jpg", isNew: false, popularity: 73, description: "Graceful everyday midi dress decorated with blooming botanical vines and finished with side pockets.", fabric: "100% Organic Cotton Mul", craft: "All-over botanical rotary print with deep practical pockets", care: "Machine wash cold inside out", fit: "A-Line flare · Midi length (46 inches)" },
    { id: "p12", name: "Cotton Kurta Set with Palazzo", category: "Kurta Sets", categorySlug: "kurta-sets", price: 2299, mrp: 2799, sizes: ["S", "M", "L", "XL", "XXL"], image: "/images/tops.jpg", isNew: false, popularity: 78, description: "Everyday comfort coordinated set comprising a round-neck block print kurta and matching airy palazzo.", fabric: "Pure South Cotton (breathable weave)", craft: "Contrast border trims along hem and cuffs", care: "Gentle hand wash with mild liquid detergent", fit: "Comfort regular fit kurta with elasticated waist palazzo" },
    { id: "p13", name: "Blush Rose Embroidered Dress", category: "Dresses", categorySlug: "dresses", price: 2699, mrp: 3499, sizes: ["XS", "S", "M", "L", "XL"], image: "/images/dress.jpg", isNew: true, popularity: 89, description: "Muted blush rose silhouette accented with tone-on-tone French knot embroidery across the collar and sleeves.", fabric: "Mulmul Cotton with full breathable lining", craft: "Handmade French knot & mirror-work detailing", care: "Hand wash inside out with cold water", fit: "Flared fit with tiered flounce · Midi length (47 inches)" },
    { id: "p14", name: "Pastel Sage Everyday Kurta", category: "Kurtas", categorySlug: "kurtas", price: 1299, mrp: 1699, sizes: ["S", "M", "L", "XL"], image: "/images/causal-waer.jpg", isNew: false, popularity: 71, description: "Soothing sage green tone with delicate pintuck details down the front placket.", fabric: "100% Breathable Slub Cotton", craft: "Fine vertical pintucks with pearl buttons", care: "Regular gentle wash in cold water", fit: "Straight comfortable fit with side pockets" },
    { id: "p15", name: "Handloom Lace Trim Midi Dress", category: "Dresses", categorySlug: "dresses", price: 2299, mrp: 2999, sizes: ["S", "M", "L", "XL"], image: "/images/about.jpg", isNew: true, popularity: 82, description: "Soft ivory and floral print dress elevated with cotton crochet lace inserted along the yoke and hem.", fabric: "Handspun Cotton with soft cotton voile lining", craft: "Crochet lace insets with hand-finished sleeve cuffs", care: "Gentle cold hand wash; warm iron", fit: "Relaxed fit with waist tie-ups" },
    { id: "p16", name: "Ivory Floral Threadwork Kurta", category: "Kurtas", categorySlug: "kurtas", price: 1799, mrp: 2499, sizes: ["S", "M", "L", "XL", "XXL"], image: "/images/kurtas.jpg", isNew: true, popularity: 86, description: "Pristine ivory base elevated with intricate Kashmiri-style pastel floral threadwork across the neckline.", fabric: "Chanderi Cotton with pure cotton lining", craft: "Fine multi-colored pastel Resham threadwork", care: "Dry clean for best longevity", fit: "Straight silhouette · Knee length (45 inches)" },
    { id: "p17", name: "Mustard Embroidered Kurta Set", category: "Kurta Sets", categorySlug: "kurta-sets", price: 2999, mrp: 4299, sizes: ["M", "L", "XL"], image: "/images/cateogry1.jpg", isNew: false, popularity: 85, description: "Warm mustard palette accented with golden Gota Patti lace, accompanied by straight trousers and printed dupatta.", fabric: "Cotton Silk Blend with mul lining", craft: "Handcrafted Gota Patti work on neck and dupatta borders", care: "Dry clean recommended", fit: "Classic straight kurta with ankle-length trousers" },
    { id: "p18", name: "Festive Zari Border Kurta", category: "Kurtas", categorySlug: "kurtas", price: 2199, mrp: 3199, sizes: ["M", "L", "XL"], image: "/images/festive-wear.jpg", isNew: true, popularity: 85, description: "Rich jewel-tone kurta framed with woven real-look golden zari borders on sleeves and hemline.", fabric: "Tussar Cotton Blend", craft: "Jacquard woven zari borders with mandarin collar", care: "Dry clean only", fit: "Tailored straight fit · Calf length" },
    { id: "p19", name: "Minimalist Linen Button Top", category: "Tops", categorySlug: "tops", price: 899, mrp: 1399, sizes: ["S", "M", "L", "XL"], image: "/images/tops.jpg", isNew: false, popularity: 69, description: "Clean modern work-to-weekend silhouette featuring coconut shell buttons and a boxy breathable cut.", fabric: "55% Linen, 45% Cotton", craft: "Natural coconut shell buttons with notch collar", care: "Machine wash cold; tumble dry low or line dry", fit: "Boxy relaxed fit · Waist length (22 inches)" },
    { id: "p20", name: "Rosebud Embroidered Kurta Set", category: "Kurta Sets", categorySlug: "kurta-sets", price: 3299, mrp: 4999, sizes: ["S", "M", "L", "XL"], image: "/images/cateogry1.jpg", isNew: true, popularity: 93, description: "Scattered rosebud motifs embroidered by hand on fine Chanderi, paired with a matching embroidered organza dupatta.", fabric: "Chanderi Kurta, Cotton Satin Pants, Pure Organza Dupatta", craft: "Intricate floral hand embroidery with scallop cut-work", care: "Dry clean only", fit: "Straight fit kurta with tapered pants" },
    { id: "p21", name: "Indigo Block Print Midi Dress", category: "Dresses", categorySlug: "dresses", price: 1899, mrp: 2599, sizes: ["S", "M", "L", "XL"], image: "/images/co-ords-set.jpg", isNew: false, popularity: 79, description: "Classic indigo Dabu block print on pure cotton with subtle shoulder smocking and practical side pockets.", fabric: "100% Bagru Dabu Printed Cotton", craft: "Authentic mud-resist hand block indigo dyeing", care: "Wash separately in cold water (natural bleeding normal)", fit: "Fit & Flare midi with drawstring waist" },
    { id: "p22", name: "Ivory Scallop Hem Kurta Set", category: "Kurta Sets", categorySlug: "kurta-sets", price: 3699, mrp: 5499, sizes: ["S", "M", "L", "XL", "XXL"], image: "/images/cateethnic.jpg", isNew: true, popularity: 87, description: "Contemporary designer cut featuring delicate organza scallop appliques along the sleeves, kurti hem and dupatta.", fabric: "Chanderi Silk with Santoon lining", craft: "Laser-cut embroidered organza scallops with pearl beads", care: "Dry clean only", fit: "Straight fit kurta with culotte pants" },
    { id: "p23", name: "Embroidered Boho Cotton Top", category: "Tops", categorySlug: "tops", price: 1099, mrp: 1699, sizes: ["XS", "S", "M", "L"], image: "/images/catetop.jpg", isNew: true, popularity: 75, description: "Bohemian-inspired airy silhouette with tasseled neck ties and multi-color floral yoke embroidery.", fabric: "Pure Cambric Cotton", craft: "Kashmiri thread embroidery with handcrafted tassel tie-ups", care: "Hand wash cold; dry in shade", fit: "Flowy peasant top fit · Hip length" },
    { id: "p24", name: "Lavender Pintuck Daily Kurta", category: "Kurtas", categorySlug: "kurtas", price: 1349, mrp: 1799, sizes: ["S", "M", "L", "XL"], image: "/images/causal-waer.jpg", isNew: false, popularity: 72, description: "Subtle lavender shade with intricate diagonal pin-tucks and wooden buttons for college, office and casual wear.", fabric: "100% Pure Mulmul Cotton", craft: "Diagonal micro pin-tucks with wooden buttons", care: "Machine wash cold on gentle cycle", fit: "Straight cut · Knee length (44 inches)" },
    { id: "p25", name: "Lace Trim Mandarin Collar Top", category: "Tops", categorySlug: "tops", price: 949, mrp: 1499, sizes: ["S", "M", "L", "XL"], image: "/images/tops.jpg", isNew: true, popularity: 72, description: "Chic mandarin collar shirt-style top with delicate crochet lace inserts along the front placket and cuff bands.", fabric: "100% Cotton Poplin", craft: "Crochet lace insets with concealed mother-of-pearl buttons", care: "Machine wash cold; steam iron", fit: "Smart semi-formal fit · Hip length (25 inches)" },
    { id: "p26", name: "Classic Navy Casual Kurta", category: "Kurtas", categorySlug: "kurtas", price: 1249, mrp: 1649, sizes: ["M", "L", "XL", "XXL"], image: "/images/co-ords-set.jpg", isNew: false, popularity: 68, description: "Deep navy cotton kurta with contrast white thread Kantha-stitch borders along the placket and 3/4 sleeves.", fabric: "100% Cotton", craft: "Kantha stitch detailing with side slits", care: "Machine wash cold with like colours", fit: "Comfort straight fit · Calf length" },
    { id: "p27", name: "Blossom Nursing Friendly Kurta", category: "Maternity Wear", categorySlug: "maternity-wear", price: 1899, mrp: 2599, sizes: ["S", "M", "L", "XL", "XXL"], image: "/images/causal-waer.jpg", isNew: true, popularity: 83, description: "Gentle floral print on soft breathable fabric with double-hidden vertical feeding zips that keep you comfortable all day.", fabric: "Rayon Cotton Blend (breathable & ultra-soft)", craft: "Concealed 12-inch nursing zippers under decorative pleats", care: "Gentle cold machine wash; tumble dry low", fit: "A-Line empire waist with soft pleats" },
    { id: "p28", name: "Dual-Zip Comfort Maternity Dress", category: "Maternity Wear", categorySlug: "maternity-wear", price: 2399, mrp: 3299, sizes: ["M", "L", "XL", "XXL"], image: "/images/dress.jpg", isNew: true, popularity: 81, description: "Elegant tier-flared silhouette crafted to accommodate bump growth throughout pregnancy with discreet dual feeding access.", fabric: "100% Pure Mul Cotton with full soft lining", craft: "Double invisible zip access concealed in front princess seams", care: "Gentle hand wash cold; line dry in shade", fit: "Tiered relaxed fit · Midi length (48 inches)" },
    { id: "p29", name: "Peacock Blue Silk Blend Kurta", category: "Kurtas", categorySlug: "kurtas", price: 2099, mrp: 2899, sizes: ["S", "M", "L", "XL"], image: "/images/cateethnic.jpg", isNew: false, popularity: 77, description: "Lustrous peacock blue silk blend adorned with zari floral booti work and a keyhole neckline with golden tassels.", fabric: "Art Silk Chanderi with cotton lining", craft: "Woven Zari booti work with handmade tassel tie", care: "Dry clean only", fit: "Straight tailored silhouette · Calf length (46 inches)" },
    { id: "p30", name: "Olive Green Embroidered Top", category: "Tops", categorySlug: "tops", price: 1149, mrp: 1599, sizes: ["XS", "S", "M", "L", "XL"], image: "/images/festive-wear.jpg", isNew: false, popularity: 67, description: "Earthy olive green canvas highlighted with cream chain-stitch embroidery around the neckline and elasticated balloon sleeves.", fabric: "100% Cotton Linen", craft: "Chain-stitch floral embroidery with balloon sleeves", care: "Hand wash cold; dry in shade", fit: "Regular fit · Waist length (23 inches)" },
  ];
}

module.exports = {
  pool,
  initDB,
};

