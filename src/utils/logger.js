const serializeError = (error) => error instanceof Error
  ? { name: error.name, message: error.message, stack: process.env.NODE_ENV === 'production' ? undefined : error.stack }
  : error;

const write = (level, message, context = {}) => {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    service: 'table-api',
    message,
    ...context,
  };
  const output = JSON.stringify(entry);
  if (level === 'error') console.error(output);
  else if (level === 'warn') console.warn(output);
  else console.log(output);
};

module.exports = {
  info: (message, context) => write('info', message, context),
  warn: (message, context) => write('warn', message, context),
  error: (message, context) => write('error', message, context),
  serializeError,
};