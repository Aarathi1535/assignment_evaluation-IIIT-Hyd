import * as zxing from '@zxing/library';

/**
 * Generates an SVG string of a QR Code using @zxing/library QRCodeWriter.
 * Pure TypeScript implementation without native canvas dependency.
 * Lightweight, resolution-independent, and works in Node, Next.js server, and browser.
 */
export function generateQRCodeSvg(payload: string, size = 260): string {
    const writer = new zxing.QRCodeWriter();
    const hints = new Map<zxing.EncodeHintType, unknown>();
    hints.set(zxing.EncodeHintType.MARGIN, 1);

    const qrMatrix = writer.encode(payload, zxing.BarcodeFormat.QR_CODE, 0, 0, hints);
    const width = qrMatrix.getWidth();
    const height = qrMatrix.getHeight();

    let rects = '';
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (qrMatrix.get(x, y)) {
                rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="#0f172a" />`;
            }
        }
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${size}" height="${size}" shape-rendering="crispEdges">
  <rect width="100%" height="100%" fill="#ffffff" rx="4" />
  ${rects}
</svg>`;
}

/**
 * Generates a Data URL from SVG string.
 */
export function generateQRCodeDataUrl(payload: string, size = 260): string {
    const svg = generateQRCodeSvg(payload, size);
    const base64 = Buffer.from(svg).toString('base64');
    return `data:image/svg+xml;base64,${base64}`;
}

/**
 * Generates a unique, human-friendly 6-character uppercase alphanumeric join code.
 * Excludes easily confused characters (0, O, 1, I).
 */
export function generateJoinCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        const randomIndex = Math.floor(Math.random() * chars.length);
        code += chars[randomIndex];
    }
    return code;
}
