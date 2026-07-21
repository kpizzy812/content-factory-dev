export default defineEventHandler((event) => {
  requireZavodAuth(event)

  return {
    status: "ok",
    service: "zavod-camp",
    timestamp: new Date().toISOString(),
  }
})
