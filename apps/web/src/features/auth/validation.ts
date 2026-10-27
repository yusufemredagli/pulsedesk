export interface AuthFields {
  email: string;
  password: string;
  name?: string;
  organizationName?: string;
}
export function validateAuth(
  input: AuthFields,
  register: boolean,
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim()) ||
    input.email.trim().length > 254
  )
    errors.email = 'Geçerli bir iş e-postası adresi girin.';
  if (input.password.length < 10 || input.password.length > 128)
    errors.password = '10–128 karakter kullanın.';
  if (register)
    for (const key of ['name', 'organizationName'] as const)
      if (!input[key]?.trim() || input[key]!.trim().length > 100)
        errors[key] = '1–100 karakter girin.';
  return errors;
}
