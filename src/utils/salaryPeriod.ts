// Maps an ISO date (yyyy-mm-dd) to a salary period 'yyyy-mm'.
// Cut-off rule: on/after the 25th the period rolls to the NEXT month
// (December rolls into January of the next year).
// Parsed directly from the string to avoid any local-timezone shift.

const pad2 = (n: number): string => String(n).padStart(2, '0');

export const salaryPeriod = (isoDate: string): string => {
  const [yStr, mStr, dStr] = isoDate.split('-');
  let year = Number(yStr);
  let month = Number(mStr); // 1-12
  const day = Number(dStr);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new Error(`salaryPeriod: invalid ISO date '${isoDate}'`);
  }

  if (day >= 25) {
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  // TODO(SD Worx): open point 1 - confirm how this 'yyyy-mm' period maps onto
  // the Cobra SalaryComponent StartPeriod field (format and exact cut-off day).
  return `${year}-${pad2(month)}`;
};
