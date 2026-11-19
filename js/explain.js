// Plain-English versions of every formula, with your live numbers filled in.
// Shape: { title, intro, sections: [{ heading, rows: [{ label, value, total }] }], result, footnote }.
import { formatMoney } from './money.js';
import { formatDate, periodLabel } from './dates.js';
import { yearlyCost, billTotals, CADENCE_UNIT } from './recurring.js';

const money = (c) => formatMoney(c);
const MINUS = '−';
/** "− $5.00", or "+ $5.00" when the amount is negative. */
const less = (c) => (c >= 0 ? `${MINUS} ${money(c)}` : `+ ${money(-c)}`);
const plus = (c) => (c >= 0 ? `+ ${money(c)}` : `${MINUS} ${money(-c)}`);
const row = (label, value, total = false) => ({ label, value, total });

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
    row('Balance right now', money(s.balance)),
    row(toPayday ? 'Bills due before payday' : 'Bills due before the month ends', less(s.billsBeforeHorizon)),
  ];
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
    if (!data.balance) {
      return { title: 'Balance', intro: 'Add your debit card balance in Settings to track it here.', sections: [] };
    }
    let income = 0;
    let spending = 0;
    let adjustments = 0;
    for (const t of data.transactions) {
      if (t.date < data.balance.startDate || t.date > s.today) continue;
      if (t.type === 'income') income += t.amount;
      else if (t.type === 'expense') spending += -t.amount;
      else adjustments += t.amount;
    }
    const rows = [
      row(`Starting balance on ${formatDate(data.balance.startDate, 'full')}`, money(data.balance.start)),
      row('Income since then', plus(income)),
      row('Spending since then (refunds count back)', less(spending)),
    ];
    if (adjustments) rows.push(row('Adjustments from Reconcile', plus(adjustments)));
    rows.push(row('Balance now', money(s.balance), true));
    return {
      title: 'Balance',
      intro: 'Your starting balance plus everything logged since that day.',
      sections: [{ heading: 'How it adds up', rows }],
      result: { label: 'Balance now', value: money(s.balance) },
      footnote: "If this doesn't match your bank app, tap Reconcile. Runway adds an adjustment for the difference.",
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

/** Explanation for one "?" button. `subject` is usually the Home summary. */
export function explain(topic, subject, data) {
  const fn = EXPLAINERS[topic];
  if (!fn) throw new RangeError(`No explanation for ${topic}`);
  return fn(subject, data);
}
