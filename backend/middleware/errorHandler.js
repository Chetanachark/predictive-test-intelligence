export function errorHandler(error, _req, res, _next) {
  const status = error.status || 500
  if (status >= 500) console.error(error)
  res.status(status).json({ message: status >= 500 ? 'An unexpected server error occurred.' : error.message })
}
