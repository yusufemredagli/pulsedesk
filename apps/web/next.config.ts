import type { NextConfig } from 'next';
const config: NextConfig = {
  transpilePackages: ['@pulsedesk/ui', '@pulsedesk/shared'],
};
export default config;
