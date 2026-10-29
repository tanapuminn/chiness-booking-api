const AUTH_COOKIE_NAME = 'auth_token';
const { getAuthSessionMaxAgeMs } = require('./authSession');

const getAuthCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.AUTH_COOKIE_SAMESITE || 'lax',
  maxAge: getAuthSessionMaxAgeMs(),
  path: '/',
});

const setAuthCookie = (res, token) => {
  res.cookie(AUTH_COOKIE_NAME, token, getAuthCookieOptions());
};

const clearAuthCookie = (res) => {
  res.clearCookie(AUTH_COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.AUTH_COOKIE_SAMESITE || 'lax',
    path: '/',
  });
};

const getCookieValue = (cookieHeader, name) => {
  if (!cookieHeader) return null;
  const encodedName = `${encodeURIComponent(name)}=`;
  const cookie = cookieHeader.split(';').map((part) => part.trim()).find((part) => part.startsWith(encodedName));
  return cookie ? decodeURIComponent(cookie.slice(encodedName.length)) : null;
};

const getAuthToken = (req) => getCookieValue(req.headers.cookie, AUTH_COOKIE_NAME);

module.exports = {
  AUTH_COOKIE_NAME,
  setAuthCookie,
  clearAuthCookie,
  getAuthToken,
};
