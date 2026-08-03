// FEATURE-025-Parte-3, sección 5.15: taxonomía común de errores funcionales para los 4 adaptadores
// de mapeo de intake. El mensaje nunca incluye el cuerpo crudo de la respuesta del proveedor ni
// ningún secreto -- eso se loguea server-side (console.error) por separado, nunca en el mensaje que
// llega al caller/UI.

export class IntakeMappingError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export class IntakeMappingAuthenticationRequiredError extends IntakeMappingError {
  constructor(message: string) {
    super("intake_mapping_authentication_required", message);
  }
}

export class IntakeMappingModelUnsupportedError extends IntakeMappingError {
  constructor(message: string) {
    super("intake_mapping_model_unsupported", message);
  }
}

export class IntakeMappingRateLimitedError extends IntakeMappingError {
  constructor(message: string) {
    super("intake_mapping_rate_limited", message);
  }
}

export class IntakeMappingProviderUnavailableError extends IntakeMappingError {
  constructor(message: string) {
    super("intake_mapping_provider_unavailable", message);
  }
}

export class IntakeMappingTimeoutError extends IntakeMappingError {
  constructor(message: string) {
    super("intake_mapping_timeout", message);
  }
}

export class IntakeMappingInvalidResponseError extends IntakeMappingError {
  constructor(message: string) {
    super("intake_mapping_invalid_response", message);
  }
}

export class IntakeMappingFailedError extends IntakeMappingError {
  constructor(message: string) {
    super("intake_mapping_failed", message);
  }
}

/**
 * Clasificación genérica por status HTTP -- suficiente para las dos APIs REST (Anthropic/OpenAI)
 * sin acoplarse a los códigos de error específicos de cada proveedor (Riesgo 8/9 del diseño: la
 * API puede cambiar, el adaptador no debe depender de su forma exacta más de lo necesario).
 */
export function classifyHttpMappingError(status: number, providerLabel: string): IntakeMappingError {
  if (status === 401 || status === 403) {
    return new IntakeMappingAuthenticationRequiredError(`${providerLabel} rechazó la credencial (HTTP ${status}).`);
  }
  if (status === 429) {
    return new IntakeMappingRateLimitedError(`${providerLabel} aplicó un límite de uso (HTTP ${status}).`);
  }
  if (status >= 500) {
    return new IntakeMappingProviderUnavailableError(`${providerLabel} no está disponible en este momento (HTTP ${status}).`);
  }
  if (status === 400 || status === 404 || status === 422) {
    return new IntakeMappingModelUnsupportedError(`${providerLabel} rechazó el modelo o la solicitud (HTTP ${status}).`);
  }
  return new IntakeMappingFailedError(`${providerLabel} respondió con un error (HTTP ${status}).`);
}
