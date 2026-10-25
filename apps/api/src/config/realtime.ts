export function allowedFrontendOrigins(
  config: Record<string, unknown>,
): string[] {
  const value =
    config.FRONTEND_ORIGINS ??
    (config.NODE_ENV === 'production' ? '' : 'http://localhost:3000');
  if (typeof value !== 'string' || !value.trim())
    throw new Error('FRONTEND_ORIGINS must contain explicit frontend origins');
  const origins = value.split(',').map((entry) => entry.trim());
  if (
    origins.length > 20 ||
    origins.some((entry) => {
      try {
        const url = new URL(entry);
        return (
          !['http:', 'https:'].includes(url.protocol) ||
          url.origin !== entry ||
          !!url.username ||
          !!url.password ||
          url.hostname.includes('*') ||
          (config.NODE_ENV === 'production' && url.protocol !== 'https:')
        );
      } catch {
        return true;
      }
    })
  )
    throw new Error(
      'FRONTEND_ORIGINS must be exact HTTP(S) origins; production requires HTTPS',
    );
  return [...new Set(origins)];
}
