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

    const nowTime = now.getTime();
    const opensTime = opensAt.getTime();
    const closesTime = closesAt.getTime();
    return Number.isFinite(nowTime)
        && Number.isFinite(opensTime)
        && Number.isFinite(closesTime)
        && opensTime <= nowTime
        && nowTime <= closesTime;
}
