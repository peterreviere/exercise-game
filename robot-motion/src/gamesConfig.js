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
    title: 'Robot Mirror Buddy Demo',
    subtitle: 'Gentle Mirror Motion Practice',
    description: 'Follow and mirror Moshi, your animated robot buddy. Practice upper-body reach, side bends, and arm lifts with real-time pose tracking.',
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
    title: 'Boxing Beat',
    subtitle: 'A follow-the-cues boxing rhythm game',
    description: 'Read the upcoming move cues and match them to the beat. Lean left or right, throw a left or right punch, duck, or block using your webcam-tracked pose.',
    status: 'Ready to Play',
    image: `${import.meta.env?.BASE_URL || './'}robot/preview.png`,
    intensity: 'Moderate (Adjustable Pace)',
    focus: 'Coordination & Full Body',
    tags: ['Rhythm Game', 'Boxing Moves', 'Pose Tracking'],
    isPlayable: true,
    gameType: 'boxing-beat',
  },
];
