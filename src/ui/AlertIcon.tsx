import Ionicons from '@expo/vector-icons/Ionicons';

import { usePalette } from '@/theme';

type IoniconName = keyof typeof Ionicons.glyphMap;

/** Map a rules icon name ('alert-large-red-shuttle', 'alert-borderless-issue', …) to an Ionicon. */
export function alertIoniconName(iconName: string): IoniconName {
  if (iconName.endsWith('-shuttle')) return 'bus';
  if (iconName.endsWith('-suspension')) return 'close-circle';
  if (iconName.endsWith('-elevator')) return 'accessibility';
  return 'warning';
}

/** Alert glyph in Teal's palette: disruptions in danger, other issues in warning. */
export function AlertIcon({ iconName, size = 16, color }: { iconName: string; size?: number; color?: string }) {
  const c = usePalette();
  const disruptive = iconName.endsWith('-shuttle') || iconName.endsWith('-suspension');
  return (
    <Ionicons
      name={alertIoniconName(iconName)}
      size={size}
      color={color ?? (disruptive ? c.danger : c.warning)}
      accessibilityLabel={disruptive ? 'Service disruption' : 'Service alert'}
    />
  );
}
