module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  // The compatibility test signs tokens with the gateway's own key code.
  moduleNameMapper: { '^@ai-governance/(types|utils|storage)$': '<rootDir>/../../shared/$1/src/index.ts' },
};
