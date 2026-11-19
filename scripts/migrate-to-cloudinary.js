const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config();

let pool, uploadProductImage, isConfigured;
try {
  ({ pool } = require('../db'));
  ({ uploadProductImage, isConfigured } = require('../services/cloudinary'));
} catch (_) {
  ({ pool } = require('../server/db'));
  ({ uploadProductImage, isConfigured } = require('../server/services/cloudinary'));
}

async function migrate() {
  console.log('--- Starting Cloudinary Migration for Existing Products ---');
  if (!isConfigured) {
    console.error('Cloudinary is not configured. Check .env variables.');
    process.exit(1);
  }

  // Ensure columns exist
  try {
    await pool.execute('ALTER TABLE products ADD COLUMN IF NOT EXISTS image_public_id VARCHAR(255) NULL');
    console.log('Ensured column image_public_id exists.');
  } catch (err) {
    console.warn('Column image_public_id alter notice:', err.message);
  }
  try {
    await pool.execute('ALTER TABLE products ADD COLUMN IF NOT EXISTS gallery_public_ids JSON NULL');
    console.log('Ensured column gallery_public_ids exists.');
  } catch (err) {
    console.warn('Column gallery_public_ids alter notice:', err.message);
  }

  const [rows] = await pool.execute('SELECT id, name, category, image, gallery, image_public_id, gallery_public_ids FROM products');
  console.log(`Found ${rows.length} products in database.`);

  let migratedCount = 0;

  for (const product of rows) {
    console.log(`\nProcessing product: [${product.id}] ${product.name}`);
    let updated = false;
    let newImage = product.image;
    let newImagePublicId = product.image_public_id;

    // Check main image
    if (product.image && product.image.startsWith('data:image/')) {
      console.log(`  -> Uploading main image (${product.image.substring(0, 30)}...) to Cloudinary...`);
      try {
        const res = await uploadProductImage(product.image, {
          type: 'main',
          productName: product.name,
          productId: product.id,
        });
        newImage = res.secure_url;
        newImagePublicId = res.public_id;
        console.log(`     Uploaded: ${newImage} (public_id: ${newImagePublicId})`);
        updated = true;
      } catch (err) {
        console.error(`     Failed to upload main image for ${product.id}:`, err.message);
      }
    } else {
      console.log(`  -> Main image already non-base64 (${product.image ? product.image.substring(0, 50) : 'none'})`);
    }

    // Check gallery
    let gallery = [];
    try {
      gallery = typeof product.gallery === 'string' ? JSON.parse(product.gallery) : (product.gallery || []);
    } catch (_) {
      gallery = product.gallery ? [product.gallery] : [];
    }

    const newGallery = [];
    const newGalleryPublicIds = [];

    for (let i = 0; i < gallery.length; i++) {
      const item = gallery[i];
      if (typeof item === 'string' && item.startsWith('data:image/')) {
        console.log(`  -> Uploading gallery image ${i + 1} (${item.substring(0, 30)}...) to Cloudinary...`);
        try {
          const res = await uploadProductImage(item, {
            type: 'gallery',
            productName: product.name,
            productId: `${product.id}_g${i + 1}`,
          });
          newGallery.push(res.secure_url);
          newGalleryPublicIds.push(res.public_id);
          console.log(`     Uploaded: ${res.secure_url}`);
          updated = true;
        } catch (err) {
          console.error(`     Failed to upload gallery image ${i} for ${product.id}:`, err.message);
          newGallery.push(item);
        }
      } else {
        newGallery.push(item);
        if (typeof item === 'string' && item.includes('res.cloudinary.com')) {
          const { extractPublicId } = require('../server/services/cloudinary');
          newGalleryPublicIds.push(extractPublicId(item) || null);
        }
      }
    }

    // If gallery was empty but main image was uploaded, sync gallery with main image
    if (newGallery.length === 0 && newImage) {
      newGallery.push(newImage);
      if (newImagePublicId) newGalleryPublicIds.push(newImagePublicId);
    }

    if (updated) {
      console.log(`  -> Updating product ${product.id} in database...`);
      await pool.execute(
        `UPDATE products SET
          image = ?,
          image_public_id = ?,
          gallery = ?,
          gallery_public_ids = ?
        WHERE id = ?`,
        [
          newImage,
          newImagePublicId,
          JSON.stringify(newGallery),
          JSON.stringify(newGalleryPublicIds),
          product.id,
        ]
      );
      migratedCount++;
      console.log(`  -> Product ${product.id} successfully updated with Cloudinary URLs.`);
    } else {
      console.log(`  -> No base64 images found for ${product.id}, skipping DB update.`);
    }
  }

  console.log(`\n--- Migration Complete. Migrated ${migratedCount} of ${rows.length} products. ---`);
  await pool.end();
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
