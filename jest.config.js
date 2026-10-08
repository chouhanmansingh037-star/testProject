/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests/server'],
  transform: { '^.+\.ts$': ['ts-jest', { tsconfig: 'tsconfig.server.json', diagnostics: true }] },
  moduleFileExtensions: ['ts', 'js', 'json'],
};
