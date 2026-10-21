import { useColorScheme } from 'react-native';

/** Teal brand palette. Line colors come from the MBTA API, not from here. */
const light = {
  background: '#EEF7F6',
  surface: '#FFFFFF',
  surfaceMuted: '#E3F1EF',
  border: '#D3E6E3',
  text: '#0B1F1E',
  textMuted: '#55706C',
  brand: '#0D9488',
  brandDeep: '#0B4F4A',
  brandSoft: '#CCF1EC',
  onBrand: '#FFFFFF',
  live: '#0D9488',
  warning: '#B45309',
  danger: '#C2410C',
};

const dark: typeof light = {
  background: '#061412',
  surface: '#0D211E',
  surfaceMuted: '#132C28',
  border: '#1C3A35',
  text: '#E6F4F2',
  textMuted: '#8FB3AD',
  brand: '#2DD4BF',
  brandDeep: '#99F6E4',
  brandSoft: '#123A35',
  onBrand: '#04211E',
  live: '#5EEAD4',
  warning: '#FBBF24',
  danger: '#FB923C',
};

export type Palette = typeof light;

export const fonts = {
  regular: 'Manrope_400Regular',
  medium: 'Manrope_500Medium',
  semibold: 'Manrope_600SemiBold',
  bold: 'Manrope_700Bold',
  extrabold: 'Manrope_800ExtraBold',
} as const;

export const radius = { sm: 8, md: 14, lg: 20, pill: 999 } as const;

/**
 * Type scale (MA §4 sizes, set in Manrope). Each entry is a ready-to-spread text style; numbers
 * use tabular figures so countdowns don't jitter.
 */
export const type = {
  largeTitle: { fontFamily: fonts.extrabold, fontSize: 36, lineHeight: 42 },
  title1: { fontFamily: fonts.bold, fontSize: 32, lineHeight: 38 },
  title2: { fontFamily: fonts.bold, fontSize: 24, lineHeight: 30 },
  title3: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 26 },
  headline: { fontFamily: fonts.semibold, fontSize: 17, lineHeight: 22 },
  body: { fontFamily: fonts.regular, fontSize: 17, lineHeight: 22 },
  callout: { fontFamily: fonts.medium, fontSize: 16, lineHeight: 21 },
  subheadline: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 20 },
  footnote: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18 },
  caption: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16 },
  caption2: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 14 },
  numeric: { fontVariant: ['tabular-nums' as const] },
} as const;

/** Alias of `type`, for files that already use `type` as an identifier. */
export const typeScale = type;

/** Bottom-sheet layout tokens shared by the shell (WP1) and pages. */
export const sheet = {
  /** Snap points: collapsed / half / full. */
  snapPoints: [132, '50%', '92%'] as const,
  initialIndex: 1,
  grabberWidth: 36,
  grabberHeight: 5,
  horizontalPadding: 16,
  cornerRadius: 20,
  headerHeight: 52,
} as const;

export function usePalette(): Palette {
  return useColorScheme() === 'dark' ? dark : light;
}
