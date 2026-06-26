// F1 25 / F1 26 (2026 Season Pack) UDP Packet Type Definitions
// Byte offsets verified against EA's official specs (packetFormat 2025 / 2026).

export const PACKET_HEADER_SIZE = 29;
/// 24 in packetFormat 2026 (Audi + Cadillac), 22 in 2025.
export const MAX_CARS = 24;

/** ERS energy-store capacity in joules (4 MJ — unchanged for 2026 regs). */
export const MAX_ERS_STORE_J = 4_000_000;

// Packet IDs
export enum PacketId {
  Motion = 0,
  Session = 1,
  LapData = 2,
  Event = 3,
  Participants = 4,
  CarSetup = 5,
  CarTelemetry = 6,
  CarStatus = 7,
  FinalClassification = 8,
  LobbyInfo = 9,
  CarDamage = 10,
  SessionHistory = 11,
  TyreSets = 12,
  MotionEx = 13,
  TimeTrial = 14,
  LapPositions = 15,
  /** New in 2026 Season Pack: Overtake mode + Active Aero per car. */
  CarTelemetry2 = 16,
}

// Tyre order in F1 25: RL=0, RR=1, FL=2, FR=3
export enum TyreIndex {
  RearLeft = 0,
  RearRight = 1,
  FrontLeft = 2,
  FrontRight = 3,
}

export enum Weather {
  Clear = 0,
  LightCloud = 1,
  Overcast = 2,
  LightRain = 3,
  HeavyRain = 4,
  Storm = 5,
}

// F1 24/25/26 enum — Race moved from 10 to 15 in F1 24.
export enum SessionType {
  Unknown = 0,
  P1 = 1,
  P2 = 2,
  P3 = 3,
  ShortPractice = 4,
  Q1 = 5,
  Q2 = 6,
  Q3 = 7,
  ShortQ = 8,
  OSQ = 9,
  SprintShootout1 = 10,
  SprintShootout2 = 11,
  SprintShootout3 = 12,
  ShortSprintShootout = 13,
  OneShotSprintShootout = 14,
  Race = 15,
  Race2 = 16,
  Race3 = 17,
  TimeTrial = 18,
}

/** True for R / R2 / R3 (F1 24+ enum values 15-17). */
export function isRaceSessionType(t: number | undefined | null): boolean {
  return t != null && t >= SessionType.Race && t <= SessionType.Race3;
}

/** True for any qualifying-style session (Q1-OSQ, sprint shootouts). */
export function isQualiSessionType(t: number | undefined | null): boolean {
  return t != null && t >= SessionType.Q1 && t <= SessionType.OneShotSprintShootout;
}

export enum SafetyCarStatus {
  None = 0,
  Full = 1,
  Virtual = 2,
  FormationLap = 3,
}

export enum PitStatus {
  None = 0,
  Pitting = 1,
  InPitArea = 2,
}

export enum DriverStatus {
  InGarage = 0,
  FlyingLap = 1,
  InLap = 2,
  OutLap = 3,
  OnTrack = 4,
}

export enum ResultStatus {
  Invalid = 0,
  Inactive = 1,
  Active = 2,
  Finished = 3,
  DNF = 4,
  DSQ = 5,
  NotClassified = 6,
  Retired = 7,
}

export enum FiaFlag {
  None = 0,
  Green = 1,
  Blue = 2,
  Yellow = 3,
}

// Mode 3 is "Overtake" in F1 25, renamed "Boost" in the 2026 Season Pack.
export enum ErsDeployMode {
  None = 0,
  Medium = 1,
  Hotlap = 2,
  Boost = 3,
}

export const ERS_MODE_LABELS: Record<number, string> = {
  0: 'None',
  1: 'Medium',
  2: 'Hotlap',
  3: 'Boost',
};

export enum ActualTyreCompound {
  C5 = 16,
  C4 = 17,
  C3 = 18,
  C2 = 19,
  C1 = 20,
  C0 = 21,
  C6 = 22,
  Inter = 7,
  Wet = 8,
}

export enum VisualTyreCompound {
  Soft = 16,
  Medium = 17,
  Hard = 18,
  Inter = 7,
  Wet = 8,
}

