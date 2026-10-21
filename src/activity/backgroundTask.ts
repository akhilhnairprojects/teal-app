/**
 * Background location source, flagged off (spec §1). To enable it in a development build: set
 * BACKGROUND_TRACKING in locationHub.ts, add the expo-location plugin options
 * `isIosBackgroundLocationEnabled: true` and `locationAlwaysAndWhenInUsePermission`, call
 * `registerBackgroundLocationTask()` at module scope from src/app/_layout.tsx, and request background
 * permission before starting updates.
 */
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { canTrackInBackground, ingestFixes, toRawFix } from './locationHub';

export const BACKGROUND_LOCATION_TASK = 'teal-background-location';

/** Defines the task (must run at module scope at startup). No-op unless background tracking is possible. */
export function registerBackgroundLocationTask(): void {
  if (!canTrackInBackground() || TaskManager.isTaskDefined(BACKGROUND_LOCATION_TASK)) return;
  TaskManager.defineTask<{ locations?: Location.LocationObject[] }>(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
    if (error || !data?.locations) return;
    ingestFixes(data.locations.map(toRawFix));
  });
}
