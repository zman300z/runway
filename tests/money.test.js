import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMoney, formatMoney, formatWholeMoney, centsToDecimal, floorDollars, isValidAmount, MAX_CENTS,
  keypadPress, entryToCents, centsToEntry, formatEntry, sumCents,
} from '../js/money.js';

test('parses everyday amounts into exact cents', () => {
  assert.equal(parseMoney('4.5'), 450);
  assert.equal(parseMoney('4.50'), 450);
  assert.equal(parseMoney('$1,234.56'), 123456);
  assert.equal(parseMoney('  $12 '), 1200);
  assert.equal(parseMoney('4.'), 400);
  assert.equal(parseMoney('.5'), 50);
  assert.equal(parseMoney('0.01'), 1);
  assert.equal(parseMoney('007.10'), 710);
  assert.equal(parseMoney('1,000,000'), 100000000);
  assert.equal(parseMoney(4.5), 450);
});

test('parses negative amounts', () => {
  assert.equal(parseMoney('-3.20'), -320);
  assert.equal(parseMoney('-$3.20'), -320);
  assert.equal(parseMoney('$-3.20'), -320);
  assert.equal(parseMoney('(3.20)'), -320);
  assert.equal(parseMoney('−3.20'), -320);
  assert.equal(parseMoney('-0'), 0);
});

test('rejects anything that is not clearly an amount', () => {
  for (const bad of ['', '   ', 'abc', '.', '$', '1.2.3', '4,50', '12,34,567', '--4', '-$-4', '1e3', 'NaN', '$ 4 5', '(-4)', null, undefined, {}, Infinity]) {
    assert.equal(parseMoney(bad), null, `should reject ${String(bad)}`);
  }
});

test('rounds past two decimals, half away from zero', () => {
  assert.equal(parseMoney('4.555'), 456);
  assert.equal(parseMoney('4.554'), 455);
  assert.equal(parseMoney('-4.555'), -456);
  assert.equal(parseMoney('0.005'), 1);
  assert.equal(parseMoney(0.1 + 0.2), 30);
});

test('0.1 + 0.2 is exactly 30 cents', () => {
  assert.notEqual(0.1 + 0.2, 0.3); // the floating point trap Runway avoids
  const total = parseMoney('0.1') + parseMoney('0.2');
  assert.equal(total, 30);
  assert.equal(formatMoney(total), '$0.30');
  // Adding a dime ten times stays exact in cents.
  let cents = 0;
  for (let i = 0; i < 10; i += 1) cents += parseMoney('0.10');
  assert.equal(cents, 100);
  assert.equal(formatMoney(cents), '$1.00');
});

test('formats cents as US dollars', () => {
  assert.equal(formatMoney(0), '$0.00');
  assert.equal(formatMoney(5), '$0.05');
  assert.equal(formatMoney(450), '$4.50');
  assert.equal(formatMoney(123456), '$1,234.56');
  assert.equal(formatMoney(-450), '-$4.50');
  assert.equal(formatMoney(100000000), '$1,000,000.00');
  assert.equal(formatMoney(450, { sign: true }), '+$4.50');
  assert.equal(formatMoney(-450, { sign: true }), '-$4.50');
  assert.equal(formatMoney(0, { sign: true }), '$0.00');
  assert.equal(formatWholeMoney(123456), '$1,235');
});

test('centsToDecimal is exact for big and small numbers', () => {
  assert.equal(centsToDecimal(0), '0.00');
  assert.equal(centsToDecimal(7), '0.07');
  assert.equal(centsToDecimal(-123456), '-1234.56');
  assert.equal(centsToDecimal(900719925474099), '9007199254740.99');
});

test('whole dollars round down', () => {
  assert.equal(floorDollars(2399), 23);
  assert.equal(floorDollars(100), 1);
  assert.equal(floorDollars(99), 0);
  assert.equal(floorDollars(0), 0);
  assert.equal(floorDollars(-450), -5);
});

test('amount limits', () => {
  assert.equal(isValidAmount(MAX_CENTS), true);
  assert.equal(isValidAmount(MAX_CENTS + 1), false);
  assert.equal(isValidAmount(4.5), false);
  assert.equal(sumCents([450, 1050, -100]), 1400);
});

test('keypad entry rules', () => {
  let entry = '';
  for (const key of ['4', '.', '5']) entry = keypadPress(entry, key);
  assert.equal(entry, '4.5');
  assert.equal(entryToCents(entry), 450);
  assert.equal(keypadPress('4.50', '1'), '4.50', 'at most two decimals');
  assert.equal(keypadPress('4.5', '.'), '4.5', 'one decimal point');
  assert.equal(keypadPress('', '.'), '0.');
  assert.equal(keypadPress('0', '7'), '7', 'no leading zeros');
  assert.equal(keypadPress('0', '0'), '0');
  assert.equal(keypadPress('999999', '9'), '999999', 'six whole-dollar digits max');
  assert.equal(keypadPress('4.5', 'back'), '4.');
  assert.equal(keypadPress('4', 'back'), '');
  assert.equal(keypadPress('', 'back'), '');
  assert.equal(keypadPress('4.5', 'clear'), '');
  assert.equal(keypadPress('4', 'x'), '4');
  assert.equal(entryToCents(''), 0);
  assert.equal(entryToCents('0.'), 0);
  assert.equal(centsToEntry(450), '4.50');
  assert.equal(centsToEntry(400), '4');
  assert.equal(centsToEntry(-450), '4.50');
  assert.equal(centsToEntry(0), '');
  assert.equal(formatEntry(''), '$0');
  assert.equal(formatEntry('1234.5'), '$1,234.5');
  assert.equal(formatEntry('12.'), '$12.');
});
