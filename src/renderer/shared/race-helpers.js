// F1 24/25/26 session-type enum: 15 = Race, 16 = Race 2, 17 = Race 3.
// (10-12 are Sprint Shootout sessions — they were Race in F1 23 and older.)
export function isRaceSession(session) {
  return !!session && session.sessionType >= 15 && session.sessionType <= 17;
}

export function getPlayerLap(state) {
  return state.lapData?.[state.playerCarIndex] || null;
}

export function isPlayerRaceFinished(state, session = state.session, lap = getPlayerLap(state)) {
  if (!isRaceSession(session) || !lap) return false;
  if (Number.isFinite(session.trackLength) && session.trackLength > 0 && Number.isFinite(session.totalLaps) && session.totalLaps > 0) {
    const raceDistanceMeters = session.trackLength * session.totalLaps;
    const finishToleranceMeters = Math.max(50, session.trackLength * 0.015);
    if (Number.isFinite(lap.totalDistance) && lap.totalDistance >= raceDistanceMeters - finishToleranceMeters) {
      return true;
    }
  }
  if (lap.resultStatus >= 3) return true;
  return Number.isFinite(session.totalLaps) && session.totalLaps > 0 && lap.currentLapNum > session.totalLaps;
}

export function getRemainingRaceDistanceLaps(session, lap) {
  if (!isRaceSession(session) || !lap || !Number.isFinite(session.totalLaps) || session.totalLaps <= 0) return 0;
  const fullLapsAfterCurrent = Math.max(0, session.totalLaps - lap.currentLapNum);
  if (!Number.isFinite(session.trackLength) || session.trackLength <= 0) {
    return fullLapsAfterCurrent;
  }
  const rawLapDistance = Number.isFinite(lap.lapDistance) ? lap.lapDistance : 0;
  const lapDistance = Math.min(Math.max(rawLapDistance, 0), session.trackLength);
  const currentLapRemaining = 1 - (lapDistance / session.trackLength);
  return fullLapsAfterCurrent + Math.max(0, Math.min(1, currentLapRemaining));
}

export function getTrackAheadGapMeters(fromLap, toLap, session) {
  if (!session || !fromLap || !toLap || !Number.isFinite(session.trackLength) || session.trackLength <= 0) return null;
  const trackLength = session.trackLength;
  const fromDist = Number.isFinite(fromLap.lapDistance) ? fromLap.lapDistance : 0;
  const toDist = Number.isFinite(toLap.lapDistance) ? toLap.lapDistance : 0;
  let diff = toDist - fromDist;
  while (diff < 0) diff += trackLength;
  while (diff >= trackLength) diff -= trackLength;
  return diff;
}

export function getTrackProximityMeters(lapA, lapB, session) {
  const ahead = getTrackAheadGapMeters(lapA, lapB, session);
  const behind = getTrackAheadGapMeters(lapB, lapA, session);
  if (ahead == null || behind == null) return null;
  return Math.min(ahead, behind);
}

export function isTrackLikeSurface(surface) {
  return surface === 0 || surface === 1 || surface === 2 || surface === 10;
}

export function isTelemetryOffTrack(telemetryEntry) {
  const surfaces = telemetryEntry?.surfaceType;
  if (!Array.isArray(surfaces) || surfaces.length === 0) return false;
  return surfaces.some((surface) => !isTrackLikeSurface(surface));
}
