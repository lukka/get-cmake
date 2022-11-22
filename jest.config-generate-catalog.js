module.exports = {
  clearMocks: true,
  moduleFileExtensions: ['js', 'ts'],
  testEnvironment: 'node',
  testMatch: ['**/*.catalog.ts'],
  testRunner: 'jest-circus/runner',
  transform: {
    '^.+\\.ts$': 'ts-jest'
  },
  verbose: true,
  collectCoverage: false,
}