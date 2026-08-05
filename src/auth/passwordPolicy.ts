// FEATURE-041, Scope "Registro público y activación": longitud mínima, mayúsculas, minúsculas,
// números, símbolos. El diseño no fija un número exacto -- 10 caracteres es la decisión de
// implementación (más que el mínimo típico de 8, sin exigir una longitud desproporcionada para un
// producto que todavía no tiene MFA como capa adicional).
export const PASSWORD_MIN_LENGTH = 10;

export interface PasswordPolicyViolation {
  rule: "min_length" | "uppercase" | "lowercase" | "number" | "symbol";
  message: string;
}

export function validatePasswordPolicy(password: string): PasswordPolicyViolation[] {
  const violations: PasswordPolicyViolation[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) {
    violations.push({ rule: "min_length", message: `Debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.` });
  }
  if (!/[A-Z]/.test(password)) {
    violations.push({ rule: "uppercase", message: "Debe incluir al menos una mayúscula." });
  }
  if (!/[a-z]/.test(password)) {
    violations.push({ rule: "lowercase", message: "Debe incluir al menos una minúscula." });
  }
  if (!/[0-9]/.test(password)) {
    violations.push({ rule: "number", message: "Debe incluir al menos un número." });
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    violations.push({ rule: "symbol", message: "Debe incluir al menos un símbolo." });
  }
  return violations;
}
