/**
 * Device capabilities types for screenshot, camera, and location access
 */

export interface ScreenshotRequest {
  /** Target to capture: 'screen' for full screen, or window title/ID */
  target?: 'screen' | string;
  /** Include cursor in screenshot (default: false) */
  includeCursor?: boolean;
  /** Image format (default: 'png') */
  format?: 'png' | 'jpeg';
  /** JPEG quality 1-100 (default: 90) */
  quality?: number;
}

export interface ScreenshotResult {
  /** Path to saved screenshot file */
  path: string;
  /** Base64-encoded image data */
  data: string;
  /** MIME type of the image */
  mimeType: string;
  /** Width in pixels */
  width: number;
  /** Height in pixels */
  height: number;
  /** File size in bytes */
  size: number;
  /** Timestamp when captured */
  capturedAt: string;
}

export interface CameraRequest {
  /** Camera mode: 'photo' for still image, 'barcode' for QR/barcode scanning */
  mode: 'photo' | 'barcode';
  /** Preferred camera (default: 'user' for front camera) */
  facingMode?: 'user' | 'environment';
  /** Image format for photo mode (default: 'jpeg') */
  format?: 'png' | 'jpeg';
  /** JPEG quality 1-100 (default: 90) */
  quality?: number;
}

export interface CameraResult {
  /** Path to saved photo file */
  path?: string;
  /** Base64-encoded image data */
  data?: string;
  /** MIME type of the image */
  mimeType?: string;
  /** For barcode mode: decoded text */
  barcodeText?: string;
  /** For barcode mode: barcode format (QR, EAN, etc.) */
  barcodeFormat?: string;
  /** Timestamp when captured */
  capturedAt: string;
}

export interface LocationRequest {
  /** Request high accuracy (may take longer and use more power) */
  highAccuracy?: boolean;
  /** Maximum age of cached location in milliseconds (default: 60000) */
  maximumAge?: number;
  /** Timeout in milliseconds (default: 10000) */
  timeout?: number;
}

export interface LocationResult {
  /** Latitude in decimal degrees */
  latitude: number;
  /** Longitude in decimal degrees */
  longitude: number;
  /** Accuracy in meters */
  accuracy: number;
  /** Altitude in meters (if available) */
  altitude?: number;
  /** Altitude accuracy in meters (if available) */
  altitudeAccuracy?: number;
  /** Heading in degrees (if available) */
  heading?: number;
  /** Speed in m/s (if available) */
  speed?: number;
  /** Timestamp when location was determined */
  timestamp: number;
  /** Timezone identifier (e.g., 'America/New_York') */
  timezone?: string;
  /** Approximate city/region (optional, from reverse geocoding) */
  locality?: string;
}

export interface DeviceCapabilityCheck {
  screenshot: boolean;
  camera: boolean;
  location: boolean;
  /** Error message if capability is not available */
  error?: string;
}
