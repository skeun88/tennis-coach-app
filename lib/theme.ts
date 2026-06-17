/**
 * Design tokens — Terracotta theme
 * Primary: Terracotta #D2755A | Accent Warm #E89B7E | Navy #1B2E4B
 */

export const Colors = {
  // Brand
  primary: '#D2755A',       // terracotta
  primaryLight: '#FBF2EF',  // terracotta light
  navy: '#1B2E4B',          // deep navy — used for headers / dark surfaces
  accentWarm: '#E89B7E',    // warm coral accent
  mint: '#00C9A7',          // mint accent (kept for legacy)

  // Backgrounds
  background: '#FAFAFA',    // was #f5f7fa
  card: '#FFFFFF',
  mutedBg: '#F4F6F9',       // was #f5f5f5 / #f0f0f0

  // Text
  foreground: '#2D3340',    // was #1a1a1a / #333
  mutedFg: '#8B93A5',       // was #888 / #aaa / #555
  placeholder: '#B0B7C3',   // was #bbb / #ccc

  // Borders
  border: '#E5E9F0',        // was #eee / #e0e0e0
  borderLight: '#EEF1F6',   // was #f0f0f0

  // Status
  success: '#22C55E',
  successLight: '#ECFDF5',  // was #d1fae5
  successBorder: '#A7F3D0', // was #bbf7d0
  warning: '#EAB308',
  warningLight: '#FFFBEB',
  destructive: '#EF4444',   // was #dc2626
  destructiveLight: '#FEF2F2',
  destructiveBorder: '#FECACA',
  info: '#3B82F6',          // was #2563eb

  // Misc
  white: '#FFFFFF',
  black: '#000000',
  transparent: 'transparent',
  iconMuted: '#B0B7C3',     // was #ccc

  // Level badge colors (member levels) — warm terracotta palette
  level: {
    입문: '#B0B7C3',
    초급: '#E89B7E',        // warm coral
    중급: '#D2755A',        // terracotta (primary)
    상급: '#B85A42',        // deep terracotta
    고급: '#B85A42',        // alias for 상급
    선수: '#1B2E4B',        // navy — elite
  },
};

export const Radius = {
  sm: 8,
  md: 12,
  lg: 14,
  xl: 16,
  full: 9999,
};

export const Shadow = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
};
