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
    id: 'robot-buddy-3',
    title: 'Boxing Beat',
    subtitle: 'A follow-the-cues boxing rhythm game',
    description: 'Read the upcoming move cues and match them to the beat. Lean left or right, throw a left or right punch, duck, or block using your webcam-tracked pose.',
    status: 'Ready to Play',
    image: `${import.meta.env?.BASE_URL || './'}robot/preview_boxing.png`,
    intensity: 'Moderate (Adjustable Pace)',
    focus: 'Coordination & Full Body',
    tags: ['Rhythm Game', 'Boxing Moves', 'Pose Tracking'],
    isPlayable: true,
    gameType: 'boxing-beat',
  },

  // Added: Flying Adventure
  {
    id: 'flying-game',
    title: 'Flying Adventure',
    subtitle: 'Arm-powered flight & reach',
    description: 'Flap your arms and reach upward to steer through floating rings — great for upper-body cardio and posture.',
    status: 'Playable',
    focus: 'Upper Body · Coordination',
    intensity: 'Medium',
    image: `${import.meta.env?.BASE_URL || './'}robot/preview_flying.png`,
    gameType: 'flying',
    isPlayable: true,
  },

  // Added: Stretch & Flow
  {
    id: 'stretching-game',
    title: 'Stretch & Flow',
    subtitle: 'Build wings, restore power, and launch',
    description: 'Reach for six wing parts, lean and connect three power cells, then march across the launch route and power the thrusters. Follow the movement cues with webcam pose tracking.',
    status: 'Playable',
    focus: 'Flexibility · Recovery',
    intensity: 'Low',
    image: `${import.meta.env?.BASE_URL || './'}robot/preview_stretching.png`,
    gameType: 'stretching',
    isPlayable: true,
  },

];
