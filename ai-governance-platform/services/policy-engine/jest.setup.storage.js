// Unit tests use in-process storage; nothing reaches DynamoDB, PostgreSQL or S3.
process.env.STORAGE_BACKEND = process.env.STORAGE_BACKEND_FOR_TESTS || 'memory';
process.env.OBJECT_STORE = 'memory';
