// Test-only budgets: the 2.3s delayed-initialize regression exceeds the old 2s
// setup limit. Keep a separate outer budget for behavior and owned cleanup.
export const fixtureStartupMs = 6_000;
export const fixtureTestMs = 12_000;
export const slowInitializationMs = 2_300;
