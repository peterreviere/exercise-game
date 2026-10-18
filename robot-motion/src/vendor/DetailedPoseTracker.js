import { getAssetBaseUrl, getVisionFileset, joinAssetPath } from './VisionRuntime.js';

export const DETAILED_POSE_CONNECTIONS = Object.freeze([
  [0, 7], [0, 8],
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [15, 17], [15, 19], [15, 21], [17, 19],
  [16, 18], [16, 20], [16, 22], [18, 20],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [27, 29], [29, 31], [27, 31],
  [24, 26], [26, 28], [28, 30], [30, 32], [28, 32],
]);

export const DISPLAY_POSE_POINTS = Object.freeze([
  0, 7, 8, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22,
  23, 24, 25, 26, 27, 28, 29, 30, 31, 32,
]);

export class DetailedPoseTracker {
  constructor(options = {}) {
    this.landmarker = null;
    this.delegate = null;
    this.lastVideoTime = -1;
    this.lastTimestamp = 0;
    this.baseUrl = options.baseUrl || getAssetBaseUrl();
    this.modelAssetPath = options.modelAssetPath
      || joinAssetPath(this.baseUrl, 'models/pose_landmarker_lite.task');
  }

  async initialize() {
    if (this.landmarker) return;
    const [{ PoseLandmarker }, vision] = await Promise.all([
      import('@mediapipe/tasks-vision'),
      getVisionFileset(this.baseUrl),
    ]);
    const options = {
      baseOptions: {
        modelAssetPath: this.modelAssetPath,
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      outputSegmentationMasks: false,
    };
    try {
      this.landmarker = await PoseLandmarker.createFromOptions(vision, options);
      this.delegate = 'GPU';
    } catch (error) {
      options.baseOptions.delegate = 'CPU';
      this.landmarker = await PoseLandmarker.createFromOptions(vision, options);
      this.delegate = 'CPU';
      console.warn('Detailed pose tracking is using CPU inference.', error);
    }
  }

  detect(video, timestamp) {
    if (!this.landmarker || !video || video.readyState < 2) return null;
    if (video.currentTime === this.lastVideoTime) return null;

    // MediaPipe Vision requires strictly monotonically increasing timestamps
    let safeTimestamp = Number(timestamp);
    if (!Number.isFinite(safeTimestamp) || safeTimestamp <= this.lastTimestamp) {
      safeTimestamp = this.lastTimestamp + 1;
    }
    this.lastTimestamp = safeTimestamp;
    this.lastVideoTime = video.currentTime;

    try {
      const result = this.landmarker.detectForVideo(video, safeTimestamp);
      if (!result?.landmarks?.[0]) return null;
      return { landmarks: result.landmarks[0], worldLandmarks: result.worldLandmarks?.[0] || [] };
    } catch (e) {
      console.warn('Pose detection frame skipped:', e);
      return null;
    }
  }

  close() {
    this.landmarker?.close();
    this.landmarker = null;
    this.lastVideoTime = -1;
    this.lastTimestamp = 0;
  }
}

