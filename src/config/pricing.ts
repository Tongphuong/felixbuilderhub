export const MSMW_DIGITAL_VND = 69000;
export const MSMW_HARDCOPY_VND = 129000;
export const COACHING_MONTHLY_VND = 700000;

export function formatVND(amount: number): string {
  return amount.toLocaleString('vi-VN') + '₫';
}
