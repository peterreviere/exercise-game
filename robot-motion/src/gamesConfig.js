/**
 * Extensible Game Registry Framework for Accessible Exercise Games.
 * 
 * To add new games to the platform in the future, simply add an entry to this array.
 * Each entry specifies visual presentation, accessibility metadata,
 * and game dispatch configuration.
 */

export const GAMES_CONFIG = [
  {
    id: 'robot-buddy-1',
    title: 'Robot Mirror Buddy',
    subtitle: 'Gentle Mirror Motion Practice',
    description: 'Follow and mirror Blue, your animated robot buddy. Practice upper-body reach, side bends, and arm lifts with real-time pose tracking.',
    status: 'Ready to Play',
    image: `${import.meta.env?.BASE_URL || './'}robot/preview.png`,
    intensity: 'Gentle (Low Strain)',
    focus: 'Upper Body & Reach',
    tags: ['Active Activity', 'Exercise Practice', 'Zero Impact'],
    isPlayable: true,
  },
  {
    id: 'robot-buddy-2',
    title: 'Robot Mirror Buddy (Slot 2)',
    subtitle: 'Upper-Body Mobility Test Slot',
    description: 'Test slot for exercise activities. Uses the existing robot motion tracking interface to calibrate movement range.',
    status: 'Test Card 2',
    image: `${import.meta.env?.BASE_URL || './'}robot/preview.png`,
    intensity: 'Gentle (Low Strain)',
    focus: 'Shoulders & Arms',
    tags: ['Test Slot', 'Mobility', 'Upper Body'],
    isPlayable: true,
  },
  {
    id: 'robot-buddy-3',
    title: 'Robot Mirror Buddy (Slot 3)',
    subtitle: 'Calm Breathing & Gentle Poses Slot',
    description: 'Test slot for future exercise games. Easy to extend with new activities in the games configuration framework.',
    status: 'Test Card 3',
    image: `${import.meta.env?.BASE_URL || './'}robot/preview.png`,
    intensity: 'Low Strain',
    focus: 'Trunk & Core',
    tags: ['Test Slot', 'Mindful Movement', 'Low Strain'],
    isPlayable: true,
  },
];

