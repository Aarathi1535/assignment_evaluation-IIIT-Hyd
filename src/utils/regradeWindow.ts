import { isRegradeWindowOpen as hardenedIsRegradeWindowOpen } from '../lib/regressionHardening';

export interface RegradeWindow {
    regradeWindowOpensAt?: Date | null;
    regradeWindowClosesAt?: Date | null;
}

export function isRegradeWindowOpen(
    exam: RegradeWindow,
    now: Date = new Date()
): boolean {
    const opensAt = exam.regradeWindowOpensAt;
    const closesAt = exam.regradeWindowClosesAt;
    if (!opensAt || !closesAt) {
        return false;
    }

    try {
        const result = hardenedIsRegradeWindowOpen(opensAt, closesAt, now);
        return result.isOpen;
    } catch {
        return false;
    }
}

