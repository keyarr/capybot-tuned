export const VIDEO_STICKER_CONFIG = {
  maxDuration: 6, // seconds
  maxFileSize: 50 * 1024 * 1024, // 50MB
  dimensions: {
    width: 512,
    height: 512,
  },
  fps: 24,
  quality: 'medium',
} as const;

export const MAINTENANCE_MODE =
  process.env.MAINTENANCE_MODE === 'true' || false;

// Allowlist: only these phone numbers (digits only, with country code,
// comma-separated) get responses. Empty = respond to everyone.
export const ALLOWED_NUMBERS: string[] = (process.env.ALLOWED_NUMBERS ?? '')
  .split(',')
  .map(n => n.replace(/\D/g, ''))
  .filter(n => n.length > 0);

// Brazil numbers may arrive with or without the 9th mobile digit
// (e.g. 5511999999999 vs 5511988888888) — normalize before comparing.
const normalizeBR = (d: string): string =>
  /^55\d{2}9\d{8}$/.test(d) ? d.slice(0, 4) + d.slice(5) : d;

export const isNumberAllowed = (senderDigits: string): boolean => {
  if (ALLOWED_NUMBERS.length === 0) return true;
  const s = normalizeBR(senderDigits);
  return ALLOWED_NUMBERS.some(n => {
    const e = normalizeBR(n);
    return s === e || s.endsWith(e);
  });
};
