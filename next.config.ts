import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    '@napi-rs/canvas',
    'pdfjs-dist',
    'mongoose',
    'mongodb',
    'bcryptjs',
  ],
  experimental: {
    optimizePackageImports: [
      'lucide-react',
      '@zxing/library',
      'pdf-lib',
      'konva',
      '@hookform/resolvers',
    ],
    turbopackFileSystemCacheForDev: true,
  },
};

export default nextConfig;
