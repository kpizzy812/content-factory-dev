export function useIntegrationStatus() {
  return useFetch('/api/integration/status')
}
