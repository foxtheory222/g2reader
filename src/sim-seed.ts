export function shouldSeedSimulatorBook(search: string, isDevelopmentBuild: boolean): boolean {
  return isDevelopmentBuild && new URLSearchParams(search).get('simSeedBook') === '1'
}
