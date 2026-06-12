/**
 * Jest Configuration for Server Tests
 */

module.exports = {
  // Test environment
  testEnvironment: 'node',
  
  // Test file patterns
  testMatch: [
    '**/__tests__/**/*.js',
    '**/?(*.)+(spec|test).js'
  ],

  // Don't treat support files under __tests__ (e.g. setup.js) as test suites.
  // setup.js is loaded via setupFilesAfterEach below, not run as a suite.
  testPathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/__tests__/setup.js'
  ],

  // Coverage configuration
  collectCoverage: false, // Set to true when running coverage
  coverageDirectory: 'coverage',
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/migrations/',
    '/scripts/',
    '/logs/',
    '/uploads/',
    '/reports/',
    '/backups/',
    'index.js' // Main entry point
  ],
  
  // Coverage thresholds (can be enabled later)
  // coverageThreshold: {
  //   global: {
  //     branches: 50,
  //     functions: 50,
  //     lines: 50,
  //     statements: 50
  //   }
  // },
  
  // Setup files
  setupFilesAfterEnv: ['<rootDir>/__tests__/setup.js'],
  
  // Module paths
  moduleDirectories: ['node_modules', '<rootDir>'],
  
  // Clear mocks between tests
  clearMocks: true,
  
  // Verbose output
  verbose: true,
  
  // Test timeout (5 seconds)
  testTimeout: 5000
};
