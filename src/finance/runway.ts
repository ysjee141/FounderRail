export interface RunwayInput {
  availableCash: number;
  monthlyRevenue: number;
  monthlyExpenses: number;
}

export interface RunwayResult extends RunwayInput {
  monthlyNetBurn: number;
  runwayMonths: number | null;
  sustainableAtCurrentRate: boolean;
}

export function calculateRunway(input: RunwayInput): RunwayResult {
  for (const [name, value] of Object.entries(input)) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a finite non-negative number`);
  }
  const monthlyNetBurn = input.monthlyExpenses - input.monthlyRevenue;
  const sustainableAtCurrentRate = monthlyNetBurn <= 0;
  return {
    ...input,
    monthlyNetBurn,
    runwayMonths: sustainableAtCurrentRate ? null : input.availableCash / monthlyNetBurn,
    sustainableAtCurrentRate,
  };
}
