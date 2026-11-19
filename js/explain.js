// Plain-English versions of every formula, with your live numbers filled in.
// Shape: { title, intro, sections: [{ heading, rows: [{ label, value, total }] }], result, footnote }.
import { formatMoney } from './money.js';
import { formatDate, periodLabel } from './dates.js';
import { yearlyCost, billTotals, CADENCE_UNIT } from './recurring.js';
import { bankEffect, cardSummary, findCard, activeCards, rewardsEstimate, rateText } from './cards.js';

const money = (c) => formatMoney(c);
/** A rate in basis points as a percent: 150 is "1.5%". */
export const ratePct = (bp) => `${rateText(bp)}%`;
const MINUS = '−';
/** "− $5.00", or "+ $5.00" when the amount is negative. */
const less = (c) => (c >= 0 ? `${MINUS} ${money(c)}` : `+ ${money(-c)}`);
const plus = (c) => (c >= 0 ? `+ ${money(c)}` : `${MINUS} ${money(-c)}`);
const row = (label, value, total = false) => ({ label, value, total });

/** "12%", or "Under 1%" when a little is owed. */
export const utilizationText = (c) => (c.reported > 0 && c.utilization === 0 ? 'Under 1%' : `${c.utilization}%`);

export const PACE_LABEL = { ontrack: 'On track', ahead: 'Ahead of pace', over: 'Over limit' };

function budgetSection(s, withDaily) {
  const rows = [
    row('Monthly limit', money(s.limit)),
    row('Spent so far this month', less(s.spent)),
    row('Bills still scheduled this month', less(s.scheduledSpend)),
    row('Left this month', money(s.budgetMonth), true),
  ];
  if (withDaily) {
    rows.push(row('Days left, counting today', `÷ ${s.daysLeft}`));
    rows.push(row('Per day, rounded down', money(s.budgetDaily), true));
  }
  return { heading: 'From your monthly limit', rows };
}

function cashSection(s, withDaily) {
  const toPayday = Boolean(s.payday);
  const rows = [
    row(s.hasCards ? 'Bank balance right now' : 'Balance right now', money(s.balance)),
    row(
      `${s.hasCards ? 'Debit bills' : 'Bills'} due before ${toPayday ? 'payday' : 'the month ends'}`,
      less(s.billsBeforeHorizon),
    ),
  ];
  for (const item of s.cardDueItems ?? []) {
    const when = item.late ? `was due ${formatDate(item.due, 'medium')}, not confirmed yet` : `due ${formatDate(item.due, 'medium')}`;
    rows.push(row(`${item.name} payment, ${when}`, less(item.amount)));
  }
  if (s.futureOutflows) rows.push(row('Purchases dated in the future', less(s.futureOutflows)));
  rows.push(row(toPayday ? 'Cash until payday' : 'Cash until the month ends', money(s.cash), true));
  if (withDaily) {
    rows.push(row(toPayday ? 'Days until payday, counting today' : 'Days left, counting today', `÷ ${s.cashDays}`));
    rows.push(row('Per day, rounded down', money(s.cashDaily), true));
  }
  const heading = toPayday
    ? `From your cash until payday (${formatDate(s.payday, 'medium')})`
    : 'From your cash until the month ends';
  return { heading, rows };
}

