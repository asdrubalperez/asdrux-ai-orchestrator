import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateTotal } from './discount.mjs';

test('devuelve 0 para un monto de 0', () => {
  assert.equal(calculateTotal(0), 0);
});

test('devuelve 100 sin descuento para un monto de 100', () => {
  assert.equal(calculateTotal(100), 100);
});

test('aplica 10% de descuento a un monto mayor que 100', () => {
  assert.equal(calculateTotal(100.01), 90.01);
});

test('lanza un error para un monto negativo', () => {
  assert.throws(() => calculateTotal(-1), Error);
});

test('normaliza la entrada a dos decimales', () => {
  assert.equal(calculateTotal(12.345), 12.35);
});
