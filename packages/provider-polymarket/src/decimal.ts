export function averageDecimalStrings(left: string, right: string): string | null {
  const first = parseDecimal(left);
  const second = parseDecimal(right);
  if (first === null || second === null) return null;
  const scale = Math.max(first.scale, second.scale);
  const firstValue = first.value * 10n ** BigInt(scale - first.scale);
  const secondValue = second.value * 10n ** BigInt(scale - second.scale);
  const sum = firstValue + secondValue;
  if (sum % 2n === 0n) return formatDecimal(sum / 2n, scale);
  return formatDecimal(sum * 5n, scale + 1);
}

function parseDecimal(value: string): { value: bigint; scale: number } | null {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  const [whole = '0', fraction = ''] = normalized.split('.');
  return {
    value: BigInt(`${whole}${fraction}`),
    scale: fraction.length,
  };
}

function formatDecimal(value: bigint, scale: number): string {
  if (scale === 0) return value.toString();
  const padded = value.toString().padStart(scale + 1, '0');
  const whole = padded.slice(0, -scale);
  const fraction = padded.slice(-scale).replace(/0+$/, '');
  return fraction.length === 0 ? whole : `${whole}.${fraction}`;
}
