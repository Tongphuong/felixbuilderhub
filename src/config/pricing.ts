export const COACHING_MONTHLY_VND = 700000;

export function formatVND(amount: number): string {
  return amount.toLocaleString('vi-VN') + '₫';
}
