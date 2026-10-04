// Canonical API integration-test bootstrap.  Loading the repository environment
// is necessary for credentials/host metadata, but database tests must always use
// the separately named isolated test database derived by the database package.
import {
  TEST_DATABASE_URL,
  assertTestDatabaseIsolation,
} from "../../../packages/database/test/helpers.js";

assertTestDatabaseIsolation();
process.env.TEST_DATABASE_URL = TEST_DATABASE_URL;
// Never inherit the production Owner credential into test processes.  The API
// fixtures deliberately exercise authentication with this public test token.
process.env.AMF_OWNER_TOKEN = "test-owner-token";
