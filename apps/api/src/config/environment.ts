import { allowedFrontendOrigins } from './realtime';
import { validateInfrastructure } from './infrastructure';
function seconds(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(
      `${name} must be an integer between ${minimum} and ${maximum} seconds`,
    );
  }
  return parsed;
}

export function validateEnvironment(config: Record<string, unknown>) {
  const port = seconds(config.PORT, 4000, 1, 65535, 'PORT');
  const secret = config.JWT_ACCESS_SECRET;
  if (
    typeof secret !== 'string' ||
    Buffer.byteLength(secret) < 32 ||
    new Set(secret).size < 12 ||
    /change.?me|placeholder|example|development|your.?secret/i.test(secret)
  ) {
    throw new Error(
      'JWT_ACCESS_SECRET must be a strong secret of at least 32 bytes',
    );
  }
  const origins = allowedFrontendOrigins(config);
  return {
    ...validateInfrastructure(config),
    FRONTEND_ORIGINS: origins.join(','),
    PORT: port,
    JWT_ACCESS_SECRET: secret,
    JWT_ACCESS_TTL: seconds(
      config.JWT_ACCESS_TTL,
      900,
      60,
      1200,
      'JWT_ACCESS_TTL',
    ),
    REFRESH_TOKEN_TTL: seconds(
      config.REFRESH_TOKEN_TTL,
      2592000,
      3600,
      7776000,
      'REFRESH_TOKEN_TTL',
    ),
  };
}
