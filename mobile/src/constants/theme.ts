import { Platform } from 'react-native';

const light = {
  background: '#F7F7F2',
  surface: '#FFFFFF',
  raised: '#F0EFF6',
  border: '#DAD8E3',
  text: '#1C1830',
  muted: '#615D73',
  accent: '#593BC9',
  accentWash: '#EEE9FF',
  button: '#593BC9',
  danger: '#B42318',
  dangerWash: '#FEECE9',
  success: '#08724B',
  successWash: '#E5F5EB',
  warning: '#8A530B',
  warningWash: '#FFF3D6',
};

export type AppColors = typeof light;

const dark: AppColors = {
  background: '#171425',
  surface: '#211C32',
  raised: '#2A243D',
  border: '#4B425E',
  text: '#F8F6FF',
  muted: '#C0B9D0',
  accent: '#C3B0FF',
  accentWash: '#362954',
  button: '#6948DC',
  danger: '#FFB0A9',
  dangerWash: '#40242E',
  success: '#9CE1BB',
  successWash: '#183B30',
  warning: '#F4CC83',
  warningWash: '#422F24',
};

const withThemeColors = (colors: AppColors) => ({
  ...colors,
  backgroundElement: colors.surface,
  backgroundSelected: colors.raised,
  textSecondary: colors.muted,
});

export const Colors = { light: withThemeColors(light), dark: withThemeColors(dark) };
export type ThemeColor = keyof typeof Colors.light;

export const Stage = { background: '#21183C', accent: '#E3FC76', muted: '#DFD9F3', lines: '#4F3B74' };

export const Fonts = {
  sans: 'Onest-Medium',
  bold: 'Onest-Bold',
  display: 'Onest-ExtraBold',
  mono: Platform.select({ ios: 'ui-monospace', default: 'monospace' }),
};

export const Spacing = { half: 2, one: 4, two: 8, three: 16, four: 24, five: 32, six: 64 } as const;
export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 740;