export interface PacketHeader {
  packetFormat: number;
  gameYear: number;
  gameMajorVersion: number;
  gameMinorVersion: number;
  packetVersion: number;
  packetId: PacketId;
  sessionUID: bigint;
  sessionTime: number;
  frameIdentifier: number;
  overallFrameIdentifier: number;
  playerCarIndex: number;
  secondaryPlayerCarIndex: number;
}

export interface WeatherForecastSample {
  sessionType: number;
  timeOffset: number;
  weather: Weather;
  trackTemp: number;
  trackTempChange: number;
  airTemp: number;
  airTempChange: number;
  rainPercentage: number;
}

export interface MarshalZone {
  zoneStart: number;
  zoneFlag: FiaFlag;
}

/** Lap-fraction zone (0..1 around the lap) — DRS and Active Aero zones. */
export interface LapZone {
  start: number;
  end: number;
}

export interface SessionData {
  /** 2025 or 2026 — which UDP format the game is sending. */
  packetFormat?: number;
  weather: Weather;
  trackTemperature: number;
  airTemperature: number;
  totalLaps: number;
  trackLength: number;
  sessionType: SessionType;
  trackId: number;
  formula: number;
  sessionTimeLeft: number;
  sessionDuration: number;
  pitSpeedLimit: number;
  gamePaused: number;
  isSpectating: number;
  spectatorCarIndex: number;
  safetyCarStatus: SafetyCarStatus;
  numRedFlagPeriods: number;
  pitStopWindowIdealLap: number;
  pitStopWindowLatestLap: number;
  /** Game's own predicted rejoin position if you pit now (0 when unavailable). */
  pitStopRejoinPosition?: number;
  weatherForecast: WeatherForecastSample[];
  forecastAccuracy: number;
  playerCarIndex: number;
  trackName: string;
  sessionTypeName: string;
  weatherName: string;
  // ── 2026 Season Pack additions ──
  /** 0 = Full active-aero, 1 = Partial (per track). */
  activeAeroTrackStatus?: number;
  aeroZonesFull?: LapZone[];
  aeroZonesPartial?: LapZone[];
  drsZones?: LapZone[];
}

// 4-element arrays: [RL, RR, FL, FR]
export type TyreArray<T> = [T, T, T, T];

export interface LapData {
  lastLapTimeMs: number;
  currentLapTimeMs: number;
  sector1TimeMs: number;
  sector2TimeMs: number;
  deltaToCarAheadMs: number;
  deltaToLeaderMs: number;
  lapDistance: number;
  totalDistance: number;
  safetyCarDelta: number;
  carPosition: number;
  currentLapNum: number;
  pitStatus: PitStatus;
  numPitStops: number;
  sector: number;
  currentLapInvalid: number;
  penalties: number;
  totalWarnings?: number;
  cornerCuttingWarnings?: number;
  numUnservedDriveThroughPens?: number;
  numUnservedStopGoPens?: number;
  gridPosition: number;
  driverStatus: DriverStatus;
  resultStatus: ResultStatus;
  pitLaneTimerActive: number;
  /** Current time spent in the pit lane (ms) — used to calibrate per-track pit loss. */
  pitLaneTimeInLaneMs?: number;
  /** Duration of the actual stationary pit stop (ms). */
  pitStopTimerMs?: number;
  /** Whether the car should serve a penalty at this stop. */
  pitStopShouldServePen?: number;
}

export interface HistoryLap {
  lapNumber: number;
  lapTimeMs: number;
  sector1TimeMs: number;
  sector2TimeMs: number;
  sector3TimeMs: number;
  validFlags: number;
}

export interface DriverHistoryUpdate {
  carIdx: number;
  laps: HistoryLap[];
}

export interface CarTelemetry {
  speed: number;
  throttle: number;
  steer: number;
  brake: number;
  clutch: number;
  gear: number;
  engineRPM: number;
  drs: number;
  revLightsPercent: number;
  brakesTemp: TyreArray<number>;
  tyreSurfaceTemp: TyreArray<number>;
  tyreInnerTemp: TyreArray<number>;
  engineTemp: number;
  tyrePressure: TyreArray<number>;
  surfaceType: TyreArray<number>;
}

