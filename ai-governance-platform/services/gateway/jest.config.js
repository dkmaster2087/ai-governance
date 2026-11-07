module.exports = {
  setupFiles: ['<rootDir>/jest.setup.storage.js'],
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^@ai-governance/catalog$': '<rootDir>/../../shared/catalog/src/index.ts',
    '^@ai-governance/types$': '<rootDir>/../../shared/types/src/index.ts',
    '^@ai-governance/utils$': '<rootDir>/../../shared/utils/src/index.ts',
    '^@ai-governance/storage$': '<rootDir>/../../shared/storage/src/index.ts',
  },
};
