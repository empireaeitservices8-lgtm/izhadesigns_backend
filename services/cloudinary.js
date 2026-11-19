const cloudinary = require('cloudinary').v2;
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
require('dotenv').config();

// Configure Cloudinary SDK
const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
const apiKey = process.env.CLOUDINARY_API_KEY;
const apiSecret = process.env.CLOUDINARY_API_SECRET;

const isConfigured = Boolean(cloudName && apiKey && apiSecret);

if (isConfigured) {
  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
  });
  console.log(`[Cloudinary] Configured for cloud: ${cloudName}`);
} else {
  console.warn('[Cloudinary] Warning: Cloudinary environment variables missing (CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET).');
}

/** Allowed MIME types */
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

/** Allowed extensions */
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

/** Maximum file size: 10MB */
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/**
 * Validate Cloudinary configuration
 */
function validateConfig() {
  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
    throw new Error('Cloudinary credentials are not configured on the server.');
  }
}

/**
 * Sanitize product title into an SEO-friendly filename/slug
 */
function slugifyForSeo(text = '') {
  return String(text)
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .slice(0, 60);
}

/**
 * Extract Cloudinary public_id from a Cloudinary URL
 * e.g. https://res.cloudinary.com/demo/image/upload/v1234567/products/product-main-images/item_123.jpg
 * => products/product-main-images/item_123
 */
function extractPublicId(url) {
  if (!url || typeof url !== 'string' || !url.includes('res.cloudinary.com')) {
    return null;
  }
  try {
    const uploadIndex = url.indexOf('/upload/');
    if (uploadIndex === -1) return null;
    let afterUpload = url.substring(uploadIndex + 8);
    // Strip transformations if any (e.g. f_auto,q_auto/ or c_scale,w_500/)
    const versionMatch = afterUpload.match(/v\d+\/(.+)$/);
    let publicPathWithExt = versionMatch ? versionMatch[1] : afterUpload;
    // Remove query params
    publicPathWithExt = publicPathWithExt.split('?')[0];
    // Remove extension
    const lastDotIndex = publicPathWithExt.lastIndexOf('.');
    if (lastDotIndex !== -1) {
      return publicPathWithExt.substring(0, lastDotIndex);
    }
    return publicPathWithExt;
  } catch (_) {
    return null;
  }
}

/**
 * Upload an image buffer or base64 data URI to Cloudinary
 * @param {Buffer|string} input - Buffer or Base64 data URI
 * @param {object} options
 * @param {'main'|'gallery'} options.type - Image category
 * @param {string} options.productName - Product name for SEO naming
 * @param {string} options.productId - Product ID
 * @param {string} [options.customFolder] - Custom Cloudinary folder
 */
async function uploadProductImage(input, options = {}) {
  validateConfig();

  const type = options.type || 'main';
  const folder = options.customFolder || (type === 'gallery' ? 'products/product-gallery' : 'products/product-main-images');
  const seoSlug = slugifyForSeo(options.productName || 'product');
  const uniqueSuffix = options.productId ? `${options.productId}_${Date.now()}` : `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const publicId = `${seoSlug}_${uniqueSuffix}`;

  const uploadOptions = {
    folder,
    public_id: publicId,
    resource_type: 'image',
    overwrite: true,
    transformation: [
      { fetch_format: 'auto', quality: 'auto' },
    ],
    context: {
      alt: options.productName ? `${options.productName} handcrafted product image` : 'Izha Blooms product',
      caption: options.productName || 'Izha Blooms',
    },
  };

  // If input is a Buffer
  if (Buffer.isBuffer(input)) {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(uploadOptions, (error, result) => {
        if (error) {
          console.error('[Cloudinary] Upload stream error:', error);
          return reject(new Error(error.message || 'Cloudinary upload failed'));
        }
        resolve({
          url: result.secure_url || result.url,
          secure_url: result.secure_url,
          public_id: result.public_id,
          format: result.format,
          width: result.width,
          height: result.height,
          bytes: result.bytes,
        });
      });
      uploadStream.end(input);
    });
  }

  // If input is a string (base64 data URI or remote URL)
  if (typeof input === 'string') {
    if (!input.startsWith('data:image/') && !input.startsWith('http://') && !input.startsWith('https://')) {
      throw new Error('Unsupported image format string for Cloudinary upload.');
    }
    const result = await cloudinary.uploader.upload(input, uploadOptions);
    return {
      url: result.secure_url || result.url,
      secure_url: result.secure_url,
      public_id: result.public_id,
      format: result.format,
      width: result.width,
      height: result.height,
      bytes: result.bytes,
    };
  }

  throw new Error('Invalid input provided for Cloudinary upload. Expected Buffer or base64 string.');
}

/**
 * Delete an image from Cloudinary by public_id or Cloudinary URL
 * @param {string} publicIdOrUrl
 */
async function deleteCloudinaryImage(publicIdOrUrl) {
  if (!publicIdOrUrl) return false;
  validateConfig();

  const publicId = publicIdOrUrl.includes('res.cloudinary.com')
    ? extractPublicId(publicIdOrUrl)
    : publicIdOrUrl;

  if (!publicId) return false;

  try {
    const result = await cloudinary.uploader.destroy(publicId, { resource_type: 'image', invalidate: true });
    console.log(`[Cloudinary] Destroyed image: ${publicId} (result: ${result?.result})`);
    return result?.result === 'ok';
  } catch (err) {
    console.warn(`[Cloudinary] Failed to destroy image ${publicId}:`, err.message);
    return false;
  }
}

/**
 * Apply SEO optimizations (f_auto, q_auto) to a Cloudinary URL
 */
function optimizeCloudinaryUrl(url, { width, height } = {}) {
  if (!url || typeof url !== 'string' || !url.includes('res.cloudinary.com')) {
    return url;
  }
  // If already contains transformation params, avoid duplicating
  if (url.includes('/f_auto,q_auto/') || url.includes('/q_auto,f_auto/')) {
    return url;
  }

  let transform = 'f_auto,q_auto';
  if (width && height) {
    transform += `,c_fill,w_${width},h_${height}`;
  } else if (width) {
    transform += `,c_scale,w_${width}`;
  }

  return url.replace('/upload/', `/upload/${transform}/`);
}

module.exports = {
  cloudinary,
  isConfigured,
  ALLOWED_MIME_TYPES,
  ALLOWED_EXTENSIONS,
  MAX_FILE_SIZE,
  validateConfig,
  slugifyForSeo,
  extractPublicId,
  uploadProductImage,
  deleteCloudinaryImage,
  optimizeCloudinaryUrl,
};