export interface CarStatus {
  tractionControl: number;
  antiLockBrakes: number;
  fuelMix: number;
  frontBrakeBias: number;
  pitLimiterStatus: number;
  fuelInTank: number;
  fuelCapacity: number;
  fuelRemainingLaps: number;
  maxRPM: number;
  idleRPM: number;
  maxGears: number;
  drsAllowed: number;
  drsActivationDist: number;
  actualTyreCompound: ActualTyreCompound;
  visualTyreCompound: VisualTyreCompound;
  tyresAgeLaps: number;
  vehicleFiaFlags: FiaFlag;
  enginePowerICE: number;
  enginePowerMGUK: number;
  ersStoreEnergy: number;
  ersDeployMode: ErsDeployMode;
  ersHarvestedMGUK: number;
  ersHarvestedMGUH: number;
  /** 2026 only: FIA per-lap harvest limit in joules (varies by track). */
  ersHarvestLimitPerLap?: number;
  ersDeployedThisLap: number;
  networkPaused: number;
}

/** 2026 Season Pack — Car Telemetry 2 (packet id 16). */
export interface CarTelemetry2 {
  /** 0 = Corner mode (Z-mode), 1 = Straight mode (X-mode). */
  activeAeroMode: number;
  activeAeroAvailable: number;
  /** Metres until Active Aero is available; 0 = not available. */
  activeAeroActivationDist: number;
  /** Manual Override (push-to-pass) armed for this lap. */
  overtakeAvailable: number;
  overtakeActive: number;
  overtakeActivationDist: number;
  /** 1 when this car runs 2026 regulations. */
  regulations2026: number;
  drivingWrongWay: number;
}

export interface CarDamage {
  tyresWear: TyreArray<number>;
  tyresDamage: TyreArray<number>;
  brakesDamage: TyreArray<number>;
  tyreBlisters: TyreArray<number>;
  frontLeftWingDamage: number;
  frontRightWingDamage: number;
  rearWingDamage: number;
  floorDamage: number;
  diffuserDamage: number;
  sidepodDamage: number;
  drsFault: number;
  ersFault: number;
  gearBoxDamage: number;
  engineDamage: number;
  engineMGUHWear: number;
  engineESWear: number;
  engineCEWear: number;
  engineICEWear: number;
  engineMGUKWear: number;
  engineTCWear: number;
  engineBlown: number;
  engineSeized: number;
}

export interface CarSetup {
  frontWing: number;
  rearWing: number;
  onThrottle: number;
  offThrottle: number;
  frontCamber: number;
  rearCamber: number;
  frontToe: number;
  rearToe: number;
  frontSuspension: number;
  rearSuspension: number;
  frontAntiRollBar: number;
  rearAntiRollBar: number;
  frontSuspensionHeight: number;
  rearSuspensionHeight: number;
  brakePressure: number;
  brakeBias: number;
  engineBraking: number;
  rearLeftTyrePressure: number;
  rearRightTyrePressure: number;
  frontLeftTyrePressure: number;
  frontRightTyrePressure: number;
  ballast: number;
  fuelLoad: number;
}

export interface Participant {
  aiControlled: number;
  driverId: number;
  networkId: number;
  teamId: number;
  myTeam: number;
  raceNumber: number;
  nationality: number;
  name: string;
}

export interface EventData {
  type: string;
  vehicleIdx?: number;
  lapTimeMs?: number;
  safetyCarType?: number;
  eventType?: number;
  overtakingVehicleIdx?: number;
  beingOvertakenVehicleIdx?: number;
  /** Stamped client-side when the event arrives. */
  receivedAt?: number;
  /** Monotonic client-side sequence number (stable across the ring buffer). */
  seq?: number;
}

export interface SessionHistory {
  carIdx: number;
  numLaps: number;
  bestLapTimeMs: number;
}

// Enriched types for renderer consumption
export interface EnrichedSessionData extends SessionData {
  trackName: string;
  sessionTypeName: string;
  weatherName: string;
}

export interface LapDataUpdate {
  lapData: LapData[];
  playerCarIndex: number;
}

export interface SetupUpdate extends CarSetup {
  nextFrontWingValue: number | null;
}
