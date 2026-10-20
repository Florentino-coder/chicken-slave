/** Process-wide counters exposed on /api/health. Reset on restart; ship to a real analytics sink later. */
export const metrics = {
  startedAt: Date.now(),
  guestsCreated: 0,
  roomsCreated: 0,
  gamesStarted: 0,
  roundsFinished: 0,
  quickMatches: 0,
};
