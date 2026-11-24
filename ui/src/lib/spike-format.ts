import type { CompositionValue, VersionStatus } from './tims-api';

const superscripts = '⁰¹²³⁴⁵⁶⁷⁸⁹';
export const superscript = (text: string) => text.replace(/[0-9-+]/g, c => c === '-' ? '⁻' : c === '+' ? '⁺' : superscripts[Number(c)]);
export const isotopeLabel = (text: string) => text.replace(/\d+(?=[A-Z][a-z]?)/g, superscript);
export const subfractionLabel = (id: string, name: string) => id === 'unassigned' ? 'Not yet assigned to a bottle or batch' : name;
export const versionStatusLabel = (status: VersionStatus) => ({ current: 'Current', superseded: 'Superseded', withdrawn: 'Withdrawn' })[status];
export const uncertaintyLabel = (type: CompositionValue['uncertainty_type']) => ({
  '1sd_rel_pct': '1σ %', '2sd_rel_pct': '2σ %', '1sd_abs': '1σ', '2sd_abs': '2σ',
})[type ?? '1sd_abs'];

const digits = (n: number) => String(Math.abs(n)).split('e')[0].replace('.', '').replace(/^0+/, '').length;
const exponent = (n: number) => Number(Math.abs(n).toExponential().split('e')[1]);
function display(n: number, precision: number): string {
  if (n === 0) return '0';
  if (!Number.isFinite(n)) return String(n);
  const rounded = n.toPrecision(precision);
  const value = Number(rounded);
  if (Math.abs(value) < 1e-3 || Math.abs(value) >= 1e5) {
    const [mantissa, power] = value.toExponential(precision - 1).split('e');
    return `${mantissa} × 10${superscript(String(Number(power)))}`;
  }
  return value.toFixed(Math.max(0, precision - exponent(value) - 1));
}

/**
 * Count all coefficient digits in String(n), including trailing integer zeros.
 * Uncertainties retain up to 3 of those digits. For relative %, convert the
 * rounded uncertainty to absolute magnitude, retaining its significant-digit
 * count to locate its last decimal place (without changing 1σ/2σ convention).
 * Values retain that place, with a 3-figure floor and their own String(n) digit
 * ceiling. Missing, zero or untyped uncertainties use up to 6 value figures;
 * zero is always "0". Full precision bypasses all formatting, including powers.
 */
export function formatSpikeValue(entry: CompositionValue, fullPrecision = false): { value: string; uncertainty?: string } {
  const { value, uncertainty, uncertainty_type: type } = entry;
  const relative = type?.endsWith('_rel_pct');
  const suffix = relative ? ' %' : '';
  if (fullPrecision) return { value: String(value), uncertainty: uncertainty === undefined ? undefined : String(uncertainty) + suffix };
  const uncertaintyDigits = uncertainty ? Math.min(3, digits(uncertainty)) : 1;
  let precision = Math.min(6, digits(value));
  if (uncertainty && type && value && Number.isFinite(value) && Number.isFinite(uncertainty)) {
    const shownUncertainty = Number(uncertainty.toPrecision(uncertaintyDigits));
    // Logarithms avoid underflow when a tiny value has a relative uncertainty.
    const absoluteExponent = relative
      ? Math.floor(Math.log10(Math.abs(value)) + Math.log10(Math.abs(shownUncertainty)) - 2 + 1e-12)
      : exponent(shownUncertainty);
    const place = absoluteExponent - uncertaintyDigits + 1;
    precision = Math.min(digits(value), Math.max(3, exponent(value) - place + 1));
  }
  return {
    value: display(value, Math.max(1, precision)),
    uncertainty: uncertainty === undefined ? undefined : display(uncertainty, uncertaintyDigits) + suffix,
  };
}
