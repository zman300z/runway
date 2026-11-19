import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transactionsToCSV, csvCell } from '../js/csv.js';
import { data, expense, refund, income, adjustment, card, cardPayment, cashback } from './helpers.js';

test('exports every transaction, oldest first, ready for a spreadsheet', () => {
  const d = data({
    transactions: [
      expense('2026-11-02', 450, 'coffee', { note: 'Latte, oat milk' }),
      expense('2026-11-01', 1200, 'eating-out', { note: 'He said "hi"' }),
      income('2026-11-07', 50000),
      refund('2026-11-08', 1000, 'eating-out', { note: 'Paid back' }),
      adjustment('2026-11-09', -1234, { note: '=SUM(A1:A9)' }),
      expense('2026-11-10', 999, 'eating-out', { bucket: 'need', note: 'line one\nline two' }),
    ],
  });
  const csv = transactionsToCSV(d);
  assert.ok(csv.startsWith(String.fromCharCode(0xfeff)), 'byte-order mark so Excel reads emoji and accents');
  const lines = csv.slice(1).split('\r\n');
  assert.equal(lines[0], 'Date,Type,Category,Bucket,Amount,Paid with,Note');
  assert.equal(lines[1], '2026-11-01,Expense,Eating Out,Want,-12.00,Debit,"He said ""hi"""');
  assert.equal(lines[2], '2026-11-02,Expense,Coffee,Want,-4.50,Debit,"Latte, oat milk"');
  assert.equal(lines[3], '2026-11-07,Income,Paycheck,,500.00,Debit,');
  assert.equal(lines[4], '2026-11-08,Refund,Eating Out,Want,10.00,Debit,Paid back');
  assert.equal(lines[5], "2026-11-09,Adjustment,,,-12.34,Debit,'=SUM(A1:A9)");
  assert.equal(lines[6], '2026-11-10,Expense,Eating Out,Need,-9.99,Debit,"line one\nline two"');
  assert.ok(csv.endsWith('line two"\r\n'));
});

test('card purchases, card payments and cash back show what paid for them', () => {
  const d = data({
    cards: [card({ name: '=Student Card' })],
    transactions: [
      expense('2026-11-12', 4000, 'groceries', { account: 'card1' }),
      cardPayment('2026-11-16', 12000),
      cashback('2026-11-17', 1500),
      income('2026-11-18', 1000, { source: 'rewards' }),
    ],
  });
  const lines = transactionsToCSV(d).slice(1).split('\r\n');
  assert.equal(lines[1], "2026-11-12,Expense,Groceries,Need,-40.00,'=Student Card,");
  assert.equal(lines[2], "2026-11-16,Card payment,'=Student Card,,-120.00,Debit,");
  assert.equal(lines[3], "2026-11-17,Cash back,,,15.00,'=Student Card,");
  assert.equal(lines[4], '2026-11-18,Income,Rewards,,10.00,Debit,');
});

test('cells are quoted only when needed, and text cannot start a formula', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell('-4.50'), '-4.50');
  assert.equal(csvCell('+1 555', true), "'+1 555");
  assert.equal(csvCell('@me', true), "'@me");
});
