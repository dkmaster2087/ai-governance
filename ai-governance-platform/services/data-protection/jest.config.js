module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^@ai-governance/types$': '<rootDir>/../../shared/types/src/index.ts',
    '^@ai-governance/utils$': '<rootDir>/../../shared/utils/src/index.ts',
  },
};
