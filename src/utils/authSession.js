const DEFAULT_AUTH_SESSION_DURATION = '1d';

const DURATION_UNIT_MS = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

const getAuthSessionDuration = () => process.env.JWT_EXPIRES_IN || DEFAULT_AUTH_SESSION_DURATION;

const getAuthSessionMaxAgeMs = () => {
  const duration = getAuthSessionDuration();
  const match = /^(\d+)([smhd])$/.exec(duration);

  if (!match) {
    throw new Error('JWT_EXPIRES_IN must use a duration such as 30m, 8h, or 1d');
  }

  return Number(match[1]) * DURATION_UNIT_MS[match[2]];
};

module.exports = {
  DEFAULT_AUTH_SESSION_DURATION,
  getAuthSessionDuration,
  getAuthSessionMaxAgeMs,
};
