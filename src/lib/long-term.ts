/**
 * Long-term income projection ("when do I reach my monthly goal?"), year by year.
 *
 *   income[k+1] = income[k] × (1 + g) + newMoney[k] × y
 *   newMoney[k] = 12 × contribution + (reinvest ? income[k] : 0)
 *
 * with y = the portfolio's net forward yield on market value (so new money buys income at
 * today's yield) and g = growth of the dividend per share. Simple on purpose: no inflation,
 * no price drift, no fees. The retirement planner of the host does the full model.
 */
export interface LongTermInput {
  /** net income of the next 12 months, base currency */
  annualNet: number;
  /** current market value of the dividend-paying holdings, base currency */
  marketValue: number;
  /** base currency per month */
  monthlyContribution: number;
  /** fraction, e.g. 0.03 */
  dividendGrowth: number;
  reinvest: boolean;
  /** monthly target; 0 = none */
  goalMonthly: number;
  startYear: number;
  maxYears?: number;
}

export interface LongTermPoint {
  year: number;
  /** net income per month, base currency */
  monthly: number;
  /** cumulative new money added (excluding reinvested dividends) */
  contributed: number;
}

export interface LongTermResult {
  points: LongTermPoint[];
  /** net forward yield used, fraction */
  yieldUsed: number;
  /** first year in which monthly >= goal; null if not within maxYears */
  goalYear: number | null;
}

export function projectLongTerm(input: LongTermInput): LongTermResult {
  const maxYears = input.maxYears ?? 40;
  const y = input.marketValue > 0 ? input.annualNet / input.marketValue : 0;
  const g = Number.isFinite(input.dividendGrowth) ? input.dividendGrowth : 0;
  const points: LongTermPoint[] = [];
  let income = input.annualNet;
  let contributed = 0;
  let goalYear: number | null = null;
  for (let k = 0; k <= maxYears; k++) {
    const year = input.startYear + k;
    points.push({ year, monthly: income / 12, contributed });
    if (goalYear === null && input.goalMonthly > 0 && income / 12 >= input.goalMonthly) goalYear = year;
    const newMoney = 12 * input.monthlyContribution + (input.reinvest ? income : 0);
    income = income * (1 + g) + newMoney * y;
    contributed += 12 * input.monthlyContribution;
  }
  return { points, yieldUsed: y, goalYear };
}
