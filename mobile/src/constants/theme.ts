// ============================================================================
// Design Tokens — Giggle
// iOS-native feel: SF Pro metrics, clean spacing, dark theme
// ============================================================================

export const COLORS = {
  // Background layers
  bg: '#000000',
  bgCard: '#111111',
  bgElevated: '#1A1A1A',
  bgOverlay: 'rgba(0,0,0,0.6)',

  // Text
  textPrimary: '#FFFFFF',
  textSecondary: '#8E8E93',
  textTertiary: '#48484A',

  // Accent
  accent: '#FF375F',        // Heart red — warm, not aggressive
  accentSoft: 'rgba(255,55,95,0.15)',
  share: '#5AC8FA',         // Share blue — informational
  shareSoft: 'rgba(90,200,250,0.15)',

  // System
  separator: '#2C2C2E',
  success: '#30D158',
  warning: '#FF9F0A',
  destructive: '#FF453A',

  // Onboarding tags
  tagActive: '#2C2C2E',
  tagSelected: 'rgba(255,55,95,0.2)',
  tagBorder: '#3A3A3C',
  tagBorderSelected: '#FF375F',
};

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  screenPadding: 20,
};

export const FONT = {
  // iOS system font (SF Pro) — via Platform.select or system default
  regular: { fontFamily: 'System', fontWeight: '400' as const },
  medium: { fontFamily: 'System', fontWeight: '500' as const },
  semibold: { fontFamily: 'System', fontWeight: '600' as const },
  bold: { fontFamily: 'System', fontWeight: '700' as const },

  // Sizes following iOS HIG
  size: {
    caption2: 11,
    caption1: 12,
    footnote: 13,
    subheadline: 15,
    body: 17,
    headline: 17,
    title3: 20,
    title2: 22,
    title1: 28,
    largeTitle: 34,
  },
};

export const RADIUS = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  full: 999,
};

export const SHADOW = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
};

// Tab bar height (for feed card calculation)
export const TAB_BAR_HEIGHT = 83; // iOS standard with safe area
export const STATUS_BAR_PADDING = 59; // iOS dynamic island
