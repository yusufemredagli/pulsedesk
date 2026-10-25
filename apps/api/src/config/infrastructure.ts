function integer(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  name: string,
): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max)
    throw new Error(`${name} is invalid`);
  return parsed;
}
export function validateInfrastructure(config: Record<string, unknown>) {
  const value = config.REDIS_URL;
  if (typeof value !== 'string' || !value)
    throw new Error('REDIS_URL is required');
  try {
    const url = new URL(value);
    if (
      !['redis:', 'rediss:'].includes(url.protocol) ||
      !url.hostname ||
      !/^\/\d*$/.test(url.pathname || '/') ||
      Number(url.pathname.slice(1) || 0) > 15
    )
      throw new Error();
  } catch {
    throw new Error('REDIS_URL must be a valid Redis URL (database 0–15)');
  }
  const prefix = config.SLA_QUEUE_PREFIX ?? 'pulsedesk';
  if (typeof prefix !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(prefix))
    throw new Error('SLA_QUEUE_PREFIX is invalid');
  return {
    ...config,
    REDIS_URL: value,
    SLA_QUEUE_PREFIX: prefix,
    OUTBOX_POLL_INTERVAL_MS: integer(
      config.OUTBOX_POLL_INTERVAL_MS,
      2000,
      100,
      60000,
      'OUTBOX_POLL_INTERVAL_MS',
    ),
  };
}