const EXPLAINERS = {
  today(s) {
    const sections = [];
    if (s.budgetMonth !== null) sections.push(budgetSection(s, true));
    if (s.cash !== null) sections.push(cashSection(s, true));
    let footnote = '';
    if (s.mode === 'both') {
      footnote = `Runway shows the smaller of ${money(s.budgetDaily)} and ${money(s.cashDaily)}, so it never suggests money you don't have.`;
    } else if (s.mode === 'budget') {
      footnote = 'Add your balance in Settings and Runway will also check that your cash covers this.';
    } else if (s.mode === 'cash') {
      footnote = 'Set a monthly limit in Settings to spread your spending evenly over the month.';
    } else {
      footnote = 'Add your balance or a monthly limit in Settings to see this number.';
    }
    if (s.daily === 0) footnote += ' It never goes below $0.';
    return {
      title: 'Safe to spend today',
      intro: 'Runway works this out two ways and shows the smaller answer.',
      sections,
      result: s.daily === null ? null : { label: 'Safe to spend today', value: money(s.daily) },
      footnote,
    };
  },

  month(s) {
    const sections = [];
    if (s.budgetMonth !== null) sections.push(budgetSection(s, false));
    if (s.cash !== null) sections.push(cashSection(s, false));
    let footnote = '';
    if (s.mode === 'both') {
      footnote = s.monthGuarded
        ? `Your cash until ${s.payday ? 'payday' : 'the month ends'} is lower than what's left of your limit, so Runway shows that instead.`
        : 'Your cash covers what is left of your limit.';
    }
    if (s.month !== null && s.month < 0) footnote += ' Below zero means you are over.';
    return {
      title: 'Left this month',
      intro: `For ${periodLabel(s.period)}, ${s.daysLeft} ${s.daysLeft === 1 ? 'day' : 'days'} to go, counting today.`,
      sections,
      result: s.month === null ? null : { label: 'Left this month', value: money(s.month) },
      footnote: footnote.trim(),
    };
  },

  balance(s, data) {
    const name = s.hasCards ? 'Bank balance' : 'Balance';
    if (!data.balance) {
      return { title: name, intro: 'Add your debit card balance in Settings to track it here.', sections: [] };
    }
    let income = 0;
    let spending = 0;
    let payments = 0;
    let adjustments = 0;
    for (const t of data.transactions) {
      if (t.date < data.balance.startDate || t.date > s.today) continue;
      const effect = bankEffect(t);
      if (t.type === 'cardPayment') payments += t.amount;
      else if (!effect) continue; // on a card: the bank feels it on payment day
      else if (t.type === 'income') income += effect;
      else if (t.type === 'expense') spending += -effect;
      else adjustments += effect;
    }
    const rows = [
      row(`Starting balance on ${formatDate(data.balance.startDate, 'full')}`, money(data.balance.start)),
      row('Income since then', plus(income)),
      row(`${s.hasCards ? 'Debit spending' : 'Spending'} since then (refunds count back)`, less(spending)),
    ];
    if (payments) rows.push(row('Card payments since then', less(payments)));
    if (adjustments) rows.push(row('Adjustments from Reconcile', plus(adjustments)));
    rows.push(row(`${name} now`, money(s.balance), true));
    const reconcile = "If this doesn't match your bank app, tap Reconcile. Runway adds an adjustment for the difference.";
    return {
      title: name,
      intro: 'Your starting balance plus everything logged since that day.',
      sections: [{ heading: 'How it adds up', rows }],
      result: { label: `${name} now`, value: money(s.balance) },
      footnote: s.hasCards ? `Card purchases don't touch your bank until you pay the card. ${reconcile}` : reconcile,
    };
  },

  owed(s, data) {
    const cards = activeCards(data).map((card) => cardSummary(data, card, s.today));
    const sections = cards.map((c) => {
      const rows = [];
      if (c.closing) {
        rows.push(row(
          c.statementDue ? `Statement balance, due ${formatDate(c.due, 'medium')}` : `Statement from ${formatDate(c.closing, 'medium')}, paid`,
          money(c.statementDue),
        ));
        rows.push(row(`New charges since ${formatDate(c.closing, 'medium')}`, plus(c.newCharges)));
      } else {
        rows.push(row('Charges so far (no statement yet)', money(c.owed)));
      }
      rows.push(c.owed < 0 ? row('Credit on this card', money(c.credit), true) : row('Owed on this card', money(c.owed), true));
      return { heading: c.card.name, rows };
    });
    const credit = s.owed < 0;
    return {
      title: credit ? 'Credit on your card' : 'Credit card owed',
      intro: 'Everything on your card: the statement balance that is due, plus new charges that will be on the next statement.',
      sections,
      result: { label: credit ? 'Credit' : 'Total owed', value: money(Math.abs(s.owed)) },
      footnote: 'A card purchase counts as spending the day you make it. Paying the card only moves money from your bank to the card, so it never counts as spending.',
    };
  },

  afterPayoff(s) {
    if (s.balance === null) {
      return { title: 'After card is paid off', intro: 'Add your bank balance in Settings to see this.', sections: [] };
    }
    return {
      title: 'After card is paid off',
      intro: 'What your bank balance would be once everything on your card is paid, including new charges that are not due yet.',
      sections: [{
        heading: 'How it adds up',
        rows: [
          row('Bank balance now', money(s.balance)),
          row(s.owed < 0 ? 'Credit on your card' : 'Owed on your card (statement plus new charges)', less(s.owed)),
          row('After card is paid off', money(s.afterPayoff), true),
        ],
      }],
      result: { label: 'After card is paid off', value: money(s.afterPayoff) },
      footnote: "Paying the card doesn't change this number, because the money only moves from your bank to the card.",
    };
  },

  statement(s, data) {
    const c = cardFor(s, data);
    if (!c) return { title: 'Statement balance', intro: 'Add a card in Settings.', sections: [] };
    if (!c.closing) {
      return {
        title: 'Statement balance',
        intro: `No statement yet. The first one closes on ${formatDate(c.cycleEnd, 'full')}.`,
        sections: [],
      };
    }
    const confirmed = Number.isSafeInteger(c.card.statements?.[c.closing]);
    const rows = [
      row(confirmed
        ? `Statement on ${formatDate(c.closing, 'medium')}, from your card app`
        : `Owed when the statement closed on ${formatDate(c.closing, 'medium')}`, money(c.statement)),
      row('Paid since then', less(c.statement - c.statementDue)),
      row(`Still due by ${formatDate(c.due, 'medium')}`, money(c.statementDue), true),
    ];
    return {
      title: 'Statement balance',
      intro: 'What your last statement says you owe. Paying it in full by the due date means no interest.',
      sections: [{ heading: c.card.name, rows }],
      result: { label: 'Still due', value: money(c.statementDue) },
      footnote: c.statementDue > 0
        ? `Pay ${money(c.statementDue)} by ${formatDate(c.due, 'full')} and you won't be charged interest. Paying less means interest on the rest.`
        : 'Paid in full. No interest on this statement.',
    };
  },

  cardCycle(s, data) {
    const c = cardFor(s, data);
    if (!c) return { title: 'Card this cycle', intro: 'Add a card in Settings.', sections: [] };
    const rows = [row(`Card purchases since ${formatDate(c.cycleStart, 'medium')} (refunds count back)`, money(c.cycleSpend))];
    if (c.cap) {
      rows.push(row('Your cap for each cycle', money(c.cap)));
      rows.push(row('Used', `${Math.floor((Math.max(0, c.cycleSpend) * 100) / c.cap)}%`, true));
      rows.push(c.overCap
        ? row('Over your cap by', money(c.overCap), true)
        : row('Left before your cap', money(c.cap - c.cycleSpend), true));
    }
    return {
      title: 'Card this cycle',
      intro: `This statement cycle runs ${formatDate(c.cycleStart, 'medium')} to ${formatDate(c.cycleEnd, 'medium')}. Counting per cycle keeps each card bill under your cap.`,
      sections: [{ heading: c.card.name, rows }],
      result: c.cap ? { label: 'Card this cycle', value: `${money(c.cycleSpend)} of ${money(c.cap)}` } : null,
      footnote: c.cap
        ? 'Your cap is your own limit, separate from the credit limit. Runway nudges you at 80% and again at 100%. Payments and cash back credits never count here.'
        : 'Set a personal monthly cap for this card in Settings to track it.',
    };
  },

  utilization(s, data) {
    const c = cardFor(s, data);
    if (!c) return { title: 'Utilization', intro: 'Add a card in Settings.', sections: [] };
    const owedNow = Math.max(0, c.owed);
    const rows = [row('Owed on the card now', money(owedNow))];
    if (owedNow > c.reported) rows.push(row(`Autopay due ${formatDate(c.due, 'medium')}, before the closing`, less(owedNow - c.reported)));
    rows.push(row(`Likely reported on ${formatDate(c.cycleEnd, 'medium')}`, money(c.reported), true));
    rows.push(row('Credit limit', money(c.card.limit)));
    rows.push(row('Utilization', utilizationText(c), true));
    return {
      title: 'Utilization',
      intro: 'Card companies report your balance to the credit bureaus on the statement closing date, so that balance is the one that counts.',
      sections: [{ heading: c.card.name, rows }],
      result: { label: 'Utilization', value: utilizationText(c) },
      footnote: 'Keeping it at 30% of your limit or lower is better for your credit score. Paying part of the card before the closing date lowers it.',
    };
  },

  cashback(s, data) {
    const card = findCard(data, s.cardId);
    const r = card ? rewardsEstimate(data, card, s.today) : null;
    if (!r) return { title: 'Cash back (estimate)', intro: 'Turn on the cash back tracker for this card in Settings.', sections: [] };
    const rows = [];
    if (r.bonus) {
      rows.push(row(`Bonus spending this quarter, ${ratePct(r.bonus.rateBp)} back`, `${money(r.bonus.spent)} of ${money(r.bonus.cap)}`));
      rows.push(row('Estimated this quarter', money(r.windowEarned)));
    }
    rows.push(row(`Estimated since ${formatDate(card.openDate, 'medium')}`, money(r.earned)));
    if (card.rewards.firstYearMatch) {
      rows.push(row(r.matchActive ? 'First-year match (doubles it)' : `First-year match, ended ${formatDate(r.anniversary, 'full')}`, plus(r.match)));
    }
    rows.push(row('Estimated total', money(r.total), true));
    return {
      title: 'Cash back (estimate)',
      intro: `${ratePct(card.rewards.baseBp)} back on everything, plus the bonus rate on the bonus categories you entered, up to each bonus cap.`,
      sections: [{ heading: card.name, rows }],
      result: { label: 'Estimated total', value: money(r.total) },
      footnote: "This is an estimate. Your categories won't match the card company's exactly, so check your card app for the real number.",
    };
  },

  pace(s) {
    if (!s.pace) return { title: 'Pace', intro: 'Set a monthly limit in Settings to see your pace.', sections: [] };
    const p = s.pace;
    const rows = [
      row('Monthly limit', money(s.limit)),
      row('Bills this month, posted and scheduled', less(p.billsThisMonth)),
      row('Everyday budget', money(p.everydayBudget), true),
      row('Share of the month gone, counting today', `× ${s.daysElapsed} ÷ ${s.daysTotal}`),
      row('Spending evenly, you would be at', money(p.expected), true),
      row('Your everyday spending so far', money(p.everydaySpent), true),
    ];
    let footnote;
    if (p.status === 'over') footnote = `Spent plus scheduled bills is ${money(-s.budgetMonth)} over your limit.`;
    else if (p.status === 'ahead') footnote = `You're ${money(p.gap)} ahead of an even pace. Ease off a little and you'll land on budget.`;
    else footnote = `You're ${money(-p.gap)} under an even pace. Nice.`;
    return {
      title: 'Pace',
      intro: "Pace leaves out fixed bills like rent, so a big bill early in the month doesn't throw it off.",
      sections: [{ heading: 'Where you should be today', rows }],
      result: { label: 'Pace', value: PACE_LABEL[p.status] },
      footnote,
    };
  },

  limit(s) {
    if (s.limit === null) return { title: 'Monthly limit', intro: 'Set a monthly limit in Settings to track it here.', sections: [] };
    const rows = [
      row('Spent so far (needs and wants, minus refunds)', money(s.spent)),
      row('Bills still scheduled', money(s.scheduledSpend)),
      row('Monthly limit', money(s.limit)),
      row('Used so far', `${s.usedPct}%`, true),
    ];
    return {
      title: 'Monthly limit',
      intro: 'Money moved to savings is not spending, so it does not count here.',
      sections: [{ heading: periodLabel(s.period), rows }],
      result: { label: 'Used so far', value: `${s.usedPct}%` },
      footnote: 'Runway warns you at 80% and again at 100%.',
    };
  },

  leftover(s) {
    const rows = [
      row('Income so far this month', money(s.income)),
      row('Spending, including money moved to savings', less(s.totals.outflow)),
      row('Bills still scheduled', less(s.scheduledAll)),
      row('Projected left over', money(s.leftover), true),
    ];
    return {
      title: 'Projected left over',
      intro: 'Only income that has already arrived counts, so this is a careful estimate.',
      sections: [{ heading: periodLabel(s.period), rows }],
      result: { label: 'Projected left over', value: money(s.leftover) },
      footnote: s.leftover > 0
        ? 'Move it to savings before it quietly disappears.'
        : 'Spending and bills are more than the income that has come in so far.',
    };
  },

  goal(s) {
    const g = s.goal;
    if (!g) return { title: 'Savings goal', intro: 'Add a goal in Settings to track it here.', sections: [] };
    const rows = [
      row('Already saved when you set the goal', money(g.startSaved)),
      row(`Moved to savings since ${formatDate(g.since, 'full')}`, plus(g.transfers)),
      row('Saved so far', money(g.saved), true),
      row('Goal', money(g.target)),
      row('Progress', `${g.pct}%`, true),
    ];
    return {
      title: g.name,
      intro: 'Anything you log in a Savings category counts toward your goal.',
      sections: [{ heading: 'How it adds up', rows }],
      result: { label: 'Still to go', value: money(g.remaining) },
      footnote: g.done ? 'Goal reached. Treat yourself (within budget).' : '',
    };
  },

  bills(s, data) {
    const active = data.recurring.filter((b) => b.active);
    const rows = active.map((b) => row(`${b.name}, ${money(b.amount)} a ${CADENCE_UNIT[b.cadence]}`, `${money(yearlyCost(b))} a year`));
    const t = billTotals(data.recurring);
    rows.push(row('Per year', money(t.perYear), true));
    rows.push(row('Per month (per year ÷ 12)', money(t.perMonth), true));
    return {
      title: 'Bills and subscriptions',
      intro: 'Weekly charges count 52 times a year, monthly ones 12 times, yearly ones once.',
      sections: [{ heading: 'Active bills', rows }],
      result: { label: 'Per month', value: money(t.perMonth) },
      footnote: t.pausedPerYear ? `Paused bills would cost ${money(t.pausedPerYear)} a year.` : '',
    };
  },

  split(s) {
    const sp = s.split;
    const base = sp.baseSource === 'income' ? 'income this month' : 'your usual monthly pay';
    const sections = [];
    if (sp.target) {
      sections.push({
        heading: `Target: ${sp.split.need}/${sp.split.want}/${sp.split.savings} of ${base} (${money(sp.base)})`,
        rows: [
          row(`Needs, ${sp.split.need}%`, money(sp.target.need)),
          row(`Wants, ${sp.split.want}%`, money(sp.target.want)),
          row(`Savings, ${sp.split.savings}%`, money(sp.target.savings)),
        ],
      });
    }
    sections.push({
      heading: 'Actual this month',
      rows: [
        row('Needs', money(sp.actual.need)),
        row('Wants', money(sp.actual.want)),
        row('Savings', money(sp.actual.savings)),
      ],
    });
    return {
      title: 'Needs, wants and savings',
      intro: 'Each category belongs to a bucket. You can flip any single purchase between Need and Want.',
      sections,
      result: null,
      footnote: sp.baseSource === 'none' ? 'Add your pay in Settings, or log income, to see the target in dollars.' : '',
    };
  },

  net(entry) {
    return {
      title: `Net for ${periodLabel(entry.period)}`,
      intro: 'Money in minus money spent. Moving money to savings counts as kept, not spent.',
      sections: [{
        heading: 'How it adds up',
        rows: [
          row('Income', money(entry.income)),
          row('Spending (needs and wants, minus refunds)', less(entry.spent)),
          row('Net', money(entry.net), true),
        ],
      }],
      result: { label: 'Net', value: money(entry.net) },
      footnote: entry.net >= 0 ? 'Above zero: you kept money this month.' : 'Below zero: you spent more than came in.',
    };
  },
};

/** The card a card "?" is about: `s.cardId`, or the first open card. */
function cardFor(s, data) {
  const card = findCard(data, s.cardId) ?? activeCards(data)[0];
  return card ? cardSummary(data, card, s.today) : null;
}

/** Explanation for one "?" button. `subject` is usually the Home summary. */
export function explain(topic, subject, data) {
  const fn = EXPLAINERS[topic];
  if (!fn) throw new RangeError(`No explanation for ${topic}`);
  return fn(subject, data);
}
