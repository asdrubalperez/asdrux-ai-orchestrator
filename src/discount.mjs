function roundToTwo(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateTotal(monto) {
  if (monto < 0) {
    throw new Error('El monto no puede ser negativo');
  }

  const normalized = roundToTwo(monto);

  if (normalized <= 100) {
    return normalized;
  }

  return roundToTwo(normalized * 0.9);
}
