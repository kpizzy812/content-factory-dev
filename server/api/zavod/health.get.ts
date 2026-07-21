export default defineEventHandler(async (event) => {
  requireZavodAuth(event)
  return {
    data: {
      service: "zavodcamp",
      status: "ok",
      time: new Date().toISOString(),
    },
  }
})
